-- Expose the already-supported marketing_newsletter template scope through the canonical
-- Email Studio save contract and retire obsolete newsletter boolean switches from the operator API.

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
set search_path to 'pg_catalog','public','private'
as $$
declare
  v_profile_id uuid := auth.uid();
  v_tenant_id uuid;
  v_existing public.crm_email_templates%rowtype;
  v_saved public.crm_email_templates%rowtype;
begin
  if v_profile_id is null then
    raise exception using errcode='42501',message='Authentication is required.';
  end if;
  v_tenant_id := private.valorwell_current_staff_tenant_id();
  if v_tenant_id is null or not exists (
    select 1 from public.crm_user_capabilities
    where tenant_id=v_tenant_id and profile_id=v_profile_id
      and crm_role in ('crm_admin'::public.crm_capability_role,'crm_operator'::public.crm_capability_role)
  ) then
    raise exception using errcode='42501',message='CRM admin or operator access is required.';
  end if;

  if nullif(btrim(p_name),'') is null then raise exception using errcode='22023',message='Template name is required.'; end if;
  if nullif(btrim(p_subject),'') is null then raise exception using errcode='22023',message='Template subject is required.'; end if;
  if p_content_scope not in ('client','relationship','staff','marketing_newsletter') then
    raise exception using errcode='22023',message='Template content scope is invalid.';
  end if;
  if p_content_mode not in ('direct','campaign','newsletter') then
    raise exception using errcode='22023',message='Template content mode is invalid.';
  end if;
  if p_content_scope in ('staff','marketing_newsletter') and p_content_mode <> 'newsletter' then
    raise exception using errcode='22023',message='Staff and marketing newsletter templates must use Newsletter mode.';
  end if;
  if p_editor_document is null or jsonb_typeof(p_editor_document)<>'object'
     or p_editor_document->>'type'<>'doc' or jsonb_typeof(p_editor_document->'content')<>'array' then
    raise exception using errcode='22023',message='Canonical editor JSON is required.';
  end if;
  if nullif(btrim(p_body_html),'') is null or nullif(btrim(p_body_text),'') is null then
    raise exception using errcode='22023',message='Rendered HTML and plain text are required.';
  end if;
  if nullif(btrim(p_theme_key),'') is null then raise exception using errcode='22023',message='Theme key is required.'; end if;
  if p_editor_schema_version is null or p_editor_schema_version<1 then raise exception using errcode='22023',message='Editor schema version is invalid.'; end if;
  if p_render_hash is null or p_render_hash !~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$' then
    raise exception using errcode='22023',message='Render hash is invalid.';
  end if;

  if p_template_id is null then
    insert into public.crm_email_templates (
      tenant_id,name,description,subject,body_html,body_text,content_scope,content_mode,
      editor_document,preheader,theme_key,editor_schema_version,render_hash,status,is_active,
      created_by_profile_id,updated_by_profile_id
    ) values (
      v_tenant_id,btrim(p_name),nullif(btrim(p_description),''),btrim(p_subject),
      btrim(p_body_html),btrim(p_body_text),p_content_scope,p_content_mode,p_editor_document,
      nullif(btrim(p_preheader),''),btrim(p_theme_key),p_editor_schema_version,p_render_hash,
      'draft',true,v_profile_id,v_profile_id
    ) returning * into v_saved;
  else
    select * into v_existing from public.crm_email_templates
    where id=p_template_id and tenant_id=v_tenant_id for update;
    if not found then raise exception using errcode='P0002',message='Email template was not found.'; end if;
    if v_existing.status='archived' then raise exception using errcode='55000',message='Archived templates must be copied before editing.'; end if;
    if v_existing.content_scope<>p_content_scope
       and exists(select 1 from public.crm_email_template_versions where template_id=v_existing.id) then
      raise exception using errcode='55000',message='A versioned template cannot change content scope.';
    end if;

    update public.crm_email_templates
    set name=btrim(p_name),description=nullif(btrim(p_description),''),subject=btrim(p_subject),
        body_html=btrim(p_body_html),body_text=btrim(p_body_text),content_scope=p_content_scope,
        content_mode=p_content_mode,editor_document=p_editor_document,
        preheader=nullif(btrim(p_preheader),''),theme_key=btrim(p_theme_key),
        editor_schema_version=p_editor_schema_version,render_hash=p_render_hash,
        status='draft',is_active=true,updated_by_profile_id=v_profile_id
    where id=v_existing.id returning * into v_saved;
  end if;
  return to_jsonb(v_saved);
end;
$$;

create or replace function public.list_crm_control_plane_flags()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(false);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'flagName',f.flag_name,'enabled',f.enabled,'updatedAt',f.updated_at
    ) order by f.flag_name)
    from private.crm_control_plane_flags f
    where f.tenant_id=v_tenant
      and f.flag_name not in ('universal_newsletters_enabled','newsletter_mailbox_suppression_enabled')
  ),'[]'::jsonb);
end;
$$;

create or replace function public.set_crm_control_plane_flag(p_flag_name text,p_enabled boolean,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_actor uuid := (v_context->>'actor_id')::uuid;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_previous boolean;
begin
  if p_flag_name in ('universal_newsletters_enabled','newsletter_mailbox_suppression_enabled') then
    raise exception 'Newsletter delivery now uses the PRELAUNCH/PAUSED/ACTIVE runtime and mandatory suppression. Legacy newsletter boolean switches are retired.' using errcode='55000';
  end if;
  if p_flag_name <> all (array[
    'communications_control_plane_enabled','campaign_trigger_engine_enabled',
    'client_trigger_cutover_enabled','bty_trigger_cutover_enabled',
    'staff_campaigns_enabled','donor_campaigns_enabled'
  ]::text[]) then
    raise exception 'Unknown communications control plane flag: %',p_flag_name using errcode='22023';
  end if;
  if v_reason is null then
    raise exception 'A reason is required to change a communications control plane flag.' using errcode='22023';
  end if;
  select enabled into v_previous from private.crm_control_plane_flags
  where tenant_id=v_tenant and flag_name=p_flag_name;

  if p_enabled and p_flag_name='client_trigger_cutover_enabled'
     and not coalesce((select enabled from private.crm_control_plane_flags
                       where tenant_id=v_tenant and flag_name='campaign_trigger_engine_enabled'),false) then
    raise exception 'The campaign trigger engine must be enabled before cutting client triggers over.' using errcode='22023';
  end if;
  if p_enabled and p_flag_name='bty_trigger_cutover_enabled'
     and not coalesce((select enabled from private.crm_control_plane_flags
                       where tenant_id=v_tenant and flag_name='campaign_trigger_engine_enabled'),false) then
    raise exception 'The campaign trigger engine must be enabled before cutting BTY triggers over.' using errcode='22023';
  end if;

  insert into private.crm_control_plane_flags (tenant_id,flag_name,enabled,updated_by_profile_id,updated_at)
  values (v_tenant,p_flag_name,p_enabled,v_actor,now())
  on conflict (tenant_id,flag_name) do update
  set enabled=excluded.enabled,updated_by_profile_id=excluded.updated_by_profile_id,updated_at=now();

  insert into public.crm_activity_events (tenant_id,client_id,event_type,created_by_profile_id,metadata)
  values (v_tenant,null,'communications_control_plane_flag_changed',v_actor,jsonb_build_object(
    'flag_name',p_flag_name,'previous_value',v_previous,'new_value',p_enabled,'reason',v_reason
  ));
  return jsonb_build_object('flagName',p_flag_name,'enabled',p_enabled,'previousValue',v_previous);
end;
$$;
