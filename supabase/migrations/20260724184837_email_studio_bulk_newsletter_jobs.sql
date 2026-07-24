-- Email Studio Pass 9: transactional newsletter jobs and leased client-recipient claims.

create or replace function public.crm_create_bulk_newsletter(
  p_tenant_id uuid,
  p_client_ids uuid[],
  p_subject text,
  p_content jsonb,
  p_template_id uuid default null,
  p_template_version_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_bulk_send_id uuid := gen_random_uuid();
  v_requested_count integer;
  v_eligible_count integer;
  v_actual_template_id uuid;
  v_version record;
begin
  if v_actor is null or not exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = v_actor and capability.tenant_id = p_tenant_id
      and capability.crm_role in ('crm_admin','crm_operator')
  ) then raise exception 'Not authorized for tenant %', p_tenant_id using errcode = '42501'; end if;
  if p_client_ids is null or cardinality(p_client_ids) = 0 then raise exception 'At least one client is required' using errcode = '22023'; end if;
  select count(distinct client_id) into v_requested_count from unnest(p_client_ids) as selected(client_id) where client_id is not null;
  if v_requested_count = 0 or v_requested_count > 500 then raise exception 'Newsletter recipient count must be between 1 and 500' using errcode = '22023'; end if;
  if nullif(btrim(p_subject), '') is null then raise exception 'Newsletter subject is required' using errcode = '23514'; end if;
  if jsonb_typeof(p_content) <> 'object'
    or p_content->>'mode' <> 'newsletter'
    or jsonb_typeof(p_content->'editorDocument') <> 'object'
    or p_content->'editorDocument'->>'type' <> 'doc'
    or jsonb_typeof(p_content->'editorDocument'->'content') <> 'array'
    or nullif(btrim(p_content->>'renderedHtml'), '') is null
    or nullif(btrim(p_content->>'renderedText'), '') is null
    or nullif(btrim(p_content->>'themeKey'), '') is null
    or coalesce((p_content->>'schemaVersion')::integer, 0) < 1
    or coalesce(p_content->>'renderHash', '') !~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$'
  then raise exception 'Canonical Newsletter-mode content is invalid' using errcode = '23514'; end if;
  if not jsonb_path_exists(p_content->'editorDocument', '$.** ? (@.type == "emailStudioBlock" && @.attrs.kind == "compliance-footer")') then
    raise exception 'Newsletter content requires a compliance footer block' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.crm_resend_email_settings settings
    where settings.tenant_id = p_tenant_id and settings.connection_status = 'connected'
      and nullif(btrim(settings.from_email), '') is not null
      and nullif(btrim(settings.postal_address), '') is not null
  ) then raise exception 'Verified Resend settings and a mailing address are required' using errcode = '23514'; end if;
  select count(*) into v_eligible_count
  from public.clients client
  where client.tenant_id = p_tenant_id
    and client.id in (select distinct selected.client_id from unnest(p_client_ids) as selected(client_id) where selected.client_id is not null)
    and nullif(btrim(client.email), '') is not null
    and client.contact_policy = 'normal'
    and client.service_policy = 'normal'
    and client.lifecycle_stage <> 'closed';
  if v_eligible_count <> v_requested_count then raise exception 'One or more selected clients is not currently eligible for ordinary newsletter outreach' using errcode = '23514'; end if;
  if p_template_version_id is not null then
    select * into v_version from public.crm_email_template_versions version
    where version.tenant_id = p_tenant_id and version.id = p_template_version_id
      and version.content_scope = 'client' and version.content_mode = 'newsletter';
    if not found then raise exception 'Newsletter template version is invalid for this tenant and scope' using errcode = '23514'; end if;
    v_actual_template_id := v_version.template_id;
    if p_template_id is not null and p_template_id <> v_actual_template_id then raise exception 'Template and template-version identities do not match' using errcode = '23514'; end if;
    if v_version.subject <> btrim(p_subject)
      or v_version.editor_document <> p_content->'editorDocument'
      or v_version.rendered_html <> p_content->>'renderedHtml'
      or v_version.rendered_text <> p_content->>'renderedText'
      or coalesce(v_version.preheader, '') <> coalesce(p_content->>'preheader', '')
      or v_version.theme_key <> p_content->>'themeKey'
      or v_version.editor_schema_version <> (p_content->>'schemaVersion')::integer
      or v_version.render_hash <> p_content->>'renderHash'
    then raise exception 'Newsletter content no longer matches the attributed template version' using errcode = '23514'; end if;
  elsif p_template_id is not null then raise exception 'Template identity requires a template version' using errcode = '23514'; end if;
  insert into public.crm_bulk_send_logs (
    id, tenant_id, recipient_type, subject, body_html, body_text, editor_document, preheader,
    content_mode, theme_key, editor_schema_version, render_hash, template_id, template_version_id,
    status, recipient_count, sent_count, failed_count, created_by_profile_id
  ) values (
    v_bulk_send_id, p_tenant_id, 'client', btrim(p_subject), p_content->>'renderedHtml', p_content->>'renderedText',
    p_content->'editorDocument', nullif(p_content->>'preheader', ''), 'newsletter', p_content->>'themeKey',
    (p_content->>'schemaVersion')::integer, p_content->>'renderHash', coalesce(p_template_id, v_actual_template_id),
    p_template_version_id, 'pending', v_requested_count, 0, 0, v_actor
  );
  insert into public.crm_bulk_send_recipients (tenant_id, bulk_send_id, client_id, status)
  select p_tenant_id, v_bulk_send_id, selected.client_id, 'pending'
  from (select distinct client_id from unnest(p_client_ids) as requested(client_id) where client_id is not null) selected;
  return jsonb_build_object('bulk_send_id', v_bulk_send_id, 'recipient_count', v_requested_count);
end;
$$;
revoke all on function public.crm_create_bulk_newsletter(uuid, uuid[], text, jsonb, uuid, uuid) from public;
grant execute on function public.crm_create_bulk_newsletter(uuid, uuid[], text, jsonb, uuid, uuid) to authenticated, service_role;

create or replace function public.crm_claim_bulk_client_recipients(p_tenant_id uuid, p_bulk_send_id uuid, p_limit integer default 25)
returns table (id uuid, client_id uuid, email_message_id uuid, claim_token uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_limit < 1 or p_limit > 50 then raise exception 'Claim limit must be between 1 and 50' using errcode = '22023'; end if;
  if not exists (select 1 from public.crm_bulk_send_logs job where job.id = p_bulk_send_id and job.tenant_id = p_tenant_id and job.recipient_type = 'client') then
    raise exception 'Client bulk-send job not found' using errcode = '42704';
  end if;
  return query
  with candidates as (
    select recipient.id from public.crm_bulk_send_recipients recipient
    where recipient.tenant_id = p_tenant_id and recipient.bulk_send_id = p_bulk_send_id
      and (recipient.status = 'pending' or (recipient.status = 'processing' and recipient.claimed_at < now() - interval '10 minutes'))
    order by recipient.id for update skip locked limit p_limit
  )
  update public.crm_bulk_send_recipients recipient
  set status = 'processing', claim_token = gen_random_uuid(), claimed_at = now()
  from candidates where recipient.id = candidates.id
  returning recipient.id, recipient.client_id, recipient.email_message_id, recipient.claim_token;
end;
$$;
revoke all on function public.crm_claim_bulk_client_recipients(uuid, uuid, integer) from public;
grant execute on function public.crm_claim_bulk_client_recipients(uuid, uuid, integer) to service_role;
