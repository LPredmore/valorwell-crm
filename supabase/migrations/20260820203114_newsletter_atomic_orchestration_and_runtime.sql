-- Atomic newsletter scheduling, claim-time safety, retry semantics, and runtime readiness.
-- Production remains PRELAUNCH; no scheduler is installed by this migration.

alter table public.crm_newsletter_recipients
  add column if not exists last_attempt_at timestamptz,
  add column if not exists next_attempt_at timestamptz;

create index if not exists crm_newsletter_recipients_due_idx
  on public.crm_newsletter_recipients (newsletter_id, status, next_attempt_at, created_at);

create or replace function private.crm_materialize_newsletter_recipients(p_newsletter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_newsletter public.crm_newsletters;
  v_pending integer := 0;
  v_suppressed integer := 0;
  v_memberships integer := 0;
begin
  select * into v_newsletter from public.crm_newsletters where id=p_newsletter_id for update;
  if v_newsletter.id is null then raise exception 'Newsletter not found'; end if;
  if v_newsletter.status <> 'draft' then raise exception 'Recipient snapshots may only be materialized for draft newsletters'; end if;

  delete from public.crm_newsletter_recipients where newsletter_id=v_newsletter.id;

  with candidates as (
    select c.audience_domain,c.record_id,c.person_id,c.candidate_email,c.candidate_name,
           public.newsletter_mailbox_key(c.candidate_email) as mailbox_key
    from private.crm_newsletter_candidates(v_newsletter.tenant_id,v_newsletter.audience_domains) c
    where public.newsletter_mailbox_key(c.candidate_email) is not null
  ), grouped as (
    select mailbox_key,
           min(candidate_email) as delivery_email,
           array_agg(distinct audience_domain order by audience_domain) as qualifying_audiences,
           jsonb_agg(jsonb_build_object('domain',audience_domain,'recordId',record_id,'personId',person_id,'email',candidate_email)
                     order by audience_domain,candidate_email) as source_memberships,
           count(*) as membership_count,
           count(distinct person_id) filter (where person_id is not null) as person_count,
           (array_agg(person_id order by person_id) filter (where person_id is not null))[1] as person_id,
           count(distinct lower(coalesce(candidate_name,''))) as name_variants,
           (array_agg(candidate_name order by candidate_email))[1] as primary_name
    from candidates group by mailbox_key
  ), resolved as (
    select g.*,s.mailbox_key is not null as is_suppressed,s.reason as suppression_reason,
           s.reason_code as suppression_reason_code,s.source as suppression_source,
           case when g.membership_count=1 or (g.person_count=1 and g.name_variants=1)
                then private.crm_newsletter_greeting_first_name(g.primary_name) else null end as greeting_first_name
    from grouped g
    left join public.crm_newsletter_suppressions s
      on s.tenant_id=v_newsletter.tenant_id and s.mailbox_key=g.mailbox_key and s.revoked_at is null
  ), inserted as (
    insert into public.crm_newsletter_recipients (
      tenant_id,newsletter_id,person_id,source_domain,source_record_id,recipient_email,mailbox_key,status,
      suppression_reason,qualifying_audiences,source_memberships,suppression_snapshot,greeting_name,next_attempt_at
    )
    select v_newsletter.tenant_id,v_newsletter.id,
           case when r.person_count=1 then r.person_id else null end,
           r.qualifying_audiences[1],
           case when r.membership_count=1 then (r.source_memberships->0->>'recordId')::uuid else null end,
           r.delivery_email,r.mailbox_key,
           case when r.is_suppressed then 'suppressed' else 'pending' end,
           case when r.is_suppressed then r.suppression_reason else null end,
           r.qualifying_audiences,r.source_memberships,
           jsonb_build_object('suppressionEnforced',true,'mailboxSuppressed',r.is_suppressed,
                              'reason',r.suppression_reason,'reasonCode',r.suppression_reason_code,
                              'source',r.suppression_source,'capturedAt',now()),
           coalesce(r.greeting_first_name,'Friend'),null
    from resolved r
    returning status,jsonb_array_length(source_memberships) as memberships
  )
  select coalesce(count(*) filter (where status='pending'),0),
         coalesce(count(*) filter (where status='suppressed'),0),
         coalesce(sum(memberships),0)
  into v_pending,v_suppressed,v_memberships from inserted;

  return jsonb_build_object('newsletterId',v_newsletter.id,'pending',v_pending,'suppressed',v_suppressed,
                            'sourceMemberships',v_memberships,'suppressionEnforced',true);
end;
$$;

revoke all on function private.crm_materialize_newsletter_recipients(uuid) from public, anon, authenticated;
grant execute on function private.crm_materialize_newsletter_recipients(uuid) to service_role;

create or replace function public.crm_build_newsletter_recipients(p_newsletter_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
begin
  if coalesce(btrim(p_reason),'')='' then raise exception 'A reason is required'; end if;
  raise exception 'Recipient snapshots are created atomically when a canonical newsletter is scheduled. The separate build step has been retired.' using errcode='55000';
end;
$$;

create or replace function public.crm_schedule_newsletter(p_newsletter_id uuid, p_scheduled_at timestamptz, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'actor_id')::uuid;
  v_newsletter public.crm_newsletters;
  v_settings public.crm_resend_email_settings;
  v_snapshot jsonb;
  v_pending integer;
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
  set status='scheduled',scheduled_at=v_when,updated_at=now()
  where id=v_newsletter.id;

  insert into public.crm_automation_events (tenant_id,event_type,subject_domain,subject_id,occurred_at,payload)
  values (v_tenant,'newsletter.scheduled','newsletter',v_newsletter.id,now(),
          jsonb_build_object('newsletterId',v_newsletter.id,'scheduledAt',v_when,'pendingRecipients',v_pending,
                             'suppressedRecipients',coalesce((v_snapshot->>'suppressed')::integer,0),
                             'reason',btrim(p_reason),'actorProfileId',v_profile,'renderHash',v_newsletter.render_hash));

  return jsonb_build_object('newsletterId',v_newsletter.id,'status','scheduled','scheduledAt',v_when,
                            'pendingRecipients',v_pending,'suppressedRecipients',coalesce((v_snapshot->>'suppressed')::integer,0));
end;
$$;

create or replace function public.crm_clone_newsletter_to_draft(p_newsletter_id uuid, p_name text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'actor_id')::uuid;
  v_source public.crm_newsletters;
  v_id uuid;
begin
  if coalesce(btrim(p_name),'')='' then raise exception 'A name is required for the revised draft'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'A reason is required to revise a newsletter'; end if;
  select * into v_source from public.crm_newsletters where id=p_newsletter_id and tenant_id=v_tenant;
  if v_source.id is null then raise exception 'Newsletter not found for this tenant'; end if;

  insert into public.crm_newsletters (
    tenant_id,name,subject,body_html,body_text,preheader,template_version_id,audience_domains,status,
    created_by_profile_id,metadata,audience_filters,editor_document,editor_schema_version,theme_key,render_hash
  ) values (
    v_tenant,btrim(p_name),v_source.subject,v_source.body_html,v_source.body_text,v_source.preheader,v_source.template_version_id,
    v_source.audience_domains,'draft',v_profile,
    coalesce(v_source.metadata,'{}'::jsonb) || jsonb_build_object('revisedFromNewsletterId',v_source.id),
    v_source.audience_filters,v_source.editor_document,v_source.editor_schema_version,v_source.theme_key,v_source.render_hash
  ) returning id into v_id;

  insert into public.crm_automation_events (tenant_id,event_type,subject_domain,subject_id,occurred_at,payload)
  values (v_tenant,'newsletter.revised','newsletter',v_id,now(),
          jsonb_build_object('newsletterId',v_id,'revisedFromNewsletterId',v_source.id,'reason',btrim(p_reason),'actorProfileId',v_profile));
  return jsonb_build_object('newsletterId',v_id,'revisedFromNewsletterId',v_source.id,'status','draft');
end;
$$;

create or replace function public.crm_claim_due_newsletters(p_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_row record;
begin
  for v_row in
    select n.id,n.tenant_id,n.name,n.status
    from public.crm_newsletters n
    where n.status in ('scheduled','sending')
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
    if v_row.status='scheduled' then
      update public.crm_newsletters set status='sending',started_at=coalesce(started_at,now()),updated_at=now() where id=v_row.id;
      insert into public.crm_automation_events (tenant_id,event_type,subject_domain,subject_id,occurred_at,payload)
      values (v_row.tenant_id,'newsletter.send_started','newsletter',v_row.id,now(),jsonb_build_object('newsletterId',v_row.id,'name',v_row.name));
    end if;
    v_rows := v_rows || jsonb_build_object('newsletterId',v_row.id,'tenantId',v_row.tenant_id,'name',v_row.name);
  end loop;
  return jsonb_build_object('newsletters',v_rows);
end;
$$;

create or replace function public.crm_claim_newsletter_recipients(p_newsletter_id uuid, p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_newsletter public.crm_newsletters;
  v_settings public.crm_resend_email_settings;
  v_claim uuid := gen_random_uuid();
  v_rows jsonb := '[]'::jsonb;
  v_recipient record;
  v_message public.crm_email_messages;
  v_message_id uuid;
  v_token text;
begin
  select * into v_newsletter from public.crm_newsletters where id=p_newsletter_id;
  if v_newsletter.id is null then raise exception 'Newsletter not found'; end if;
  if v_newsletter.status <> 'sending' then raise exception 'Only a sending newsletter can be claimed for delivery'; end if;
  if private.crm_newsletter_runtime_state(v_newsletter.tenant_id) <> 'ACTIVE'
     or not private.crm_control_plane_flag(v_newsletter.tenant_id,'communications_control_plane_enabled') then
    raise exception 'Newsletter delivery is not active';
  end if;

  select * into v_settings from public.crm_resend_email_settings where tenant_id=v_newsletter.tenant_id;
  if v_settings.connection_status <> 'connected' or v_settings.from_email is null or v_settings.postal_address is null then
    raise exception 'Connected Resend sender settings are required';
  end if;

  update public.crm_newsletter_recipients r
  set status='suppressed',suppression_reason=coalesce(s.reason,'Newsletter mailbox suppressed'),
      claim_token=null,claimed_at=null,updated_at=now()
  from public.crm_newsletter_suppressions s
  where r.newsletter_id=v_newsletter.id and r.status='pending'
    and s.tenant_id=r.tenant_id and s.mailbox_key=r.mailbox_key and s.revoked_at is null;

  update public.crm_newsletter_recipients r
  set status='skipped',suppression_reason='source_ineligible',error_code='source_ineligible',updated_at=now()
  where r.newsletter_id=v_newsletter.id and r.status='pending'
    and not exists (
      select 1 from private.crm_newsletter_candidates(r.tenant_id,r.qualifying_audiences) c
      where public.newsletter_mailbox_key(c.candidate_email)=r.mailbox_key
    );

  update public.crm_newsletter_recipients r
  set status='sent',sent_at=coalesce(r.sent_at,m.sent_at),claim_token=null,claimed_at=null,updated_at=now()
  from public.crm_email_messages m
  where r.newsletter_id=v_newsletter.id and r.status='pending'
    and m.newsletter_recipient_id=r.id and m.status in ('sent','delivered','delivery_delayed');

  update public.crm_newsletter_recipients
  set status='failed',error_code='max_attempts',error_message='Maximum newsletter delivery attempts reached',updated_at=now()
  where newsletter_id=v_newsletter.id and status='pending' and attempt_count>=5;

  update public.crm_newsletter_recipients r
  set status='processing',claim_token=v_claim,claimed_at=now(),attempt_count=r.attempt_count+1,
      last_attempt_at=now(),next_attempt_at=null,error_code=null,error_message=null,updated_at=now()
  where r.id in (
    select id from public.crm_newsletter_recipients
    where newsletter_id=v_newsletter.id and status='pending'
      and attempt_count<5 and (next_attempt_at is null or next_attempt_at<=now())
    order by created_at
    limit greatest(1,least(coalesce(p_limit,25),200))
    for update skip locked
  );

  for v_recipient in
    select * from public.crm_newsletter_recipients
    where newsletter_id=v_newsletter.id and claim_token=v_claim
    order by created_at
  loop
    select * into v_message from public.crm_email_messages where newsletter_recipient_id=v_recipient.id;
    if v_message.id is null then
      insert into public.crm_email_messages (
        tenant_id,client_id,newsletter_id,newsletter_recipient_id,direction,status,sender_email,recipient_email,
        reply_to_email,subject,body_html,body_text,preheader,render_hash,provider,message_class,source,occurred_at,
        template_version_id,metadata
      ) values (
        v_newsletter.tenant_id,null,v_newsletter.id,v_recipient.id,'outbound','queued',lower(btrim(v_settings.from_email)),
        lower(btrim(v_recipient.recipient_email)),nullif(lower(btrim(coalesce(v_settings.reply_to_email,''))),''),
        v_newsletter.subject,v_newsletter.body_html,v_newsletter.body_text,v_newsletter.preheader,v_newsletter.render_hash,
        'resend','marketing_newsletter','newsletter_worker',now(),v_newsletter.template_version_id,
        jsonb_build_object('newsletterId',v_newsletter.id,'newsletterRecipientId',v_recipient.id,'mailboxKey',v_recipient.mailbox_key,
                           'qualifyingAudiences',to_jsonb(v_recipient.qualifying_audiences),'personId',v_recipient.person_id,
                           'editorSchemaVersion',v_newsletter.editor_schema_version,'themeKey',v_newsletter.theme_key)
      ) returning id into v_message_id;
    else
      v_message_id := v_message.id;
      if v_message.status not in ('sent','delivered','delivery_delayed') then
        update public.crm_email_messages
        set status='queued',error_code=null,error_message=null,failed_at=null,updated_at=now()
        where id=v_message_id;
      end if;
    end if;

    update public.crm_newsletter_recipients set email_message_id=v_message_id,updated_at=now() where id=v_recipient.id;
    v_token := public.crm_issue_newsletter_unsubscribe_token(v_recipient.id);

    v_rows := v_rows || jsonb_build_object(
      'recipientId',v_recipient.id,'emailMessageId',v_message_id,'deliveryEmail',v_recipient.recipient_email,
      'mailboxKey',v_recipient.mailbox_key,'greetingName',coalesce(v_recipient.greeting_name,'Friend'),
      'qualifyingAudiences',to_jsonb(v_recipient.qualifying_audiences),'unsubscribeToken',v_token,
      'attempt',v_recipient.attempt_count,'claimToken',v_claim
    );
  end loop;

  return jsonb_build_object('newsletterId',v_newsletter.id,'claimToken',v_claim,
    'senderEmail',lower(btrim(v_settings.from_email)),'senderName',v_settings.from_name,
    'replyToEmail',v_settings.reply_to_email,'postalAddress',v_settings.postal_address,
    'subject',v_newsletter.subject,'preheader',v_newsletter.preheader,'bodyHtml',v_newsletter.body_html,
    'bodyText',v_newsletter.body_text,'renderHash',v_newsletter.render_hash,'recipients',v_rows);
end;
$$;

create or replace function public.crm_newsletter_recipient_send_guard(p_recipient_id uuid, p_claim_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient public.crm_newsletter_recipients;
  v_newsletter public.crm_newsletters;
  v_message public.crm_email_messages;
  v_suppression public.crm_newsletter_suppressions;
begin
  select * into v_recipient from public.crm_newsletter_recipients where id=p_recipient_id for update;
  if v_recipient.id is null then return jsonb_build_object('allowed',false,'reason','recipient_not_found'); end if;
  if v_recipient.status <> 'processing' or v_recipient.claim_token is distinct from p_claim_token then
    return jsonb_build_object('allowed',false,'reason','claim_not_owned');
  end if;
  select * into v_newsletter from public.crm_newsletters where id=v_recipient.newsletter_id;
  if v_newsletter.status <> 'sending' then
    update public.crm_newsletter_recipients set status='skipped',suppression_reason='newsletter_not_sending',claim_token=null,claimed_at=null,updated_at=now() where id=v_recipient.id;
    return jsonb_build_object('allowed',false,'reason','newsletter_not_sending');
  end if;
  if private.crm_newsletter_runtime_state(v_recipient.tenant_id) <> 'ACTIVE'
     or not private.crm_control_plane_flag(v_recipient.tenant_id,'communications_control_plane_enabled') then
    update public.crm_newsletter_recipients set status='pending',claim_token=null,claimed_at=null,next_attempt_at=now(),updated_at=now() where id=v_recipient.id;
    return jsonb_build_object('allowed',false,'reason','runtime_not_active');
  end if;

  select * into v_suppression from public.crm_newsletter_suppressions
  where tenant_id=v_recipient.tenant_id and mailbox_key=v_recipient.mailbox_key and revoked_at is null;
  if v_suppression.id is not null then
    update public.crm_newsletter_recipients
    set status='suppressed',suppression_reason=v_suppression.reason,claim_token=null,claimed_at=null,updated_at=now()
    where id=v_recipient.id;
    return jsonb_build_object('allowed',false,'reason','mailbox_suppressed');
  end if;

  if not exists (
    select 1 from private.crm_newsletter_candidates(v_recipient.tenant_id,v_recipient.qualifying_audiences) c
    where public.newsletter_mailbox_key(c.candidate_email)=v_recipient.mailbox_key
  ) then
    update public.crm_newsletter_recipients
    set status='skipped',suppression_reason='source_ineligible',error_code='source_ineligible',claim_token=null,claimed_at=null,updated_at=now()
    where id=v_recipient.id;
    return jsonb_build_object('allowed',false,'reason','source_ineligible');
  end if;

  select * into v_message from public.crm_email_messages where newsletter_recipient_id=v_recipient.id;
  if v_message.id is not null and v_message.status in ('sent','delivered','delivery_delayed') then
    update public.crm_newsletter_recipients
    set status='sent',sent_at=coalesce(sent_at,v_message.sent_at),claim_token=null,claimed_at=null,updated_at=now()
    where id=v_recipient.id;
    return jsonb_build_object('allowed',false,'reason','already_sent','emailMessageId',v_message.id);
  end if;

  return jsonb_build_object('allowed',true,'reason','eligible','emailMessageId',v_message.id);
end;
$$;

create or replace function public.crm_record_newsletter_send_attempt(
  p_recipient_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_error_message text default null,
  p_retry_after_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient public.crm_newsletter_recipients;
  v_retry integer;
begin
  if p_outcome not in ('sent','retry','failed') then raise exception 'Newsletter send outcome must be sent, retry, or failed'; end if;
  select * into v_recipient from public.crm_newsletter_recipients where id=p_recipient_id for update;
  if v_recipient.id is null then raise exception 'Newsletter recipient not found'; end if;

  if v_recipient.status='sent' and p_outcome='sent' then
    return jsonb_build_object('recipientId',v_recipient.id,'status','sent','idempotent',true);
  end if;
  if v_recipient.status <> 'processing' or v_recipient.claim_token is distinct from p_claim_token then
    raise exception 'Newsletter recipient claim is no longer owned by this worker' using errcode='55000';
  end if;

  if p_outcome='sent' then
    if nullif(btrim(coalesce(p_provider_message_id,'')),'') is null then raise exception 'Provider message ID is required for a sent outcome'; end if;
    update public.crm_newsletter_recipients
    set status='sent',provider_message_id=p_provider_message_id,sent_at=now(),error_code=null,error_message=null,
        claim_token=null,claimed_at=null,next_attempt_at=null,updated_at=now()
    where id=v_recipient.id;
    update public.crm_email_messages
    set status='sent',provider_message_id=p_provider_message_id,sent_at=coalesce(sent_at,now()),failed_at=null,
        error_code=null,error_message=null,occurred_at=now(),updated_at=now()
    where newsletter_recipient_id=v_recipient.id;
  elsif p_outcome='retry' then
    v_retry := greatest(60,least(coalesce(p_retry_after_seconds,300),3600));
    update public.crm_newsletter_recipients
    set status='pending',error_code=p_error_code,error_message=p_error_message,claim_token=null,claimed_at=null,
        next_attempt_at=now()+make_interval(secs=>v_retry),updated_at=now()
    where id=v_recipient.id;
    update public.crm_email_messages
    set status='queued',failed_at=null,error_code=p_error_code,error_message=p_error_message,updated_at=now()
    where newsletter_recipient_id=v_recipient.id;
  else
    update public.crm_newsletter_recipients
    set status='failed',error_code=p_error_code,error_message=p_error_message,claim_token=null,claimed_at=null,
        next_attempt_at=null,updated_at=now()
    where id=v_recipient.id;
    update public.crm_email_messages
    set status='failed',failed_at=now(),error_code=p_error_code,error_message=p_error_message,occurred_at=now(),updated_at=now()
    where newsletter_recipient_id=v_recipient.id;
  end if;

  return jsonb_build_object('recipientId',v_recipient.id,'status',case when p_outcome='retry' then 'pending' else p_outcome end,
                            'retryAfterSeconds',case when p_outcome='retry' then v_retry else null end);
end;
$$;

create or replace function public.crm_record_newsletter_send_result(
  p_recipient_id uuid,p_status text,p_provider_message_id text default null,p_error_code text default null,p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Legacy newsletter send-result recording has been retired. Use crm_record_newsletter_send_attempt with claim ownership.' using errcode='55000';
end;
$$;

create or replace function public.crm_release_stale_newsletter_claims(p_older_than_minutes integer default 15)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released integer := 0;
  v_cancelled integer := 0;
  v_cutoff timestamptz := now()-make_interval(mins=>greatest(1,coalesce(p_older_than_minutes,15)));
begin
  update public.crm_newsletter_recipients r
  set status='skipped',suppression_reason='newsletter_cancelled',claim_token=null,claimed_at=null,updated_at=now()
  from public.crm_newsletters n
  where r.newsletter_id=n.id and r.status='processing' and r.claimed_at<v_cutoff and n.status='cancelled';
  get diagnostics v_cancelled=row_count;

  update public.crm_newsletter_recipients r
  set status='pending',claim_token=null,claimed_at=null,next_attempt_at=now(),updated_at=now()
  from public.crm_newsletters n
  where r.newsletter_id=n.id and r.status='processing' and r.claimed_at<v_cutoff and n.status='sending';
  get diagnostics v_released=row_count;
  return jsonb_build_object('released',v_released,'cancelled',v_cancelled);
end;
$$;

create or replace function public.crm_finalize_newsletter(p_newsletter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_newsletter public.crm_newsletters;
  v_outstanding integer;
  v_sent integer;
  v_failed integer;
  v_suppressed integer;
  v_skipped integer;
begin
  select * into v_newsletter from public.crm_newsletters where id=p_newsletter_id for update;
  if v_newsletter.id is null then raise exception 'Newsletter not found'; end if;
  select count(*) filter (where status in ('pending','processing','queued')),
         count(*) filter (where status='sent'),count(*) filter (where status='failed'),
         count(*) filter (where status='suppressed'),count(*) filter (where status='skipped')
  into v_outstanding,v_sent,v_failed,v_suppressed,v_skipped
  from public.crm_newsletter_recipients where newsletter_id=v_newsletter.id;

  if v_outstanding>0 or v_newsletter.status<>'sending' then
    return jsonb_build_object('newsletterId',v_newsletter.id,'status',v_newsletter.status,'outstanding',v_outstanding,'finalized',false);
  end if;
  update public.crm_newsletters set status='completed',completed_at=now(),updated_at=now() where id=v_newsletter.id;
  insert into public.crm_automation_events (tenant_id,event_type,subject_domain,subject_id,occurred_at,payload)
  values (v_newsletter.tenant_id,'newsletter.send_completed','newsletter',v_newsletter.id,now(),
          jsonb_build_object('newsletterId',v_newsletter.id,'sent',v_sent,'failed',v_failed,'suppressed',v_suppressed,'skipped',v_skipped));
  return jsonb_build_object('newsletterId',v_newsletter.id,'status','completed','sent',v_sent,'failed',v_failed,
                            'suppressed',v_suppressed,'skipped',v_skipped,'finalized',true);
end;
$$;

create or replace function public.crm_record_newsletter_delivery_event(
  p_provider_message_id text,p_event text,p_occurred_at timestamptz default now(),p_error_code text default null,p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.crm_email_messages;
  v_status text;
  v_recipient public.crm_newsletter_recipients;
begin
  v_status := case p_event when 'delivered' then 'delivered' when 'delivery_delayed' then 'delivery_delayed'
                         when 'bounced' then 'bounced' when 'complained' then 'complained' when 'failed' then 'failed' else null end;
  if v_status is null then return jsonb_build_object('outcome','ignored_event','event',p_event); end if;
  select * into v_message from public.crm_email_messages
  where provider_message_id=nullif(btrim(coalesce(p_provider_message_id,'')),'') and newsletter_recipient_id is not null;
  if v_message.id is null then return jsonb_build_object('outcome','unknown_message'); end if;

  update public.crm_email_messages
  set status=v_status,
      delivered_at=case when v_status='delivered' then coalesce(p_occurred_at,now()) else delivered_at end,
      failed_at=case when v_status in ('bounced','complained','failed') then coalesce(p_occurred_at,now()) else failed_at end,
      error_code=coalesce(p_error_code,error_code),error_message=coalesce(p_error_message,error_message),
      occurred_at=coalesce(p_occurred_at,now()),updated_at=now()
  where id=v_message.id;

  update public.crm_newsletter_recipients
  set status=case when v_status in ('bounced','complained','failed') then 'failed' else status end,
      error_code=case when v_status in ('bounced','complained','failed') then coalesce(p_error_code,v_status) else error_code end,
      error_message=case when v_status in ('bounced','complained','failed') then coalesce(p_error_message,error_message) else error_message end,
      updated_at=now()
  where id=v_message.newsletter_recipient_id
  returning * into v_recipient;

  if v_status in ('bounced','complained') then
    insert into public.crm_newsletter_suppressions (
      tenant_id,mailbox_key,example_email,reason,reason_code,source,revoked_at,revoked_by_profile_id,revocation_reason
    ) values (
      v_recipient.tenant_id,v_recipient.mailbox_key,v_recipient.recipient_email,
      case when v_status='complained' then 'Newsletter complaint' else 'Newsletter hard bounce' end,
      case when v_status='complained' then 'complaint' else 'hard_bounce' end,
      case when v_status='complained' then 'complaint' else 'bounce' end,null,null,null
    )
    on conflict (tenant_id,mailbox_key) do update
    set reason=excluded.reason,reason_code=excluded.reason_code,source=excluded.source,
        revoked_at=null,revoked_by_profile_id=null,revocation_reason=null,updated_at=now();

    update public.crm_newsletter_recipients
    set status='suppressed',suppression_reason=case when v_status='complained' then 'Newsletter complaint' else 'Newsletter hard bounce' end,
        claim_token=null,claimed_at=null,updated_at=now()
    where tenant_id=v_recipient.tenant_id and mailbox_key=v_recipient.mailbox_key
      and id<>v_recipient.id and status in ('pending','queued','processing');
  end if;

  insert into public.crm_activity_events (tenant_id,event_type,metadata)
  values (v_message.tenant_id,'newsletter_delivery_event',jsonb_build_object(
    'newsletterId',v_message.newsletter_id,'newsletterRecipientId',v_message.newsletter_recipient_id,
    'emailMessageId',v_message.id,'event',p_event,'status',v_status));
  return jsonb_build_object('outcome','recorded','status',v_status,'emailMessageId',v_message.id);
end;
$$;

create or replace function public.crm_newsletter_delivery_readiness()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(false);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_runtime private.crm_newsletter_runtime;
  v_settings public.crm_resend_email_settings;
  v_cron boolean;
  v_acl boolean;
  v_global boolean;
  v_inflight integer;
  v_sender boolean;
  v_worker boolean;
  v_can_activate boolean;
begin
  select * into v_runtime from private.crm_newsletter_runtime where tenant_id=v_tenant;
  select * into v_settings from public.crm_resend_email_settings where tenant_id=v_tenant;
  select exists(select 1 from cron.job where jobname='newsletter-send-worker-every-5-min' and active) into v_cron;
  v_acl := not has_function_privilege('anon','public.crm_claim_due_newsletters(integer)','EXECUTE')
           and not has_function_privilege('authenticated','public.crm_claim_due_newsletters(integer)','EXECUTE')
           and not has_function_privilege('anon','public.crm_claim_newsletter_recipients(uuid,integer)','EXECUTE')
           and not has_function_privilege('authenticated','public.crm_claim_newsletter_recipients(uuid,integer)','EXECUTE')
           and has_function_privilege('service_role','public.crm_claim_due_newsletters(integer)','EXECUTE')
           and has_function_privilege('service_role','public.crm_claim_newsletter_recipients(uuid,integer)','EXECUTE');
  v_global := private.crm_control_plane_flag(v_tenant,'communications_control_plane_enabled');
  select count(*) into v_inflight from public.crm_newsletter_recipients where tenant_id=v_tenant and status='processing';
  v_sender := coalesce(v_settings.connection_status='connected',false)
              and nullif(btrim(coalesce(v_settings.from_email,'')),'') is not null
              and nullif(btrim(coalesce(v_settings.reply_to_email,'')),'') is not null
              and nullif(btrim(coalesce(v_settings.postal_address,'')),'') is not null;
  v_worker := v_runtime.worker_release is not null and v_runtime.worker_deployed_at is not null;
  v_can_activate := v_sender and v_worker and v_cron and v_acl and v_global and v_inflight=0;

  return jsonb_build_object(
    'runtimeState',coalesce(v_runtime.runtime_state,'PRELAUNCH'),
    'canActivate',v_can_activate,
    'checks',jsonb_build_object(
      'senderConfigured',v_sender,'workerReleaseMarked',v_worker,'schedulerPresent',v_cron,
      'workerRpcLeastPrivilege',v_acl,'communicationsControlPlaneEnabled',v_global,
      'inFlightRecipients',v_inflight,'suppressionInvariant',true,
      'supportedAudiences',jsonb_build_array('client','staff','donor','bty')
    )
  );
end;
$$;

create or replace function public.crm_get_newsletter_runtime()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(false);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_runtime private.crm_newsletter_runtime;
begin
  select * into v_runtime from private.crm_newsletter_runtime where tenant_id=v_tenant;
  return jsonb_build_object(
    'state',coalesce(v_runtime.runtime_state,'PRELAUNCH'),'reason',v_runtime.reason,
    'workerRelease',v_runtime.worker_release,'workerDeployedAt',v_runtime.worker_deployed_at,
    'schedulerInstalledAt',v_runtime.scheduler_installed_at,'activationVerifiedAt',v_runtime.activation_verified_at,
    'updatedAt',v_runtime.updated_at,'readiness',public.crm_newsletter_delivery_readiness()
  );
end;
$$;

create or replace function public.crm_set_newsletter_runtime(p_state text,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'actor_id')::uuid;
  v_state text := upper(btrim(coalesce(p_state,'')));
  v_runtime private.crm_newsletter_runtime;
  v_readiness jsonb;
begin
  if v_state not in ('PRELAUNCH','PAUSED','ACTIVE') then raise exception 'Newsletter runtime state must be PRELAUNCH, PAUSED, or ACTIVE'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'A reason is required to change newsletter runtime state'; end if;
  select * into v_runtime from private.crm_newsletter_runtime where tenant_id=v_tenant for update;
  if v_runtime.tenant_id is null then raise exception 'Newsletter runtime has not been initialized'; end if;

  if v_state='PAUSED' then
    if v_runtime.worker_release is null or not exists(select 1 from cron.job where jobname='newsletter-send-worker-every-5-min' and active) then
      raise exception 'PAUSED is only valid after the production worker and scheduler have been installed';
    end if;
  elsif v_state='ACTIVE' then
    v_readiness := public.crm_newsletter_delivery_readiness();
    if not coalesce((v_readiness->>'canActivate')::boolean,false) then
      raise exception 'Newsletter runtime cannot be activated until every delivery readiness check is green';
    end if;
  end if;

  update private.crm_newsletter_runtime
  set runtime_state=v_state,reason=btrim(p_reason),updated_by_profile_id=v_profile,
      activation_verified_at=case when v_state='ACTIVE' then now() else activation_verified_at end,
      updated_at=now()
  where tenant_id=v_tenant;

  insert into public.crm_activity_events (tenant_id,event_type,created_by_profile_id,metadata)
  values (v_tenant,'newsletter_runtime_changed',v_profile,
          jsonb_build_object('previousState',v_runtime.runtime_state,'newState',v_state,'reason',btrim(p_reason)));
  return jsonb_build_object('previousState',v_runtime.runtime_state,'state',v_state);
end;
$$;

create or replace function private.crm_mark_newsletter_runtime_components(
  p_tenant_id uuid,p_worker_release text,p_worker_deployed boolean,p_scheduler_installed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.crm_newsletter_runtime
  set worker_release=nullif(btrim(coalesce(p_worker_release,'')),''),
      worker_deployed_at=case when p_worker_deployed then coalesce(worker_deployed_at,now()) else null end,
      scheduler_installed_at=case when p_scheduler_installed then coalesce(scheduler_installed_at,now()) else null end,
      updated_at=now()
  where tenant_id=p_tenant_id;
  if not found then raise exception 'Newsletter runtime not initialized for tenant'; end if;
  return jsonb_build_object('tenantId',p_tenant_id,'workerRelease',nullif(btrim(coalesce(p_worker_release,'')),''),
                            'workerDeployed',p_worker_deployed,'schedulerInstalled',p_scheduler_installed);
end;
$$;

revoke all on function public.crm_build_newsletter_recipients(uuid,text) from public, anon;
grant execute on function public.crm_build_newsletter_recipients(uuid,text) to authenticated, service_role;
revoke all on function public.crm_schedule_newsletter(uuid,timestamptz,text) from public, anon;
grant execute on function public.crm_schedule_newsletter(uuid,timestamptz,text) to authenticated, service_role;
revoke all on function public.crm_clone_newsletter_to_draft(uuid,text,text) from public, anon;
grant execute on function public.crm_clone_newsletter_to_draft(uuid,text,text) to authenticated, service_role;
revoke all on function public.crm_cancel_newsletter_send(uuid,text) from public, anon;
grant execute on function public.crm_cancel_newsletter_send(uuid,text) to authenticated, service_role;
revoke all on function public.crm_newsletter_delivery_trace(uuid,integer) from public, anon;
grant execute on function public.crm_newsletter_delivery_trace(uuid,integer) to authenticated, service_role;
revoke all on function public.crm_newsletter_delivery_readiness() from public, anon;
grant execute on function public.crm_newsletter_delivery_readiness() to authenticated, service_role;
revoke all on function public.crm_get_newsletter_runtime() from public, anon;
grant execute on function public.crm_get_newsletter_runtime() to authenticated, service_role;
revoke all on function public.crm_set_newsletter_runtime(text,text) from public, anon;
grant execute on function public.crm_set_newsletter_runtime(text,text) to authenticated, service_role;

revoke all on function public.crm_claim_due_newsletters(integer) from public, anon, authenticated;
grant execute on function public.crm_claim_due_newsletters(integer) to service_role;
revoke all on function public.crm_claim_newsletter_recipients(uuid,integer) from public, anon, authenticated;
grant execute on function public.crm_claim_newsletter_recipients(uuid,integer) to service_role;
revoke all on function public.crm_newsletter_recipient_send_guard(uuid,uuid) from public, anon, authenticated;
grant execute on function public.crm_newsletter_recipient_send_guard(uuid,uuid) to service_role;
revoke all on function public.crm_record_newsletter_send_attempt(uuid,uuid,text,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.crm_record_newsletter_send_attempt(uuid,uuid,text,text,text,text,integer) to service_role;
revoke all on function public.crm_record_newsletter_send_result(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.crm_record_newsletter_send_result(uuid,text,text,text,text) to service_role;
revoke all on function public.crm_release_stale_newsletter_claims(integer) from public, anon, authenticated;
grant execute on function public.crm_release_stale_newsletter_claims(integer) to service_role;
revoke all on function public.crm_finalize_newsletter(uuid) from public, anon, authenticated;
grant execute on function public.crm_finalize_newsletter(uuid) to service_role;
revoke all on function public.crm_record_newsletter_delivery_event(text,text,timestamptz,text,text) from public, anon, authenticated;
grant execute on function public.crm_record_newsletter_delivery_event(text,text,timestamptz,text,text) to service_role;
revoke all on function private.crm_mark_newsletter_runtime_components(uuid,text,boolean,boolean) from public, anon, authenticated;
grant execute on function private.crm_mark_newsletter_runtime_components(uuid,text,boolean,boolean) to service_role;
