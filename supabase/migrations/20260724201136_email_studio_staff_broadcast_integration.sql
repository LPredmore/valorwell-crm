-- Email Studio Pass 10: canonical internal staff broadcasts.

alter table public.crm_bulk_send_staff_recipients
  add column if not exists email_message_id uuid references public.crm_email_messages(id) on delete set null,
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz;

alter table public.crm_bulk_send_staff_recipients
  drop constraint if exists crm_bulk_send_staff_recipients_status_check;

alter table public.crm_bulk_send_staff_recipients
  add constraint crm_bulk_send_staff_recipients_status_check
  check (status = any (array['pending','processing','sent','failed']::text[]));

create unique index if not exists crm_bulk_send_staff_recipients_bulk_staff_key
  on public.crm_bulk_send_staff_recipients(bulk_send_id, staff_id);

create index if not exists crm_bulk_send_staff_recipients_claim_queue_idx
  on public.crm_bulk_send_staff_recipients(bulk_send_id, status, claimed_at, id);

create index if not exists crm_bulk_send_staff_recipients_email_message_idx
  on public.crm_bulk_send_staff_recipients(email_message_id)
  where email_message_id is not null;

create or replace function public.validate_crm_bulk_send_email_studio()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.editor_document is null then
    if tg_op = 'INSERT' and new.recipient_type in ('client','staff') then
      raise exception 'New bulk sends require canonical Newsletter-mode Email Studio content' using errcode = '23514';
    end if;
    if new.content_mode is not null
      or new.preheader is not null
      or new.theme_key is not null
      or new.editor_schema_version is not null
      or new.render_hash is not null
      or new.template_version_id is not null then
      raise exception 'Legacy bulk sends cannot contain partial Email Studio fields' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.recipient_type not in ('client','staff') then
    raise exception 'Canonical bulk-send recipient type is invalid' using errcode = '23514';
  end if;
  if new.content_mode is distinct from 'newsletter' then
    raise exception 'Canonical bulk email must use newsletter mode' using errcode = '23514';
  end if;
  if nullif(btrim(new.subject), '') is null
    or nullif(btrim(new.body_html), '') is null
    or nullif(btrim(new.body_text), '') is null then
    raise exception 'Canonical bulk subject, HTML, and text are required' using errcode = '23514';
  end if;

  if new.recipient_type = 'client' and not jsonb_path_exists(
    new.editor_document,
    '$.** ? (@.type == "emailStudioBlock" && @.attrs.kind == "compliance-footer")'
  ) then
    raise exception 'Canonical client newsletters require a compliance footer block' using errcode = '23514';
  end if;

  if new.recipient_type = 'staff' and new.template_version_id is not null then
    raise exception 'Staff broadcast template attribution is not enabled in this pass' using errcode = '23514';
  end if;

  if new.recipient_type = 'client' and new.template_version_id is not null and not exists (
    select 1
    from public.crm_email_template_versions version
    where version.tenant_id = new.tenant_id
      and version.id = new.template_version_id
      and version.content_scope = 'client'
      and version.content_mode = 'newsletter'
  ) then
    raise exception 'Newsletter template version is invalid for this tenant and scope' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_crm_bulk_send_email_studio() from public, anon, authenticated;

drop trigger if exists validate_crm_bulk_send_email_studio_trigger on public.crm_bulk_send_logs;
create trigger validate_crm_bulk_send_email_studio_trigger
before insert or update of
  tenant_id, recipient_type, subject, body_html, body_text, editor_document,
  preheader, content_mode, theme_key, editor_schema_version, render_hash,
  template_version_id
on public.crm_bulk_send_logs
for each row execute function public.validate_crm_bulk_send_email_studio();

