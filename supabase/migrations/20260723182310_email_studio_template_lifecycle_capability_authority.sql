create or replace function public.crm_email_studio_context()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, private
as $$
declare
  v_profile_id uuid := auth.uid();
  v_tenant_id uuid;
  v_can_read boolean;
  v_can_manage boolean;
begin
  if v_profile_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  v_tenant_id := private.valorwell_current_staff_tenant_id();
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'An active staff tenant is required.';
  end if;

  select exists (
           select 1
           from public.crm_user_capabilities
           where tenant_id = v_tenant_id
             and profile_id = v_profile_id
             and crm_role in (
               'crm_admin'::public.crm_capability_role,
               'crm_operator'::public.crm_capability_role,
               'crm_readonly'::public.crm_capability_role
             )
         ),
         exists (
           select 1
           from public.crm_user_capabilities
           where tenant_id = v_tenant_id
             and profile_id = v_profile_id
             and crm_role in (
               'crm_admin'::public.crm_capability_role,
               'crm_operator'::public.crm_capability_role
             )
         )
  into v_can_read, v_can_manage;

  if not v_can_read then
    raise exception using errcode = '42501', message = 'CRM Email Studio access is required.';
  end if;

  return jsonb_build_object(
    'profile_id', v_profile_id,
    'tenant_id', v_tenant_id,
    'can_read', v_can_read,
    'can_manage', v_can_manage
  );
end;
$$;

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
    select 1
    from public.crm_user_capabilities
    where tenant_id = v_tenant_id
      and profile_id = v_profile_id
      and crm_role in (
        'crm_admin'::public.crm_capability_role,
        'crm_operator'::public.crm_capability_role
      )
  ) then
    raise exception using errcode = '42501', message = 'CRM admin or operator access is required.';
  end if;

  if nullif(btrim(p_name), '') is null then
    raise exception using errcode = '22023', message = 'Template name is required.';
  end if;
  if nullif(btrim(p_subject), '') is null then
    raise exception using errcode = '22023', message = 'Template subject is required.';
  end if;
  if p_content_scope not in ('client', 'relationship') then
    raise exception using errcode = '22023', message = 'Template content scope is invalid.';
  end if;
  if p_content_mode not in ('direct', 'campaign', 'newsletter') then
    raise exception using errcode = '22023', message = 'Template content mode is invalid.';
  end if;
  if p_editor_document is null
     or jsonb_typeof(p_editor_document) <> 'object'
     or p_editor_document ->> 'type' <> 'doc'
     or jsonb_typeof(p_editor_document -> 'content') <> 'array' then
    raise exception using errcode = '22023', message = 'Canonical editor JSON is required.';
  end if;
  if nullif(btrim(p_body_html), '') is null or nullif(btrim(p_body_text), '') is null then
    raise exception using errcode = '22023', message = 'Rendered HTML and plain text are required.';
  end if;
  if nullif(btrim(p_theme_key), '') is null then
    raise exception using errcode = '22023', message = 'Theme key is required.';
  end if;
  if p_editor_schema_version is null or p_editor_schema_version < 1 then
    raise exception using errcode = '22023', message = 'Editor schema version is invalid.';
  end if;
  if p_render_hash is null or p_render_hash !~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$' then
    raise exception using errcode = '22023', message = 'Render hash is invalid.';
  end if;

  if p_template_id is null then
    insert into public.crm_email_templates (
      tenant_id,
      name,
      description,
      subject,
      body_html,
      body_text,
      content_scope,
      content_mode,
      editor_document,
      preheader,
      theme_key,
      editor_schema_version,
      render_hash,
      status,
      is_active,
      created_by_profile_id,
      updated_by_profile_id
    ) values (
      v_tenant_id,
      btrim(p_name),
      nullif(btrim(p_description), ''),
      btrim(p_subject),
      btrim(p_body_html),
      btrim(p_body_text),
      p_content_scope,
      p_content_mode,
      p_editor_document,
      nullif(btrim(p_preheader), ''),
      btrim(p_theme_key),
      p_editor_schema_version,
      p_render_hash,
      'draft',
      true,
      v_profile_id,
      v_profile_id
    )
    returning * into v_saved;
  else
    select *
    into v_existing
    from public.crm_email_templates
    where id = p_template_id
      and tenant_id = v_tenant_id
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'Email template was not found.';
    end if;
    if v_existing.status = 'archived' then
      raise exception using errcode = '55000', message = 'Archived templates must be copied before editing.';
    end if;
    if v_existing.content_scope <> p_content_scope
       and exists (
         select 1
         from public.crm_email_template_versions
         where template_id = v_existing.id
       ) then
      raise exception using errcode = '55000', message = 'A versioned template cannot change content scope.';
    end if;

    update public.crm_email_templates
    set name = btrim(p_name),
        description = nullif(btrim(p_description), ''),
        subject = btrim(p_subject),
        body_html = btrim(p_body_html),
        body_text = btrim(p_body_text),
        content_scope = p_content_scope,
        content_mode = p_content_mode,
        editor_document = p_editor_document,
        preheader = nullif(btrim(p_preheader), ''),
        theme_key = btrim(p_theme_key),
        editor_schema_version = p_editor_schema_version,
        render_hash = p_render_hash,
        status = 'draft',
        is_active = true,
        updated_by_profile_id = v_profile_id
    where id = v_existing.id
    returning * into v_saved;
  end if;

  return to_jsonb(v_saved);
