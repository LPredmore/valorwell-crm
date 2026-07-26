begin;

do $$
declare
  v_tenant constant uuid := '00000000-0000-0000-0000-000000000001';
  v_admin constant uuid := 'd2dc0624-1e71-49d6-8b04-76cf1e822074';
  v_staff uuid;
  v_staff_email text;
  v_template_id uuid;
  v_version_id uuid;
  v_bulk_send_id uuid;
  v_message_id uuid;
  v_saved jsonb;
  v_published jsonb;
  v_created jsonb;
  v_rejected boolean;
  v_doc jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hi {{staff_first_name}}"}]}]}'::jsonb;
  v_content jsonb;
begin
  if not exists (
    select 1 from public.crm_user_capabilities
    where profile_id = v_admin and tenant_id = v_tenant and crm_role = 'crm_admin'
  ) then raise exception 'Pass 11 CRM-admin fixture is unavailable'; end if;

  select staff_member.id, profile.email
    into v_staff, v_staff_email
  from public.staff staff_member
  join public.profiles profile on profile.id = staff_member.profile_id
  where staff_member.tenant_id = v_tenant
    and staff_member.prov_status is distinct from 'Inactive'::public.clinician_status_enum
    and lower(btrim(profile.email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  order by staff_member.created_at
  limit 1;
  if v_staff is null then raise exception 'Pass 11 requires one eligible staff fixture'; end if;

  update public.crm_resend_email_settings
  set connection_status = 'connected', from_email = coalesce(from_email, 'test@valorwell.org')
  where tenant_id = v_tenant;
  if not found then
    insert into public.crm_resend_email_settings (
      tenant_id, from_name, from_email, inbound_email, connection_status
    ) values (
      v_tenant, 'ValorWell Operations', 'test@valorwell.org', 'reply@valorwell.org', 'connected'
    );
  end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_saved := public.crm_email_template_save_draft(
    null,
    'Pass 11 staff template contract',
    'Rollback-only staff template',
    'Staff update for {{staff_first_name}}',
    'staff',
    'newsletter',
    v_doc,
    '<p>Hi {{staff_first_name}}</p>',
    'Hi {{staff_first_name}}',
    'Internal staff update',
    'valorwell',
    1,
    'fnv1a32:1234abcd'
  );
  v_template_id := (v_saved->>'id')::uuid;
  if v_template_id is null or v_saved->>'content_scope' <> 'staff' or v_saved->>'content_mode' <> 'newsletter' then
    raise exception 'Staff template draft did not persist in the required scope and mode';
  end if;

  v_published := public.crm_email_template_publish(v_template_id, 'Pass 11 rollback contract');
  v_version_id := (v_published->>'version_id')::uuid;
  if v_version_id is null then raise exception 'Staff template version did not publish'; end if;
  if not exists (
    select 1 from public.crm_email_template_versions
    where id = v_version_id and template_id = v_template_id
      and tenant_id = v_tenant and content_scope = 'staff' and content_mode = 'newsletter'
  ) then raise exception 'Published staff template version is not immutable staff Newsletter content'; end if;

  v_content := jsonb_build_object(
    'schemaVersion', 1,
    'mode', 'newsletter',
    'editorDocument', v_doc,
    'renderedHtml', '<p>Hi {{staff_first_name}}</p>',
    'renderedText', 'Hi {{staff_first_name}}',
    'preheader', 'Internal staff update',
    'themeKey', 'valorwell',
    'renderHash', 'fnv1a32:1234abcd'
  );

  v_created := public.crm_create_bulk_staff_broadcast(
    v_tenant,
    array[v_staff],
    'Staff update for {{staff_first_name}}',
    v_content,
    v_template_id,
    v_version_id
  );
  v_bulk_send_id := (v_created->>'bulk_send_id')::uuid;
  if not exists (
    select 1 from public.crm_bulk_send_logs
    where id = v_bulk_send_id and tenant_id = v_tenant
      and recipient_type = 'staff' and template_id = v_template_id
      and template_version_id = v_version_id and status = 'pending'
  ) then raise exception 'Staff broadcast did not preserve immutable template attribution'; end if;

  insert into public.crm_email_messages (
    tenant_id, bulk_send_id, direction, status, sender_email, recipient_email,
    subject, body_html, body_text, provider, message_class, source,
    metadata, created_by_profile_id
  ) values (
    v_tenant, v_bulk_send_id, 'outbound', 'queued', 'test@valorwell.org', v_staff_email,
    'Staff update', '<p>Staff update</p>', 'Staff update', 'resend',
    'transactional_account', 'staff_broadcast', '{}'::jsonb, v_admin
  ) returning id into v_message_id;

  if not exists (
    select 1 from public.crm_email_messages
    where id = v_message_id
      and template_version_id = v_version_id
      and metadata->>'template_id' = v_template_id::text
      and metadata->>'template_version_id' = v_version_id::text
  ) then raise exception 'Canonical message ledger did not inherit staff template attribution'; end if;

  v_rejected := false;
  begin
    perform public.crm_create_bulk_staff_broadcast(
      v_tenant,
      array[v_staff],
      'Edited subject',
      v_content,
      v_template_id,
      v_version_id
    );
  exception when check_violation then v_rejected := true;
  end;
  if not v_rejected then raise exception 'Edited staff content retained immutable template attribution'; end if;

  v_rejected := false;
  begin
    perform public.crm_email_template_save_draft(
      null,
      'Invalid staff direct template',
      '',
      'Invalid',
      'staff',
      'direct',
      v_doc,
      '<p>Invalid</p>',
      'Invalid',
      '',
      'valorwell',
      1,
      'fnv1a32:1234abcd'
    );
  exception when invalid_parameter_value then v_rejected := true;
  end;
  if not v_rejected then raise exception 'Staff Direct template was accepted'; end if;
end;
$$;

rollback;
