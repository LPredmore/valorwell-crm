-- Newsletter reliability: authoritative preflight, parent failure state, single claim path, reconciliation.

alter table public.crm_newsletters drop constraint if exists crm_newsletters_status_check;
alter table public.crm_newsletters add constraint crm_newsletters_status_check
  check (status = any (array['draft','scheduled','sending','completed','failed','cancelled']));
alter table public.crm_newsletters
  add column if not exists failed_at timestamptz,
  add column if not exists failure_code text,
  add column if not exists failure_message text;

-- Mirrors supabase/functions/newsletter-send-worker/rendering.ts validateNewsletterTemplateContract.
create or replace function private.crm_newsletter_template_preflight(
  p_subject text, p_preheader text, p_html text, p_text text)
returns text
language plpgsql immutable set search_path to ''
as $$
declare
  v_canonical text[] := array['newsletter_greeting_name','sender_name','unsubscribe_url','postal_address',
    'greeting_name','recipient_name','first_name','preferred_name','unsubscribe_link','valorwell_postal_address'];
  v_disallowed text[] := array['last_name','therapist_name','contact_first_name','contact_display_name',
    'organization_name','organization_type','real_action_summary','cause_area','opportunity_context',
    'approved_source_sentence','staff_first_name','staff_last_name','staff_display_name','staff_role'];
  v_value text; v_token text; v_expr text; v_residual text;
  v_bad_disallowed text[] := '{}'; v_bad_unknown text[] := '{}'; v_bad_malformed text[] := '{}';
begin
  foreach v_value in array array[coalesce(p_subject,''),coalesce(p_html,''),coalesce(p_text,''),coalesce(p_preheader,'')] loop
    for v_token in select lower(m[1]) from regexp_matches(v_value, '\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}', 'g') m loop
      if v_token = any(v_canonical) then continue; end if;
      if v_token = any(v_disallowed) then v_bad_disallowed := array_append(v_bad_disallowed, v_token);
      else v_bad_unknown := array_append(v_bad_unknown, v_token); end if;
    end loop;
    for v_expr in select m[1] from regexp_matches(v_value, '(\{\{[^{}]*\}\})', 'g') m loop
      if v_expr !~ '^\{\{\s*[a-zA-Z][a-zA-Z0-9_]*\s*\}\}$' then v_bad_malformed := array_append(v_bad_malformed, v_expr); end if;
    end loop;
    v_residual := regexp_replace(v_value, '\{\{[^{}]*\}\}', '', 'g');
    if position('{{' in v_residual) > 0 or position('}}' in v_residual) > 0 then
      v_bad_malformed := array_append(v_bad_malformed, 'unbalanced braces');
    end if;
  end loop;
  if cardinality(v_bad_disallowed) > 0 then
    return 'DISALLOWED_NEWSLETTER_VARIABLE:' || array_to_string(array(select distinct unnest(v_bad_disallowed) order by 1), ',');
  end if;
  if cardinality(v_bad_unknown) > 0 then
    return 'UNKNOWN_NEWSLETTER_VARIABLE:' || array_to_string(array(select distinct unnest(v_bad_unknown) order by 1), ',');
  end if;
  if cardinality(v_bad_malformed) > 0 then
    return 'MALFORMED_NEWSLETTER_TEMPLATE_EXPRESSION:' || array_to_string(array(select distinct unnest(v_bad_malformed) order by 1), ',');
  end if;
  return null;
end;
$$;
revoke all on function private.crm_newsletter_template_preflight(text,text,text,text) from public;

-- Terminal parent failure.
create or replace function public.crm_fail_newsletter(p_newsletter_id uuid, p_code text, p_message text)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare v_n public.crm_newsletters; v_stood integer;
begin
  select * into v_n from public.crm_newsletters where id=p_newsletter_id for update;
  if v_n.id is null then raise exception 'Newsletter not found'; end if;
  if v_n.status not in ('scheduled','sending') then
    return jsonb_build_object('newsletterId',v_n.id,'status',v_n.status,'failed',false);
  end if;
  update public.crm_newsletter_recipients
  set status='skipped',suppression_reason='newsletter_failed',claim_token=null,claimed_at=null,updated_at=now()
  where newsletter_id=v_n.id and status in ('pending','processing');
  get diagnostics v_stood=row_count;
  update public.crm_newsletters
  set status='failed',failed_at=now(),failure_code=left(coalesce(p_code,'unknown'),120),
      failure_message=left(coalesce(p_message,''),2000),completed_at=coalesce(completed_at,now()),updated_at=now()
  where id=v_n.id;
  perform public.crm_emit_automation_event(
    v_n.tenant_id,'newsletter.send_failed','newsletter',v_n.id,
    'newsletter:send_failed:' || v_n.id::text,
    jsonb_build_object('newsletterId',v_n.id,'failureCode',p_code,'failureMessage',p_message,'stoodDownRecipients',v_stood),
    'database');
  return jsonb_build_object('newsletterId',v_n.id,'status','failed','failed',true,'stoodDownRecipients',v_stood);
