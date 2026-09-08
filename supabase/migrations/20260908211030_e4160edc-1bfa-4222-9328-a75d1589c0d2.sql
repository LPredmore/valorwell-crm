-- Repair newsletter automation-event writes: use current crm_emit_automation_event
-- schema (subject_type/source/idempotency_key) instead of removed subject_domain.

CREATE OR REPLACE FUNCTION public.crm_upsert_newsletter_canonical(p_newsletter_id uuid, p_name text, p_subject text, p_content jsonb, p_audience_domains text[], p_reason text, p_template_version_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'actor_id')::uuid;
  v_domains text[] := coalesce(p_audience_domains, array['client']::text[]);
  v_existing public.crm_newsletters;
  v_id uuid;
  v_created boolean := false;
  v_schema integer;
  v_doc jsonb;
  v_html text;
  v_text text;
  v_preheader text;
  v_theme text;
  v_hash text;
begin
  if coalesce(btrim(p_reason),'')='' then raise exception 'A reason is required to create or change a newsletter'; end if;
  if coalesce(btrim(p_name),'')='' then raise exception 'A newsletter needs a name'; end if;
  if coalesce(btrim(p_subject),'')='' then raise exception 'A newsletter needs a subject'; end if;
  if array_length(v_domains,1) is null then raise exception 'Select at least one audience for this newsletter'; end if;
  if exists (select 1 from unnest(v_domains) d where d not in ('client','staff','donor','bty')) then
    raise exception 'Unsupported newsletter audience selected. Supported audiences are client, staff, donor, and bty.';
  end if;
  if p_content is null or coalesce(p_content->>'mode','') <> 'newsletter' then
    raise exception 'Canonical marketing newsletter content in newsletter mode is required';
  end if;

  v_schema := nullif(p_content->>'schemaVersion','')::integer;
  v_doc := p_content->'editorDocument';
  v_html := nullif(p_content->>'renderedHtml','');
  v_text := nullif(p_content->>'renderedText','');
  v_preheader := nullif(btrim(coalesce(p_content->>'preheader','')),'');
  v_theme := nullif(btrim(coalesce(p_content->>'themeKey','')),'');
  v_hash := nullif(btrim(coalesce(p_content->>'renderHash','')),'');

  if v_schema is null or v_schema < 1 or v_doc is null
     or jsonb_typeof(v_doc) <> 'object' or v_doc->>'type' <> 'doc'
     or jsonb_typeof(v_doc->'content') <> 'array'
     or v_html is null or v_text is null or v_theme is null or v_hash is null
     or v_hash !~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$' then
    raise exception 'Canonical Email Studio content is incomplete or invalid';
  end if;

  if p_template_version_id is not null and not exists (
    select 1 from public.crm_email_template_versions tv
    where tv.id=p_template_version_id and tv.tenant_id=v_tenant
      and tv.content_scope='marketing_newsletter' and tv.content_mode='newsletter'
  ) then
    raise exception 'Template version is not a published marketing newsletter version for this tenant';
  end if;

  if p_newsletter_id is null then
    insert into public.crm_newsletters (
      tenant_id,name,subject,preheader,body_html,body_text,template_version_id,audience_domains,status,
      created_by_profile_id,metadata,editor_document,editor_schema_version,theme_key,render_hash
    ) values (
      v_tenant,btrim(p_name),btrim(p_subject),v_preheader,v_html,v_text,p_template_version_id,v_domains,'draft',
      v_profile,jsonb_build_object('contentSource','email_studio','contentScope','marketing_newsletter'),
      v_doc,v_schema,v_theme,v_hash
    ) returning id into v_id;
    v_created := true;
  else
    select * into v_existing from public.crm_newsletters where id=p_newsletter_id and tenant_id=v_tenant;
    if v_existing.id is null then raise exception 'Newsletter not found for this tenant'; end if;
    if v_existing.status <> 'draft' then raise exception 'Only a draft newsletter can be edited. Revise a scheduled newsletter by cloning it to a new draft.'; end if;
    update public.crm_newsletters
    set name=btrim(p_name), subject=btrim(p_subject), preheader=v_preheader,
        body_html=v_html, body_text=v_text, template_version_id=p_template_version_id,
        audience_domains=v_domains, editor_document=v_doc, editor_schema_version=v_schema,
        theme_key=v_theme, render_hash=v_hash,
        metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('contentSource','email_studio','contentScope','marketing_newsletter'),
        updated_at=now()
    where id=v_existing.id returning id into v_id;
  end if;

  perform public.crm_emit_automation_event(
    v_tenant,
    case when v_created then 'newsletter.created' else 'newsletter.updated' end,
    'newsletter',
    v_id,
    'newsletter:' || (case when v_created then 'created' else 'updated' end) || ':' || v_id::text || ':' || gen_random_uuid()::text,
    jsonb_build_object('newsletterId',v_id,'audienceDomains',to_jsonb(v_domains),'reason',btrim(p_reason),'actorProfileId',v_profile,'contentSource','email_studio','renderHash',v_hash),
    'database'
  );

  return jsonb_build_object('newsletterId',v_id,'created',v_created,'canonical',true,'renderHash',v_hash);
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_upsert_newsletter(p_newsletter_id uuid, p_name text, p_subject text, p_preheader text, p_body_html text, p_body_text text, p_audience_domains text[], p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'actor_id')::uuid;
  v_domains text[] := coalesce(p_audience_domains, array['client']::text[]);
  v_existing public.crm_newsletters;
  v_id uuid;
  v_created boolean := false;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to create or change a newsletter'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'A newsletter needs a name'; end if;
  if array_length(v_domains, 1) is null then raise exception 'Select at least one audience for this newsletter'; end if;
  if exists (select 1 from unnest(v_domains) d where d not in ('client','staff','donor','bty')) then
    raise exception 'Unsupported newsletter audience selected. Supported audiences are client, staff, donor, and bty.';
  end if;

  if p_newsletter_id is null then
    insert into public.crm_newsletters (
      tenant_id, name, subject, preheader, body_html, body_text,
      audience_domains, status, created_by_profile_id, metadata
    ) values (
      v_tenant, btrim(p_name), nullif(btrim(coalesce(p_subject,'')),''),
      nullif(btrim(coalesce(p_preheader,'')),''), nullif(p_body_html,''), nullif(p_body_text,''),
      v_domains, 'draft', v_profile, jsonb_build_object('contentSource','legacy_composer')
    ) returning id into v_id;
    v_created := true;
  else
    select * into v_existing from public.crm_newsletters
    where id=p_newsletter_id and tenant_id=v_tenant;
    if v_existing.id is null then raise exception 'Newsletter not found for this tenant'; end if;
    if v_existing.status <> 'draft' then raise exception 'Only a draft newsletter can be edited'; end if;
    if v_existing.editor_document is not null then
      raise exception 'Canonical newsletter drafts must be edited through Email Studio';
    end if;
    update public.crm_newsletters
    set name=btrim(p_name), subject=nullif(btrim(coalesce(p_subject,'')),''),
        preheader=nullif(btrim(coalesce(p_preheader,'')),''),
        body_html=nullif(p_body_html,''), body_text=nullif(p_body_text,''),
        audience_domains=v_domains,
        metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('contentSource','legacy_composer'),
        updated_at=now()
    where id=v_existing.id returning id into v_id;
  end if;

  perform public.crm_emit_automation_event(
    v_tenant,
    case when v_created then 'newsletter.created' else 'newsletter.updated' end,
    'newsletter',
    v_id,
    'newsletter:' || (case when v_created then 'created' else 'updated' end) || ':' || v_id::text || ':' || gen_random_uuid()::text,
    jsonb_build_object('newsletterId',v_id,'audienceDomains',to_jsonb(v_domains),'reason',btrim(p_reason),'actorProfileId',v_profile,'contentSource','legacy_composer'),
    'database'
  );

  return jsonb_build_object('newsletterId',v_id,'created',v_created,'canonical',false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_clone_newsletter_to_draft(p_newsletter_id uuid, p_name text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  perform public.crm_emit_automation_event(
    v_tenant,'newsletter.revised','newsletter',v_id,
    'newsletter:revised:' || v_id::text,
    jsonb_build_object('newsletterId',v_id,'revisedFromNewsletterId',v_source.id,'reason',btrim(p_reason),'actorProfileId',v_profile),
    'database'
  );
  return jsonb_build_object('newsletterId',v_id,'revisedFromNewsletterId',v_source.id,'status','draft');
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_schedule_newsletter(p_newsletter_id uuid, p_scheduled_at timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

CREATE OR REPLACE FUNCTION public.crm_cancel_newsletter_send(p_newsletter_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'profile_id')::uuid;
  v_newsletter public.crm_newsletters;
  v_stopped integer := 0;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to cancel a newsletter send';
  end if;

  select * into v_newsletter
  from public.crm_newsletters
  where id = p_newsletter_id and tenant_id = v_tenant;
  if v_newsletter.id is null then
    raise exception 'Newsletter not found for this tenant';
  end if;
  if v_newsletter.status not in ('scheduled', 'sending') then
    raise exception 'Only a scheduled or sending newsletter can be cancelled';
  end if;

  -- recipients already handed to the provider keep their outcome; only
  -- untouched ones are stood down
  update public.crm_newsletter_recipients
  set status = 'skipped',
      suppression_reason = 'send_cancelled',
      claim_token = null,
      updated_at = now()
  where newsletter_id = v_newsletter.id and status = 'pending';
  get diagnostics v_stopped = row_count;

  update public.crm_newsletters
  set status = 'cancelled',
      completed_at = now(),
      updated_at = now()
  where id = v_newsletter.id;

  perform public.crm_emit_automation_event(
    v_tenant,'newsletter.cancelled','newsletter',v_newsletter.id,
    'newsletter:cancelled:' || v_newsletter.id::text || ':' || gen_random_uuid()::text,
    jsonb_build_object(
      'newsletterId', v_newsletter.id,
      'stoodDownRecipients', v_stopped,
      'reason', btrim(p_reason),
      'actorProfileId', v_profile
    ),
    'database'
  );

  return jsonb_build_object(
    'newsletterId', v_newsletter.id,
    'status', 'cancelled',
    'stoodDownRecipients', v_stopped
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_claim_due_newsletters(p_limit integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      perform public.crm_emit_automation_event(
        v_row.tenant_id,'newsletter.send_started','newsletter',v_row.id,
        'newsletter:send_started:' || v_row.id::text,
        jsonb_build_object('newsletterId',v_row.id,'name',v_row.name),
        'database'
      );
    end if;
    v_rows := v_rows || jsonb_build_object('newsletterId',v_row.id,'tenantId',v_row.tenant_id,'name',v_row.name);
  end loop;
  return jsonb_build_object('newsletters',v_rows);
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_finalize_newsletter(p_newsletter_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform public.crm_emit_automation_event(
    v_newsletter.tenant_id,'newsletter.send_completed','newsletter',v_newsletter.id,
    'newsletter:send_completed:' || v_newsletter.id::text,
    jsonb_build_object('newsletterId',v_newsletter.id,'sent',v_sent,'failed',v_failed,'suppressed',v_suppressed,'skipped',v_skipped),
    'database'
  );
  return jsonb_build_object('newsletterId',v_newsletter.id,'status','completed','sent',v_sent,'failed',v_failed,
                            'suppressed',v_suppressed,'skipped',v_skipped,'finalized',true);
end;
$function$;