create or replace function public.crm_create_bulk_staff_broadcast(
  p_tenant_id uuid,
  p_staff_ids uuid[],
  p_subject text,
  p_content jsonb
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
begin
  if v_actor is null or not exists (
    select 1
    from public.crm_user_capabilities capability
    where capability.profile_id = v_actor
      and capability.tenant_id = p_tenant_id
      and capability.crm_role in ('crm_admin','crm_operator')
  ) then
    raise exception 'Not authorized for tenant %', p_tenant_id using errcode = '42501';
  end if;

  if p_staff_ids is null or cardinality(p_staff_ids) = 0 then
    raise exception 'At least one staff recipient is required' using errcode = '22023';
  end if;

  select count(distinct staff_id)
    into v_requested_count
  from unnest(p_staff_ids) as selected(staff_id)
  where staff_id is not null;

  if v_requested_count = 0 or v_requested_count > 500 then
    raise exception 'Staff broadcast recipient count must be between 1 and 500' using errcode = '22023';
  end if;
  if nullif(btrim(p_subject), '') is null then
    raise exception 'Staff broadcast subject is required' using errcode = '23514';
  end if;
  if jsonb_typeof(p_content) <> 'object'
    or p_content->>'mode' <> 'newsletter'
    or jsonb_typeof(p_content->'editorDocument') <> 'object'
    or p_content->'editorDocument'->>'type' <> 'doc'
    or jsonb_typeof(p_content->'editorDocument'->'content') <> 'array'
    or nullif(btrim(p_content->>'renderedHtml'), '') is null
    or nullif(btrim(p_content->>'renderedText'), '') is null
    or nullif(btrim(p_content->>'themeKey'), '') is null
    or coalesce((p_content->>'schemaVersion')::integer, 0) < 1
    or coalesce(p_content->>'renderHash', '') !~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$' then
    raise exception 'Canonical staff Newsletter-mode content is invalid' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.crm_resend_email_settings settings
    where settings.tenant_id = p_tenant_id
      and settings.connection_status = 'connected'
      and nullif(btrim(settings.from_email), '') is not null
  ) then
    raise exception 'Verified Resend sender settings are required' using errcode = '23514';
  end if;

  select count(*)
    into v_eligible_count
  from public.staff staff_member
  join public.profiles profile on profile.id = staff_member.profile_id
  where staff_member.tenant_id = p_tenant_id
    and staff_member.id in (
      select distinct selected.staff_id
      from unnest(p_staff_ids) as selected(staff_id)
      where selected.staff_id is not null
    )
    and staff_member.prov_status <> 'Inactive'
    and lower(btrim(profile.email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';

  if v_eligible_count <> v_requested_count then
    raise exception 'One or more selected staff recipients is inactive or lacks a valid email address' using errcode = '23514';
  end if;

  insert into public.crm_bulk_send_logs (
    id, tenant_id, recipient_type, subject, body_html, body_text,
    editor_document, preheader, content_mode, theme_key,
    editor_schema_version, render_hash, status, recipient_count,
    sent_count, failed_count, created_by_profile_id
  ) values (
    v_bulk_send_id, p_tenant_id, 'staff', btrim(p_subject),
    p_content->>'renderedHtml', p_content->>'renderedText',
    p_content->'editorDocument', nullif(p_content->>'preheader', ''),
    'newsletter', p_content->>'themeKey',
    (p_content->>'schemaVersion')::integer, p_content->>'renderHash',
    'pending', v_requested_count, 0, 0, v_actor
  );

  insert into public.crm_bulk_send_staff_recipients (
    tenant_id, bulk_send_id, staff_id, status
  )
  select p_tenant_id, v_bulk_send_id, selected.staff_id, 'pending'
  from (
    select distinct staff_id
    from unnest(p_staff_ids) as requested(staff_id)
    where staff_id is not null
  ) selected;

  return jsonb_build_object(
    'bulk_send_id', v_bulk_send_id,
    'recipient_count', v_requested_count
  );
end;
$$;

revoke all on function public.crm_create_bulk_staff_broadcast(uuid, uuid[], text, jsonb) from public, anon, authenticated;
grant execute on function public.crm_create_bulk_staff_broadcast(uuid, uuid[], text, jsonb) to authenticated, service_role;

create or replace function public.crm_claim_bulk_staff_recipients(
  p_tenant_id uuid,
  p_bulk_send_id uuid,
  p_limit integer default 25
)
returns table (
  id uuid,
  staff_id uuid,
  email_message_id uuid,
  claim_token uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_limit < 1 or p_limit > 50 then
    raise exception 'Claim limit must be between 1 and 50' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.crm_bulk_send_logs job
    where job.id = p_bulk_send_id
      and job.tenant_id = p_tenant_id
      and job.recipient_type = 'staff'
      and job.editor_document is not null
      and job.content_mode = 'newsletter'
  ) then
    raise exception 'Canonical staff broadcast job not found' using errcode = '42704';
  end if;

  return query
  with candidates as (
    select recipient.id
    from public.crm_bulk_send_staff_recipients recipient
    where recipient.tenant_id = p_tenant_id
      and recipient.bulk_send_id = p_bulk_send_id
      and (
        recipient.status = 'pending'
        or (recipient.status = 'processing' and recipient.claimed_at < now() - interval '10 minutes')
      )
    order by recipient.id
    for update skip locked
    limit p_limit
  )
  update public.crm_bulk_send_staff_recipients recipient
  set status = 'processing',
      claim_token = gen_random_uuid(),
      claimed_at = now()
  from candidates
  where recipient.id = candidates.id
  returning recipient.id, recipient.staff_id, recipient.email_message_id, recipient.claim_token;
end;
$$;

revoke all on function public.crm_claim_bulk_staff_recipients(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.crm_claim_bulk_staff_recipients(uuid, uuid, integer) to service_role;