end;
$$;
revoke all on function public.crm_fail_newsletter(uuid,text,text) from public, anon, authenticated;
grant execute on function public.crm_fail_newsletter(uuid,text,text) to service_role;

-- Authoritative scheduling with backend template preflight.
create or replace function public.crm_schedule_newsletter(p_newsletter_id uuid, p_scheduled_at timestamp with time zone, p_reason text)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'actor_id')::uuid;
  v_newsletter public.crm_newsletters;
  v_settings public.crm_resend_email_settings;
  v_snapshot jsonb;
  v_pending integer;
  v_preflight text;
  v_when timestamptz := coalesce(p_scheduled_at,now());
begin
  if coalesce(btrim(p_reason),'')='' then raise exception 'A reason is required to schedule a newsletter'; end if;
  if private.crm_newsletter_runtime_state(v_tenant) <> 'ACTIVE' then
    raise exception 'Newsletter delivery is not ACTIVE. Scheduling is unavailable while the runtime is PRELAUNCH or PAUSED.';
  end if;
  if not private.crm_control_plane_flag(v_tenant,'communications_control_plane_enabled') then
    raise exception 'The communications control plane must be enabled before scheduling a newsletter';
  end if;

  select * into v_newsletter from public.crm_newsletters
  where id=p_newsletter_id and tenant_id=v_tenant for update;
  if v_newsletter.id is null then raise exception 'Newsletter not found for this tenant'; end if;
  if v_newsletter.status <> 'draft' then raise exception 'Only a draft newsletter can be scheduled'; end if;
  if v_newsletter.editor_document is null or v_newsletter.editor_schema_version is null
     or nullif(btrim(coalesce(v_newsletter.subject,'')),'') is null
     or nullif(btrim(coalesce(v_newsletter.body_html,'')),'') is null
     or nullif(btrim(coalesce(v_newsletter.body_text,'')),'') is null
     or nullif(btrim(coalesce(v_newsletter.theme_key,'')),'') is null
     or nullif(btrim(coalesce(v_newsletter.render_hash,'')),'') is null then
    raise exception 'Canonical Email Studio newsletter content is required before scheduling';
  end if;

  v_preflight := private.crm_newsletter_template_preflight(
    v_newsletter.subject, v_newsletter.preheader, v_newsletter.body_html, v_newsletter.body_text);
  if v_preflight is not null then
    raise exception 'Newsletter contains invalid personalization variables (%). Fix the content before scheduling.', v_preflight;
  end if;

  select * into v_settings from public.crm_resend_email_settings where tenant_id=v_tenant;
  if v_settings.connection_status <> 'connected'
     or nullif(btrim(coalesce(v_settings.from_email,'')),'') is null
     or nullif(btrim(coalesce(v_settings.reply_to_email,'')),'') is null
     or nullif(btrim(coalesce(v_settings.postal_address,'')),'') is null then
    raise exception 'Connected Resend sender, reply-to address, and postal address are required before scheduling';
  end if;

  v_snapshot := private.crm_materialize_newsletter_recipients(v_newsletter.id);
  v_pending := coalesce((v_snapshot->>'pending')::integer,0);
  if v_pending=0 then raise exception 'The selected audiences contain no deliverable mailboxes after eligibility and suppression checks'; end if;

  update public.crm_newsletters
  set status='scheduled',scheduled_at=v_when,failed_at=null,failure_code=null,failure_message=null,updated_at=now()
  where id=v_newsletter.id;

  perform public.crm_emit_automation_event(
    v_tenant,'newsletter.scheduled','newsletter',v_newsletter.id,
    'newsletter:scheduled:' || v_newsletter.id::text || ':' || gen_random_uuid()::text,
    jsonb_build_object('newsletterId',v_newsletter.id,'scheduledAt',v_when,'pendingRecipients',v_pending,
                       'suppressedRecipients',coalesce((v_snapshot->>'suppressed')::integer,0),
                       'reason',btrim(p_reason),'actorProfileId',v_profile,'renderHash',v_newsletter.render_hash),
    'database'
  );

  return jsonb_build_object('newsletterId',v_newsletter.id,'status','scheduled','scheduledAt',v_when,
                            'pendingRecipients',v_pending,'suppressedRecipients',coalesce((v_snapshot->>'suppressed')::integer,0));
end;
$function$;

