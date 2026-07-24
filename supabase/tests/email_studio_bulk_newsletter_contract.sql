begin;

do $$
declare
  v_tenant constant uuid := '00000000-0000-0000-0000-000000000001';
  v_admin constant uuid := 'd2dc0624-1e71-49d6-8b04-76cf1e822074';
  v_client uuid;
  v_template uuid := gen_random_uuid();
  v_version uuid := gen_random_uuid();
  v_bulk uuid;
  v_recipient uuid;
  v_claim_token uuid;
  v_token text;
  v_result jsonb;
  v_rejected boolean;
  v_doc jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello {{preferred_name}}"}]},{"type":"emailStudioBlock","attrs":{"kind":"compliance-footer","title":"Email preferences","body":"Manage preferences: {{unsubscribe_url}} • {{postal_address}}"}}]}'::jsonb;
  v_content jsonb;
begin
  if not exists (
    select 1 from public.crm_user_capabilities
    where profile_id = v_admin and tenant_id = v_tenant and crm_role = 'crm_admin'
  ) then
    raise exception 'Pass 9 contract CRM-admin fixture is unavailable';
  end if;

  select id into v_client
  from public.clients
  where tenant_id = v_tenant
    and nullif(btrim(email), '') is not null
    and contact_policy = 'normal'
    and service_policy = 'normal'
    and lifecycle_stage <> 'closed'
  order by created_at
  limit 1;
  if v_client is null then
    raise exception 'Pass 9 contract requires one newsletter-eligible client fixture';
  end if;

  update public.crm_resend_email_settings
  set connection_status = 'connected',
      postal_address = 'Rollback-only test address',
      from_email = coalesce(from_email, 'test@valorwell.org')
  where tenant_id = v_tenant;
  if not found then
    insert into public.crm_resend_email_settings (
      tenant_id, from_name, from_email, inbound_email, postal_address, connection_status
    ) values (
      v_tenant, 'ValorWell', 'test@valorwell.org', 'reply@valorwell.org',
      'Rollback-only test address', 'connected'
    );
  end if;

  insert into public.crm_email_templates (
    id, tenant_id, name, subject, body_html, body_text, preheader,
    content_scope, content_mode, editor_document, theme_key,
    editor_schema_version, render_hash, status, is_active,
    created_by_profile_id, updated_by_profile_id
  ) values (
    v_template, v_tenant, 'Pass 9 newsletter contract', 'Hello {{preferred_name}}',
    '<p>Hello {{preferred_name}}</p><p>{{unsubscribe_url}} {{postal_address}}</p>',
    'Hello {{preferred_name}} {{unsubscribe_url}} {{postal_address}}',
    'A ValorWell update', 'client', 'newsletter', v_doc, 'valorwell', 1,
    'fnv1a32:1234abcd', 'draft', true, v_admin, v_admin
  );

  insert into public.crm_email_template_versions (
    id, tenant_id, template_id, version_number, content_scope, content_mode,
    subject, editor_document, rendered_html, rendered_text, preheader,
    theme_key, editor_schema_version, render_hash, change_summary,
    published_by_profile_id
  ) values (
    v_version, v_tenant, v_template, 1, 'client', 'newsletter',
    'Hello {{preferred_name}}', v_doc,
    '<p>Hello {{preferred_name}}</p><p>{{unsubscribe_url}} {{postal_address}}</p>',
    'Hello {{preferred_name}} {{unsubscribe_url}} {{postal_address}}',
    'A ValorWell update', 'valorwell', 1, 'fnv1a32:1234abcd',
    'Rollback-only contract', v_admin
  );

  update public.crm_email_templates
  set status = 'published', current_published_version_id = v_version
  where id = v_template;

  v_content := jsonb_build_object(
    'schemaVersion', 1,
    'mode', 'newsletter',
    'editorDocument', v_doc,
    'renderedHtml', '<p>Hello {{preferred_name}}</p><p>{{unsubscribe_url}} {{postal_address}}</p>',
    'renderedText', 'Hello {{preferred_name}} {{unsubscribe_url}} {{postal_address}}',
    'preheader', 'A ValorWell update',
    'themeKey', 'valorwell',
    'renderHash', 'fnv1a32:1234abcd'
  );

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_result := public.crm_create_bulk_newsletter(
    v_tenant, array[v_client], 'Hello {{preferred_name}}', v_content,
    v_template, v_version
  );
  v_bulk := (v_result->>'bulk_send_id')::uuid;

  if (v_result->>'recipient_count')::integer <> 1 then
    raise exception 'Newsletter recipient count did not persist';
  end if;
  if not exists (
    select 1 from public.crm_bulk_send_logs
    where id = v_bulk
      and tenant_id = v_tenant
      and recipient_type = 'client'
      and content_mode = 'newsletter'
      and editor_document = v_doc
      and template_id = v_template
      and template_version_id = v_version
      and status = 'pending'
  ) then
    raise exception 'Canonical newsletter job did not persist exactly';
  end if;

  select id into v_recipient
  from public.crm_bulk_send_recipients
  where bulk_send_id = v_bulk and client_id = v_client;
  if v_recipient is null then
    raise exception 'Newsletter recipient did not persist';
  end if;

  select claim.id, claim.claim_token
    into v_recipient, v_claim_token
  from public.crm_claim_bulk_client_recipients(v_tenant, v_bulk, 25) claim;
  if v_claim_token is null then
    raise exception 'Newsletter recipient claim was not created';
  end if;

  v_token := public.crm_issue_client_unsubscribe_token(v_tenant, v_bulk, v_recipient, v_client);
  if v_token <> v_recipient::text then
    raise exception 'Unsubscribe token is not stable for the recipient';
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.crm_process_client_unsubscribe(v_token);
  if v_result->>'outcome' <> 'unsubscribed' then
    raise exception 'Expected unsubscribe outcome, got %', v_result;
  end if;
  if not exists (
    select 1 from public.clients where id = v_client and contact_policy = 'do_not_contact'
  ) then
    raise exception 'Unsubscribe did not apply canonical Do Not Contact state';
  end if;
  if public.crm_process_client_unsubscribe(v_token)->>'outcome' <> 'already_unsubscribed' then
    raise exception 'Unsubscribe replay was not idempotent';
  end if;

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_rejected := false;
  begin
    perform public.crm_create_bulk_newsletter(
      v_tenant, array[v_client], 'Invalid mode',
      jsonb_set(v_content, '{mode}', '"campaign"'::jsonb), null, null
    );
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Campaign-mode content was accepted as a newsletter';
  end if;

  v_rejected := false;
  begin
    insert into public.crm_bulk_send_logs (
      tenant_id, recipient_type, subject, body_html, body_text, status,
      recipient_count, sent_count, failed_count, created_by_profile_id
    ) values (
      v_tenant, 'client', 'Legacy client bulk', '<p>Legacy</p>', 'Legacy',
      'pending', 1, 0, 0, v_admin
    );
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'New legacy client bulk-send creation was not blocked';
  end if;
end;
$$;

rollback;