end;
$$;

create or replace function public.crm_email_template_reopen_draft(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_profile_id uuid := auth.uid();
  v_tenant_id uuid;
  v_saved public.crm_email_templates%rowtype;
begin
  v_tenant_id := private.valorwell_current_staff_tenant_id();
  if v_profile_id is null
     or v_tenant_id is null
     or not exists (
       select 1
       from public.crm_user_capabilities
       where tenant_id = v_tenant_id
         and profile_id = v_profile_id
         and crm_role in (
           'crm_admin'::public.crm_capability_role,
           'crm_operator'::public.crm_capability_role
         )
     ) then
    raise exception using errcode = '42501', message = 'CRM admin or operator access is required.';
  end if;

  update public.crm_email_templates
  set status = 'draft',
      is_active = true,
      updated_by_profile_id = v_profile_id
  where id = p_template_id
    and tenant_id = v_tenant_id
    and status <> 'archived'
  returning * into v_saved;

  if not found then
    raise exception using errcode = 'P0002', message = 'Editable email template was not found.';
  end if;

  return to_jsonb(v_saved);
end;
$$;

create or replace function public.crm_email_template_publish(
  p_template_id uuid,
  p_change_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_profile_id uuid := auth.uid();
  v_tenant_id uuid;
  v_template public.crm_email_templates%rowtype;
  v_current public.crm_email_template_versions%rowtype;
  v_version public.crm_email_template_versions%rowtype;
  v_next_version integer;
begin
  v_tenant_id := private.valorwell_current_staff_tenant_id();
  if v_profile_id is null
     or v_tenant_id is null
     or not exists (
       select 1
       from public.crm_user_capabilities
       where tenant_id = v_tenant_id
         and profile_id = v_profile_id
         and crm_role in (
           'crm_admin'::public.crm_capability_role,
           'crm_operator'::public.crm_capability_role
         )
     ) then
    raise exception using errcode = '42501', message = 'CRM admin or operator access is required.';
  end if;

  select *
  into v_template
  from public.crm_email_templates
  where id = p_template_id
    and tenant_id = v_tenant_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Email template was not found.';
  end if;
  if v_template.status = 'archived' then
    raise exception using errcode = '55000', message = 'Archived templates cannot be published.';
  end if;
  if v_template.editor_document is null
     or nullif(btrim(v_template.body_html), '') is null
     or nullif(btrim(v_template.body_text), '') is null
     or v_template.render_hash is null then
    raise exception using errcode = '22023', message = 'Canonical editor content must be saved before publishing.';
  end if;

  if v_template.current_published_version_id is not null then
    select *
    into v_current
    from public.crm_email_template_versions
    where id = v_template.current_published_version_id
      and tenant_id = v_tenant_id;

    if found
       and v_current.content_scope is not distinct from v_template.content_scope
       and v_current.content_mode is not distinct from v_template.content_mode
       and v_current.subject is not distinct from v_template.subject
       and v_current.editor_document is not distinct from v_template.editor_document
       and v_current.rendered_html is not distinct from v_template.body_html
       and v_current.rendered_text is not distinct from v_template.body_text
       and v_current.preheader is not distinct from v_template.preheader
       and v_current.theme_key is not distinct from v_template.theme_key
       and v_current.editor_schema_version is not distinct from v_template.editor_schema_version
       and v_current.render_hash is not distinct from v_template.render_hash then
      raise exception using errcode = '55000', message = 'This template has no unpublished content changes.';
    end if;
  end if;

  select coalesce(max(version_number), 0) + 1
  into v_next_version
  from public.crm_email_template_versions
  where template_id = v_template.id;

  insert into public.crm_email_template_versions (
    tenant_id,
    template_id,
    version_number,
    content_scope,
    content_mode,
    subject,
    editor_document,
    rendered_html,
    rendered_text,
    preheader,
    theme_key,
    editor_schema_version,
    render_hash,
    change_summary,
    published_by_profile_id
  ) values (
    v_tenant_id,
    v_template.id,
    v_next_version,
    v_template.content_scope,
    v_template.content_mode,
    v_template.subject,
    v_template.editor_document,
    v_template.body_html,
    v_template.body_text,
    v_template.preheader,
    v_template.theme_key,
    v_template.editor_schema_version,
    v_template.render_hash,
    nullif(btrim(p_change_summary), ''),
    v_profile_id
  )
  returning * into v_version;

  update public.crm_email_templates
  set current_published_version_id = v_version.id,
      status = 'published',
      is_active = true,
      updated_by_profile_id = v_profile_id
  where id = v_template.id;

  return jsonb_build_object(
    'template_id', v_template.id,
    'version_id', v_version.id,
    'version_number', v_version.version_number,
    'render_hash', v_version.render_hash,
    'published_at', v_version.published_at
  );
end;
$$;

create or replace function public.crm_email_template_copy(
  p_template_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_profile_id uuid := auth.uid();
  v_tenant_id uuid;
  v_source public.crm_email_templates%rowtype;
  v_copy public.crm_email_templates%rowtype;
begin
  v_tenant_id := private.valorwell_current_staff_tenant_id();
  if v_profile_id is null
     or v_tenant_id is null
     or not exists (
       select 1
       from public.crm_user_capabilities
       where tenant_id = v_tenant_id
         and profile_id = v_profile_id
         and crm_role in (
           'crm_admin'::public.crm_capability_role,
           'crm_operator'::public.crm_capability_role
         )
     ) then
    raise exception using errcode = '42501', message = 'CRM admin or operator access is required.';
  end if;

  select *
  into v_source
  from public.crm_email_templates
  where id = p_template_id
    and tenant_id = v_tenant_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Email template was not found.';
  end if;

  insert into public.crm_email_templates (
    tenant_id,
    name,
    description,
    subject,
    body_html,
    body_text,
    content_scope,
    content_mode,
    editor_document,
    preheader,
    theme_key,
    editor_schema_version,
    render_hash,
    status,
    is_active,
    created_by_profile_id,
    updated_by_profile_id
  ) values (
    v_tenant_id,
    coalesce(nullif(btrim(p_name), ''), v_source.name || ' Copy'),
    v_source.description,
    v_source.subject,
    v_source.body_html,
    v_source.body_text,
    v_source.content_scope,
    v_source.content_mode,
    v_source.editor_document,
    v_source.preheader,
    v_source.theme_key,
    v_source.editor_schema_version,
    v_source.render_hash,
    'draft',
    true,
    v_profile_id,
    v_profile_id
  )
  returning * into v_copy;

  return to_jsonb(v_copy);
end;
$$;

create or replace function public.crm_email_template_archive(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_profile_id uuid := auth.uid();
  v_tenant_id uuid;
  v_archived public.crm_email_templates%rowtype;
begin
  v_tenant_id := private.valorwell_current_staff_tenant_id();
  if v_profile_id is null
     or v_tenant_id is null
     or not exists (
       select 1
       from public.crm_user_capabilities
       where tenant_id = v_tenant_id
         and profile_id = v_profile_id
         and crm_role in (
           'crm_admin'::public.crm_capability_role,
           'crm_operator'::public.crm_capability_role
         )
     ) then
    raise exception using errcode = '42501', message = 'CRM admin or operator access is required.';
  end if;

  update public.crm_email_templates
  set status = 'archived',
      is_active = false,
      archived_at = coalesce(archived_at, now()),
      updated_by_profile_id = v_profile_id
  where id = p_template_id
    and tenant_id = v_tenant_id
  returning * into v_archived;

  if not found then
    raise exception using errcode = 'P0002', message = 'Email template was not found.';
  end if;

  return to_jsonb(v_archived);
end;
$$;

revoke all on function public.crm_email_studio_context() from public, anon;
revoke all on function public.crm_email_template_save_draft(uuid, text, text, text, text, text, jsonb, text, text, text, text, integer, text) from public, anon;
revoke all on function public.crm_email_template_reopen_draft(uuid) from public, anon;
revoke all on function public.crm_email_template_publish(uuid, text) from public, anon;
revoke all on function public.crm_email_template_copy(uuid, text) from public, anon;
revoke all on function public.crm_email_template_archive(uuid) from public, anon;

grant execute on function public.crm_email_studio_context() to authenticated;
grant execute on function public.crm_email_template_save_draft(uuid, text, text, text, text, text, jsonb, text, text, text, text, integer, text) to authenticated;
grant execute on function public.crm_email_template_reopen_draft(uuid) to authenticated;
grant execute on function public.crm_email_template_publish(uuid, text) to authenticated;
grant execute on function public.crm_email_template_copy(uuid, text) to authenticated;
grant execute on function public.crm_email_template_archive(uuid) to authenticated;

comment on function public.crm_email_studio_context() is
  'Returns tenant-scoped Email Studio access for the authenticated staff profile.';
comment on function public.crm_email_template_save_draft(uuid, text, text, text, text, text, jsonb, text, text, text, text, integer, text) is
  'Atomically creates or updates canonical Email Studio draft content.';
comment on function public.crm_email_template_publish(uuid, text) is
  'Publishes an immutable Email Studio version and updates the template pointer in one transaction.';
