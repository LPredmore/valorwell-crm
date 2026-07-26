-- Email Studio Pass 11: staff template lifecycle and immutable attribution.

alter table public.crm_email_templates
  drop constraint if exists crm_email_templates_scope_check;
alter table public.crm_email_templates
  add constraint crm_email_templates_scope_check
  check (content_scope = any (array['client','relationship','staff']::text[]));

alter table public.crm_email_template_versions
  drop constraint if exists crm_email_template_versions_scope_check;
alter table public.crm_email_template_versions
  add constraint crm_email_template_versions_scope_check
  check (content_scope = any (array['client','relationship','staff']::text[]));

create or replace function public.crm_email_template_save_draft(
  p_template_id uuid,
  p_name text,
  p_description text,
  p_subject text,
  p_content_scope text,
  p_content_mode text,
  p_editor_document jsonb,
  p_body_html text,
  p_body_text text,
  p_preheader text,
  p_theme_key text,
  p_editor_schema_version integer,
  p_render_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_profile_id uuid := auth.uid();
  v_tenant_id uuid;
  v_existing public.crm_email_templates%rowtype;
  v_saved public.crm_email_templates%rowtype;
begin
  if v_profile_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;
  v_tenant_id := private.valorwell_current_staff_tenant_id();
  if v_tenant_id is null or not exists (
    select 1 from public.crm_user_capabilities
    where tenant_id = v_tenant_id and profile_id = v_profile_id
      and crm_role in ('crm_admin'::public.crm_capability_role, 'crm_operator'::public.crm_capability_role)
  ) then
    raise exception using errcode = '42501', message = 'CRM admin or operator access is required.';
  end if;

  if nullif(btrim(p_name), '') is null then raise exception using errcode='22023', message='Template name is required.'; end if;
  if nullif(btrim(p_subject), '') is null then raise exception using errcode='22023', message='Template subject is required.'; end if;
  if p_content_scope not in ('client', 'relationship', 'staff') then raise exception using errcode='22023', message='Template content scope is invalid.'; end if;
  if p_content_mode not in ('direct', 'campaign', 'newsletter') then raise exception using errcode='22023', message='Template content mode is invalid.'; end if;
  if p_content_scope = 'staff' and p_content_mode <> 'newsletter' then
    raise exception using errcode='22023', message='Staff templates must use Newsletter mode.';
  end if;
  if p_editor_document is null or jsonb_typeof(p_editor_document) <> 'object'
     or p_editor_document ->> 'type' <> 'doc' or jsonb_typeof(p_editor_document -> 'content') <> 'array' then
    raise exception using errcode='22023', message='Canonical editor JSON is required.';
  end if;
  if nullif(btrim(p_body_html), '') is null or nullif(btrim(p_body_text), '') is null then
    raise exception using errcode='22023', message='Rendered HTML and plain text are required.';
  end if;
  if nullif(btrim(p_theme_key), '') is null then raise exception using errcode='22023', message='Theme key is required.'; end if;
  if p_editor_schema_version is null or p_editor_schema_version < 1 then raise exception using errcode='22023', message='Editor schema version is invalid.'; end if;
  if p_render_hash is null or p_render_hash !~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$' then
    raise exception using errcode='22023', message='Render hash is invalid.';
  end if;

  if p_template_id is null then
    insert into public.crm_email_templates (
      tenant_id, name, description, subject, body_html, body_text, content_scope, content_mode,
      editor_document, preheader, theme_key, editor_schema_version, render_hash, status, is_active,
      created_by_profile_id, updated_by_profile_id
    ) values (
      v_tenant_id, btrim(p_name), nullif(btrim(p_description), ''), btrim(p_subject),
      btrim(p_body_html), btrim(p_body_text), p_content_scope, p_content_mode, p_editor_document,
      nullif(btrim(p_preheader), ''), btrim(p_theme_key), p_editor_schema_version, p_render_hash,
      'draft', true, v_profile_id, v_profile_id
    ) returning * into v_saved;
  else
    select * into v_existing from public.crm_email_templates
    where id = p_template_id and tenant_id = v_tenant_id for update;
    if not found then raise exception using errcode='P0002', message='Email template was not found.'; end if;
    if v_existing.status = 'archived' then raise exception using errcode='55000', message='Archived templates must be copied before editing.'; end if;
    if v_existing.content_scope <> p_content_scope
       and exists (select 1 from public.crm_email_template_versions where template_id = v_existing.id) then
      raise exception using errcode='55000', message='A versioned template cannot change content scope.';
    end if;

    update public.crm_email_templates
    set name=btrim(p_name), description=nullif(btrim(p_description), ''), subject=btrim(p_subject),
        body_html=btrim(p_body_html), body_text=btrim(p_body_text), content_scope=p_content_scope,
        content_mode=p_content_mode, editor_document=p_editor_document,
        preheader=nullif(btrim(p_preheader), ''), theme_key=btrim(p_theme_key),
        editor_schema_version=p_editor_schema_version, render_hash=p_render_hash,
        status='draft', is_active=true, updated_by_profile_id=v_profile_id
    where id=v_existing.id returning * into v_saved;
  end if;

  return to_jsonb(v_saved);
end;
$$;

revoke all on function public.crm_email_template_save_draft(uuid,text,text,text,text,text,jsonb,text,text,text,text,integer,text) from public, anon;
grant execute on function public.crm_email_template_save_draft(uuid,text,text,text,text,text,jsonb,text,text,text,text,integer,text) to authenticated, service_role;

create or replace function public.validate_crm_bulk_send_email_studio()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_version public.crm_email_template_versions%rowtype;
begin
  if new.editor_document is null then
    if tg_op = 'INSERT' and new.recipient_type in ('client','staff') then
      raise exception 'New bulk sends require canonical Newsletter-mode Email Studio content' using errcode = '23514';
    end if;
    if new.content_mode is not null or new.preheader is not null or new.theme_key is not null
      or new.editor_schema_version is not null or new.render_hash is not null
      or new.template_id is not null or new.template_version_id is not null then
      raise exception 'Legacy bulk sends cannot contain partial Email Studio fields' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.recipient_type not in ('client','staff') then raise exception 'Canonical bulk-send recipient type is invalid' using errcode = '23514'; end if;
  if new.content_mode is distinct from 'newsletter' then raise exception 'Canonical bulk email must use newsletter mode' using errcode = '23514'; end if;
  if nullif(btrim(new.subject), '') is null or nullif(btrim(new.body_html), '') is null or nullif(btrim(new.body_text), '') is null then
    raise exception 'Canonical bulk subject, HTML, and text are required' using errcode = '23514';
  end if;

  if new.recipient_type = 'client' and not jsonb_path_exists(
    new.editor_document,
    '$.** ? (@.type == "emailStudioBlock" && @.attrs.kind == "compliance-footer")'
  ) then
    raise exception 'Canonical client newsletters require a compliance footer block' using errcode = '23514';
  end if;

  if new.template_version_id is null then
    if new.template_id is not null then
      raise exception 'Template identity requires a template version' using errcode = '23514';
    end if;
    return new;
  end if;

  select * into v_version
  from public.crm_email_template_versions version
  where version.tenant_id = new.tenant_id
    and version.id = new.template_version_id
    and version.content_scope = new.recipient_type
    and version.content_mode = 'newsletter';

  if not found then
    raise exception 'Bulk email template version is invalid for this tenant and recipient scope' using errcode = '23514';
  end if;
  if new.template_id is distinct from v_version.template_id then
    raise exception 'Template and template-version identities do not match' using errcode = '23514';
  end if;
  if v_version.subject is distinct from btrim(new.subject)
    or v_version.editor_document is distinct from new.editor_document
    or v_version.rendered_html is distinct from new.body_html
    or v_version.rendered_text is distinct from new.body_text
    or coalesce(v_version.preheader, '') is distinct from coalesce(new.preheader, '')
    or v_version.theme_key is distinct from new.theme_key
    or v_version.editor_schema_version is distinct from new.editor_schema_version
    or v_version.render_hash is distinct from new.render_hash then
    raise exception 'Bulk email content no longer matches the attributed template version' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_crm_bulk_send_email_studio() from public, anon, authenticated;

drop function if exists public.crm_create_bulk_staff_broadcast(uuid, uuid[], text, jsonb);

create function public.crm_create_bulk_staff_broadcast(
  p_tenant_id uuid,
  p_staff_ids uuid[],
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
  v_schema_version integer;
  v_actual_template_id uuid;
  v_version public.crm_email_template_versions%rowtype;
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
    or jsonb_typeof(p_content->'schemaVersion') <> 'number'
    or coalesce(p_content->>'renderHash', '') !~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$' then
    raise exception 'Canonical staff Newsletter-mode content is invalid' using errcode = '23514';
  end if;

  begin
    v_schema_version := (p_content->>'schemaVersion')::integer;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Canonical staff Newsletter-mode content is invalid' using errcode = '23514';
  end;
  if v_schema_version < 1 then
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
    and staff_member.prov_status is distinct from 'Inactive'::public.clinician_status_enum
    and lower(btrim(profile.email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';

  if v_eligible_count <> v_requested_count then
    raise exception 'One or more selected staff recipients is inactive or lacks a valid email address' using errcode = '23514';
  end if;

  if p_template_version_id is not null then
    select version.* into v_version
    from public.crm_email_template_versions version
    join public.crm_email_templates template
      on template.tenant_id = version.tenant_id
     and template.id = version.template_id
    where version.tenant_id = p_tenant_id
      and version.id = p_template_version_id
      and version.content_scope = 'staff'
      and version.content_mode = 'newsletter'
      and template.status = 'published'
      and template.is_active = true
      and template.current_published_version_id = version.id;

    if not found then
      raise exception 'Published staff newsletter template version is invalid or no longer current' using errcode = '23514';
    end if;
    v_actual_template_id := v_version.template_id;
    if p_template_id is not null and p_template_id <> v_actual_template_id then
      raise exception 'Template and template-version identities do not match' using errcode = '23514';
    end if;
    if v_version.subject is distinct from btrim(p_subject)
      or v_version.editor_document is distinct from p_content->'editorDocument'
      or v_version.rendered_html is distinct from p_content->>'renderedHtml'
      or v_version.rendered_text is distinct from p_content->>'renderedText'
      or coalesce(v_version.preheader, '') is distinct from coalesce(p_content->>'preheader', '')
      or v_version.theme_key is distinct from p_content->>'themeKey'
      or v_version.editor_schema_version is distinct from v_schema_version
      or v_version.render_hash is distinct from p_content->>'renderHash' then
      raise exception 'Staff broadcast content no longer matches the attributed template version' using errcode = '23514';
    end if;
  elsif p_template_id is not null then
    raise exception 'Template identity requires a template version' using errcode = '23514';
  end if;

  insert into public.crm_bulk_send_logs (
    id, tenant_id, recipient_type, subject, body_html, body_text,
    editor_document, preheader, content_mode, theme_key,
    editor_schema_version, render_hash, template_id, template_version_id,
    status, recipient_count, sent_count, failed_count, created_by_profile_id
  ) values (
    v_bulk_send_id, p_tenant_id, 'staff', btrim(p_subject),
    p_content->>'renderedHtml', p_content->>'renderedText',
    p_content->'editorDocument', nullif(p_content->>'preheader', ''),
    'newsletter', p_content->>'themeKey', v_schema_version, p_content->>'renderHash',
    coalesce(p_template_id, v_actual_template_id), p_template_version_id,
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
    'recipient_count', v_requested_count,
    'template_id', coalesce(p_template_id, v_actual_template_id),
    'template_version_id', p_template_version_id
  );
end;
$$;

revoke all on function public.crm_create_bulk_staff_broadcast(uuid,uuid[],text,jsonb,uuid,uuid) from public, anon, authenticated;
grant execute on function public.crm_create_bulk_staff_broadcast(uuid,uuid[],text,jsonb,uuid,uuid) to authenticated, service_role;

create or replace function public.apply_staff_broadcast_template_attribution()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_template_id uuid;
  v_template_version_id uuid;
begin
  if new.source = 'staff_broadcast' and new.bulk_send_id is not null then
    select job.template_id, job.template_version_id
      into v_template_id, v_template_version_id
    from public.crm_bulk_send_logs job
    where job.id = new.bulk_send_id
      and job.tenant_id = new.tenant_id
      and job.recipient_type = 'staff';

    if found then
      new.template_version_id := v_template_version_id;
      new.metadata := coalesce(new.metadata, '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object(
          'template_id', v_template_id,
          'template_version_id', v_template_version_id
        ));
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.apply_staff_broadcast_template_attribution() from public, anon, authenticated;

drop trigger if exists apply_staff_broadcast_template_attribution_trigger on public.crm_email_messages;
create trigger apply_staff_broadcast_template_attribution_trigger
before insert on public.crm_email_messages
for each row execute function public.apply_staff_broadcast_template_attribution();