-- Parent finalization distinguishes success from failure.
create or replace function public.crm_finalize_newsletter(p_newsletter_id uuid)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_newsletter public.crm_newsletters;
  v_outstanding integer; v_sent integer; v_failed integer; v_suppressed integer; v_skipped integer; v_total integer;
begin
  select * into v_newsletter from public.crm_newsletters where id=p_newsletter_id for update;
  if v_newsletter.id is null then raise exception 'Newsletter not found'; end if;
  select count(*) filter (where status in ('pending','processing','queued')),
         count(*) filter (where status='sent'),count(*) filter (where status='failed'),
         count(*) filter (where status='suppressed'),count(*) filter (where status='skipped'), count(*)
  into v_outstanding,v_sent,v_failed,v_suppressed,v_skipped,v_total
  from public.crm_newsletter_recipients where newsletter_id=v_newsletter.id;

  if v_outstanding>0 or v_newsletter.status<>'sending' then
    return jsonb_build_object('newsletterId',v_newsletter.id,'status',v_newsletter.status,'outstanding',v_outstanding,'finalized',false);
  end if;

  if v_sent=0 then
    perform public.crm_fail_newsletter(v_newsletter.id,
      case when v_total=0 then 'no_recipients' when v_failed>0 then 'all_recipients_failed' else 'no_recipients_delivered' end,
      format('No emails were delivered (%s failed, %s suppressed, %s skipped).', v_failed, v_suppressed, v_skipped));
    return jsonb_build_object('newsletterId',v_newsletter.id,'status','failed','sent',0,'failed',v_failed,
                              'suppressed',v_suppressed,'skipped',v_skipped,'finalized',true);
  end if;

  update public.crm_newsletters set status='completed',completed_at=now(),updated_at=now() where id=v_newsletter.id;
  perform public.crm_emit_automation_event(
    v_newsletter.tenant_id,'newsletter.send_completed','newsletter',v_newsletter.id,
    'newsletter:send_completed:' || v_newsletter.id::text,
    jsonb_build_object('newsletterId',v_newsletter.id,'sent',v_sent,'failed',v_failed,'suppressed',v_suppressed,'skipped',v_skipped),
    'database');
  return jsonb_build_object('newsletterId',v_newsletter.id,'status','completed','sent',v_sent,'failed',v_failed,
                            'suppressed',v_suppressed,'skipped',v_skipped,'finalized',true);
end;
$function$;

-- Single claim path for cron and wake-up runs.
drop function if exists public.crm_claim_due_newsletters(integer);
create function public.crm_claim_due_newsletters(p_limit integer default 5, p_newsletter_id uuid default null)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_rows jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
  v_row record;
  v_preflight text;
begin
  for v_row in
    select n.id,n.tenant_id,n.name,n.status,n.subject,n.preheader,n.body_html,n.body_text
    from public.crm_newsletters n
    where n.status in ('scheduled','sending')
      and (p_newsletter_id is null or n.id=p_newsletter_id)
      and (n.status='sending' or coalesce(n.scheduled_at,now())<=now())
      and private.crm_newsletter_runtime_state(n.tenant_id)='ACTIVE'
      and private.crm_control_plane_flag(n.tenant_id,'communications_control_plane_enabled')
      and exists (
        select 1 from public.crm_newsletter_recipients r
        where r.newsletter_id=n.id and r.status='pending'
          and (r.next_attempt_at is null or r.next_attempt_at<=now())
      )
    order by coalesce(n.scheduled_at,n.created_at)
    limit greatest(1,least(coalesce(p_limit,5),25))
    for update of n skip locked
  loop
    v_preflight := private.crm_newsletter_template_preflight(v_row.subject,v_row.preheader,v_row.body_html,v_row.body_text);
    if v_preflight is not null then
      perform public.crm_fail_newsletter(v_row.id,'template_invalid',v_preflight);
      v_failed := v_failed || jsonb_build_object('newsletterId',v_row.id,'failureCode','template_invalid','failureMessage',v_preflight);
      continue;
    end if;
    if v_row.status='scheduled' then
      update public.crm_newsletters set status='sending',started_at=coalesce(started_at,now()),updated_at=now() where id=v_row.id;
      perform public.crm_emit_automation_event(
        v_row.tenant_id,'newsletter.send_started','newsletter',v_row.id,
        'newsletter:send_started:' || v_row.id::text,
        jsonb_build_object('newsletterId',v_row.id,'name',v_row.name),
        'database');
    end if;
    v_rows := v_rows || jsonb_build_object('newsletterId',v_row.id,'tenantId',v_row.tenant_id,'name',v_row.name);
  end loop;
  return jsonb_build_object('newsletters',v_rows,'failed',v_failed);
