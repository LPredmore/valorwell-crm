begin;

do $$
declare
  v_tenant constant uuid := '00000000-0000-0000-0000-000000000001';
  v_admin constant uuid := 'd2dc0624-1e71-49d6-8b04-76cf1e822074';
  v_campaign uuid := gen_random_uuid();
  v_legacy_campaign uuid := gen_random_uuid();
  v_template uuid := gen_random_uuid();
  v_version uuid := gen_random_uuid();
  v_relationship_template uuid := gen_random_uuid();
  v_relationship_version uuid := gen_random_uuid();
  v_count integer;
  v_rejected boolean;
  v_doc jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello {{first_name}}"}]}]}'::jsonb;
begin
  if not exists (
    select 1
    from public.crm_user_capabilities
    where profile_id = v_admin
      and tenant_id = v_tenant
      and crm_role = 'crm_admin'
  ) then
    raise exception 'Pass 8 contract CRM-admin fixture is unavailable';
  end if;

  insert into public.crm_campaigns (id, tenant_id, name, description, is_active, created_by_profile_id)
  values
    (v_campaign, v_tenant, 'Pass 8 transactional canonical contract', 'Rollback-only', false, v_admin),
    (v_legacy_campaign, v_tenant, 'Pass 8 transactional legacy contract', 'Rollback-only', false, v_admin);

  insert into public.crm_email_templates (
    id, tenant_id, name, subject, body_html, body_text, preheader,
    content_scope, content_mode, editor_document, theme_key,
    editor_schema_version, render_hash, status, is_active,
    created_by_profile_id, updated_by_profile_id
  ) values (
    v_template, v_tenant, 'Pass 8 client campaign contract', 'Hello {{first_name}}',
    '<p>Hello {{first_name}}</p>', 'Hello {{first_name}}', 'A care update',
    'client', 'campaign', v_doc, 'valorwell', 1, 'fnv1a32:1234abcd',
    'draft', true, v_admin, v_admin
  );

  insert into public.crm_email_template_versions (
    id, tenant_id, template_id, version_number, content_scope, content_mode,
    subject, editor_document, rendered_html, rendered_text, preheader,
    theme_key, editor_schema_version, render_hash, change_summary,
    published_by_profile_id
  ) values (
    v_version, v_tenant, v_template, 1, 'client', 'campaign',
    'Hello {{first_name}}', v_doc, '<p>Hello {{first_name}}</p>',
    'Hello {{first_name}}', 'A care update', 'valorwell', 1,
    'fnv1a32:1234abcd', 'Rollback-only contract', v_admin
  );

  update public.crm_email_templates
  set status = 'published', current_published_version_id = v_version
  where id = v_template;

  insert into public.crm_email_templates (
    id, tenant_id, name, subject, body_html, body_text, preheader,
    content_scope, content_mode, editor_document, theme_key,
    editor_schema_version, render_hash, status, is_active,
    created_by_profile_id, updated_by_profile_id
  ) values (
    v_relationship_template, v_tenant, 'Pass 8 relationship contract', 'Partner update',
    '<p>Partner update</p>', 'Partner update', null,
    'relationship', 'campaign', v_doc, 'plain-outreach', 1,
    'fnv1a32:87654321', 'draft', true, v_admin, v_admin
  );

  insert into public.crm_email_template_versions (
    id, tenant_id, template_id, version_number, content_scope, content_mode,
    subject, editor_document, rendered_html, rendered_text, preheader,
    theme_key, editor_schema_version, render_hash, change_summary,
    published_by_profile_id
  ) values (
    v_relationship_version, v_tenant, v_relationship_template, 1,
    'relationship', 'campaign', 'Partner update', v_doc,
    '<p>Partner update</p>', 'Partner update', null, 'plain-outreach',
    1, 'fnv1a32:87654321', 'Rollback-only contract', v_admin
  );

  update public.crm_email_templates
  set status = 'published', current_published_version_id = v_relationship_version
  where id = v_relationship_template;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select count(*)
    into v_count
  from public.crm_save_campaign_steps(
    v_campaign,
    v_tenant,
    jsonb_build_array(
      jsonb_build_object(
        'step_order', 1,
        'delay_days', 0,
        'delay_hours', 0,
        'channel', 'email',
        'email_subject', 'Hello {{first_name}}',
        'email_body_html', '<p>Hello {{first_name}}</p>',
        'email_body_text', 'Hello {{first_name}}',
        'email_preheader', 'A care update',
        'email_content_mode', 'campaign',
        'email_editor_document', v_doc,
        'email_theme_key', 'valorwell',
        'email_editor_schema_version', 1,
        'email_render_hash', 'fnv1a32:1234abcd',
        'email_template_id', v_template,
        'email_template_version_id', v_version,
        'is_active', true
      ),
      jsonb_build_object(
        'step_order', 2,
        'delay_days', 1,
        'delay_hours', 0,
        'channel', 'sms',
        'sms_body_text', 'Hello {{first_name}}',
        'is_active', true
      )
    )
  );

  if v_count <> 2 then
    raise exception 'Expected two saved campaign steps, got %', v_count;
  end if;

  if not exists (
    select 1
    from public.crm_campaign_steps
    where campaign_id = v_campaign
      and step_order = 1
      and email_content_mode = 'campaign'
      and email_editor_document = v_doc
      and email_body_text = 'Hello {{first_name}}'
      and email_preheader = 'A care update'
      and email_theme_key = 'valorwell'
      and email_editor_schema_version = 1
      and email_render_hash = 'fnv1a32:1234abcd'
      and email_template_version_id = v_version
  ) then
    raise exception 'Canonical client campaign snapshot did not persist exactly';
  end if;

  if exists (
    select 1
    from public.crm_campaign_steps
    where campaign_id = v_campaign
      and step_order = 2
      and (
        email_content_mode is not null
        or email_editor_document is not null
        or email_body_text is not null
        or email_preheader is not null
        or email_theme_key is not null
        or email_editor_schema_version is not null
        or email_render_hash is not null
        or email_template_version_id is not null
      )
  ) then
    raise exception 'SMS step retained Email Studio fields';
  end if;

  perform public.crm_save_campaign_steps(
    v_legacy_campaign,
    v_tenant,
    jsonb_build_array(jsonb_build_object(
      'step_order', 1,
      'delay_days', 0,
      'delay_hours', 0,
      'channel', 'email',
      'email_subject', 'Legacy subject',
      'email_body_html', '<p>Legacy body</p>',
      'is_active', true
    ))
  );

  if not exists (
    select 1
    from public.crm_campaign_steps
    where campaign_id = v_legacy_campaign
      and email_body_html = '<p>Legacy body</p>'
      and email_editor_document is null
      and email_body_text is null
      and email_render_hash is null
  ) then
    raise exception 'Legacy campaign step compatibility failed';
  end if;

  v_rejected := false;
  begin
    perform public.crm_save_campaign_steps(
      v_campaign,
      v_tenant,
      jsonb_build_array(jsonb_build_object(
        'step_order', 1,
        'channel', 'email',
        'email_subject', 'Invalid newsletter mode',
        'email_body_html', '<p>Invalid</p>',
        'email_body_text', 'Invalid',
        'email_content_mode', 'newsletter',
        'email_editor_document', v_doc,
        'email_theme_key', 'valorwell',
        'email_editor_schema_version', 1,
        'email_render_hash', 'fnv1a32:1234abcd',
        'is_active', true
      ))
    );
  exception when check_violation then
    v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'Newsletter-mode client campaign content was not rejected';
  end if;

  v_rejected := false;
  begin
    perform public.crm_save_campaign_steps(
      v_campaign,
      v_tenant,
      jsonb_build_array(jsonb_build_object(
        'step_order', 1,
        'channel', 'email',
        'email_subject', 'Invalid relationship template',
        'email_body_html', '<p>Invalid</p>',
        'email_body_text', 'Invalid',
        'email_content_mode', 'campaign',
        'email_editor_document', v_doc,
        'email_theme_key', 'valorwell',
        'email_editor_schema_version', 1,
        'email_render_hash', 'fnv1a32:1234abcd',
        'email_template_id', v_relationship_template,
        'email_template_version_id', v_relationship_version,
        'is_active', true
      ))
    );
  exception when check_violation then
    v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'Relationship template version was not rejected from client campaign';
  end if;

  v_rejected := false;
  begin
    insert into public.crm_campaign_steps (
      campaign_id,
      tenant_id,
      step_order,
      channel,
      sms_body_text,
      email_content_mode,
      email_editor_document,
      email_body_html,
      email_body_text,
      email_theme_key,
      email_editor_schema_version,
      email_render_hash,
      is_active
    ) values (
      v_campaign,
      v_tenant,
      99,
      'sms',
      'Invalid SMS',
      'campaign',
      v_doc,
      '<p>Invalid</p>',
      'Invalid',
      'valorwell',
      1,
      'fnv1a32:1234abcd',
      true
    );
  exception when check_violation then
    v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'SMS canonical-field isolation was not enforced';
  end if;
end;
$$;

rollback;
