begin;

do $$
declare
  v_tenant constant uuid := '00000000-0000-0000-0000-000000000001';
  v_admin constant uuid := 'd2dc0624-1e71-49d6-8b04-76cf1e822074';
  v_unauthorized constant uuid := '00000000-0000-0000-0000-000000000099';
  v_staff uuid;
  v_bulk uuid;
  v_recipient uuid;
  v_claim_token uuid;
  v_reclaimed_token uuid;
  v_result jsonb;
  v_rejected boolean;
  v_doc jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hi {{staff_first_name}}"}]}]}'::jsonb;
  v_content jsonb;
begin
  if not exists (
    select 1 from public.crm_user_capabilities
    where profile_id = v_admin and tenant_id = v_tenant and crm_role = 'crm_admin'
  ) then raise exception 'Pass 10 CRM-admin fixture is unavailable'; end if;

  select staff_member.id into v_staff
  from public.staff staff_member
  join public.profiles profile on profile.id = staff_member.profile_id
  where staff_member.tenant_id = v_tenant
    and staff_member.prov_status <> 'Inactive'::public.clinician_status_enum
    and lower(btrim(profile.email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  order by staff_member.created_at
  limit 1;
  if v_staff is null then raise exception 'Pass 10 requires one eligible staff fixture'; end if;

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

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  update public.staff
  set prov_status = null
  where id = v_staff;

  v_result := public.crm_create_bulk_staff_broadcast(
    v_tenant, array[v_staff], 'Staff update', v_content
  );
  v_bulk := (v_result->>'bulk_send_id')::uuid;
  if (v_result->>'recipient_count')::integer <> 1 then
    raise exception 'Staff recipient count did not persist';
  end if;

  if not exists (
    select 1 from public.crm_bulk_send_logs
    where id = v_bulk
      and tenant_id = v_tenant
      and recipient_type = 'staff'
      and content_mode = 'newsletter'
      and editor_document = v_doc
      and status = 'pending'
  ) then raise exception 'Canonical staff broadcast did not persist exactly'; end if;

  select id into v_recipient
  from public.crm_bulk_send_staff_recipients
  where bulk_send_id = v_bulk and staff_id = v_staff;
  if v_recipient is null then raise exception 'Staff recipient did not persist'; end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  select claim.id, claim.claim_token into v_recipient, v_claim_token
  from public.crm_claim_bulk_staff_recipients(v_tenant, v_bulk, 25) claim;
  if v_claim_token is null then raise exception 'Staff recipient claim was not created'; end if;

  update public.crm_bulk_send_staff_recipients
  set claimed_at = null
  where id = v_recipient;

  select claim.claim_token into v_reclaimed_token
  from public.crm_claim_bulk_staff_recipients(v_tenant, v_bulk, 25) claim
  where claim.id = v_recipient;
  if v_reclaimed_token is null or v_reclaimed_token = v_claim_token then
    raise exception 'NULL claimed_at processing recipient was not reclaimed';
  end if;

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_rejected := false;
  begin
    perform public.crm_create_bulk_staff_broadcast(
      v_tenant,
      array[v_staff],
      'Invalid schema version',
      v_content || jsonb_build_object('schemaVersion', 'not-a-number')
    );
  exception when check_violation then v_rejected := true;
  end;
  if not v_rejected then raise exception 'Non-numeric schemaVersion was accepted'; end if;

  v_rejected := false;
  begin
    insert into public.crm_bulk_send_logs (
      tenant_id, recipient_type, subject, body_html, body_text, status,
      recipient_count, sent_count, failed_count, created_by_profile_id
    ) values (
      v_tenant, 'staff', 'Legacy staff bulk', '<p>Legacy</p>', 'Legacy',
      'pending', 1, 0, 0, v_admin
    );
  exception when check_violation then v_rejected := true;
  end;
  if not v_rejected then raise exception 'New legacy staff bulk-send creation was not blocked'; end if;

  perform set_config('request.jwt.claim.sub', v_unauthorized::text, true);
  v_rejected := false;
  begin
    perform public.crm_create_bulk_staff_broadcast(v_tenant, array[v_staff], 'Unauthorized', v_content);
  exception when insufficient_privilege then v_rejected := true;
  end;
  if not v_rejected then raise exception 'Unauthorized staff broadcast creation was accepted'; end if;
end;
$$;

rollback;