end;
$function$;
revoke all on function public.crm_claim_due_newsletters(integer,uuid) from public, anon, authenticated;
grant execute on function public.crm_claim_due_newsletters(integer,uuid) to service_role;

-- Reconcile sending newsletters that have no remaining recipient work.
create or replace function public.crm_reconcile_sending_newsletters()
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_row record; v_result jsonb; v_done jsonb := '[]'::jsonb;
begin
  for v_row in
    select n.id from public.crm_newsletters n
    where n.status='sending'
      and not exists (select 1 from public.crm_newsletter_recipients r
                      where r.newsletter_id=n.id and r.status in ('pending','processing','queued'))
    for update of n skip locked
  loop
    v_result := public.crm_finalize_newsletter(v_row.id);
    v_done := v_done || v_result;
  end loop;
  return jsonb_build_object('reconciled',jsonb_array_length(v_done),'results',v_done);
end;
$function$;
revoke all on function public.crm_reconcile_sending_newsletters() from public, anon, authenticated;
grant execute on function public.crm_reconcile_sending_newsletters() to service_role;

-- Stale claims on failed newsletters are stood down too.
create or replace function public.crm_release_stale_newsletter_claims(p_older_than_minutes integer default 15)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_released integer := 0; v_cancelled integer := 0;
  v_cutoff timestamptz := now()-make_interval(mins=>greatest(1,coalesce(p_older_than_minutes,15)));
begin
  update public.crm_newsletter_recipients r
  set status='skipped',suppression_reason=case when n.status='failed' then 'newsletter_failed' else 'newsletter_cancelled' end,
      claim_token=null,claimed_at=null,updated_at=now()
  from public.crm_newsletters n
  where r.newsletter_id=n.id and r.status='processing' and r.claimed_at<v_cutoff and n.status in ('cancelled','failed');
  get diagnostics v_cancelled=row_count;

  update public.crm_newsletter_recipients r
  set status='pending',claim_token=null,claimed_at=null,next_attempt_at=now(),updated_at=now()
  from public.crm_newsletters n
  where r.newsletter_id=n.id and r.status='processing' and r.claimed_at<v_cutoff and n.status='sending';
  get diagnostics v_released=row_count;
  return jsonb_build_object('released',v_released,'cancelled',v_cancelled);
end;
$function$;

-- Worker status reads the real cron job and lifecycle health.
create or replace function public.crm_newsletter_worker_status()
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_last_start timestamptz; v_last_status text;
begin
  select d.start_time, d.status into v_last_start, v_last_status
  from cron.job_run_details d join cron.job j on j.jobid=d.jobid
  where j.jobname like 'newsletter-send-worker%'
  order by d.start_time desc limit 1;

  return jsonb_build_object(
    'lastRunAt', v_last_start,
    'lastRunStatus', v_last_status,
    'dueNow', (select count(*) from public.crm_newsletters where tenant_id=v_tenant and status='scheduled' and scheduled_at<=now()),
    'sending', (select count(*) from public.crm_newsletters where tenant_id=v_tenant and status='sending'),
    'stuckSending', (select count(*) from public.crm_newsletters n where n.tenant_id=v_tenant and n.status='sending'
                       and coalesce(n.started_at,n.updated_at) < now()-interval '30 minutes'
                       and not exists (select 1 from public.crm_newsletter_recipients r where r.newsletter_id=n.id
                                       and (r.status='processing' and r.claimed_at>now()-interval '15 minutes'
                                            or r.status='pending' and r.next_attempt_at>now()))),
    'failed', (select count(*) from public.crm_newsletters where tenant_id=v_tenant and status='failed'),
    'processingRecipients', (select count(*) from public.crm_newsletter_recipients where tenant_id=v_tenant and status='processing'),
    'pendingRecipients', (select count(*) from public.crm_newsletter_recipients r join public.crm_newsletters n on n.id=r.newsletter_id
                          where r.tenant_id=v_tenant and r.status='pending' and n.status in ('scheduled','sending'))
  );
end;
$function$;

-- Targeted in-place corrections of two read RPCs.
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.crm_communications_observability'::regproc);
  if position('r.status = ''claimed''' in v_def) > 0 then
    execute replace(v_def, 'r.status = ''claimed''', 'r.status = ''processing''');
  end if;
  v_def := pg_get_functiondef('public.crm_get_newsletter(uuid)'::regprocedure);
  if position('''failureCode''' in v_def) = 0 then
    execute replace(v_def, '''completedAt'',n.completed_at,',
      '''completedAt'',n.completed_at,''failedAt'',n.failed_at,''failureCode'',n.failure_code,''failureMessage'',n.failure_message,');
  end if;
end $$;