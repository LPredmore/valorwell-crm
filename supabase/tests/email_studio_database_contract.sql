-- Rollback-only verification for the Email Studio database foundation.
-- Run against a database with at least one crm_admin capability row.

begin;

do $$
declare
  v_tenant uuid;
  v_profile uuid;
  v_client_template uuid := gen_random_uuid();
  v_client_version uuid := gen_random_uuid();
  v_relationship_template uuid := gen_random_uuid();
  v_relationship_version uuid := gen_random_uuid();
  v_blocked boolean;
begin
  select tenant_id, profile_id
  into v_tenant, v_profile
  from public.crm_user_capabilities
  where crm_role = 'crm_admin'::public.crm_capability_role
  limit 1;

  if v_tenant is null or v_profile is null then
    raise exception 'Test requires one CRM admin capability row.';
  end if;

  insert into public.crm_email_templates (
    id, tenant_id, name, subject, body_html, body_text, content_scope, content_mode,
    editor_document, theme_key, editor_schema_version, render_hash, created_by_profile_id
  ) values (
    v_client_template, v_tenant, 'Pass 3 client test', 'Hello {{first_name}}',
    '<p>Hello {{first_name}}</p>', 'Hello {{first_name}}', 'client', 'campaign',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}'::jsonb,
    'valorwell', 1, 'fnv1a32:deadbeef', v_profile
  );

  insert into public.crm_email_template_versions (
    id, tenant_id, template_id, version_number, content_scope, content_mode, subject,
    editor_document, rendered_html, rendered_text, theme_key, editor_schema_version,
    render_hash, published_by_profile_id
  ) values (
    v_client_version, v_tenant, v_client_template, 1, 'client', 'campaign', 'Hello {{first_name}}',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}'::jsonb,
    '<p>Hello {{first_name}}</p>', 'Hello {{first_name}}', 'valorwell', 1,
    'fnv1a32:deadbeef', v_profile
  );

  update public.crm_email_templates
  set current_published_version_id = v_client_version,
      status = 'published'
  where id = v_client_template;

  v_blocked := false;
  begin
    update public.crm_email_template_versions
    set change_summary = 'should not update'
    where id = v_client_version;
  exception when others then
    if sqlerrm like 'Published email template versions are immutable.%' then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'Immutable version update was not blocked.';
  end if;

  insert into public.crm_email_templates (
    id, tenant_id, name, subject, body_html, body_text, content_scope, content_mode,
    editor_document, theme_key, editor_schema_version, render_hash, created_by_profile_id
  ) values (
    v_relationship_template, v_tenant, 'Pass 3 relationship test', 'Hello {{contact_first_name}}',
    '<p>Hello {{contact_first_name}}</p>', 'Hello {{contact_first_name}}', 'relationship', 'campaign',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}'::jsonb,
    'valorwell', 1, 'fnv1a32:cafebabe', v_profile
  );

  insert into public.crm_email_template_versions (
    id, tenant_id, template_id, version_number, content_scope, content_mode, subject,
    editor_document, rendered_html, rendered_text, theme_key, editor_schema_version,
    render_hash, published_by_profile_id
  ) values (
    v_relationship_version, v_tenant, v_relationship_template, 1, 'relationship', 'campaign',
    'Hello {{contact_first_name}}',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}'::jsonb,
    '<p>Hello {{contact_first_name}}</p>', 'Hello {{contact_first_name}}', 'valorwell', 1,
    'fnv1a32:cafebabe', v_profile
  );

  v_blocked := false;
  begin
    insert into public.crm_bulk_send_logs (
      tenant_id, subject, body_html, created_by_profile_id, template_version_id
    ) values (
      v_tenant, 'Wrong scope test', '<p>Wrong scope</p>', v_profile, v_relationship_version
    );
  exception when others then
    if sqlerrm like 'Email template version % has scope relationship, expected client.%' then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'Cross-domain template version reference was not blocked.';
  end if;

  v_blocked := false;
  begin
    insert into public.crm_email_template_versions (
      tenant_id, template_id, version_number, content_scope, content_mode, subject,
      editor_document, rendered_html, rendered_text, theme_key, editor_schema_version,
      render_hash, published_by_profile_id
    ) values (
      v_tenant, v_client_template, 2, 'client', 'campaign', 'Invalid document',
      '{"type":"paragraph"}'::jsonb, '<p>Invalid</p>', 'Invalid', 'valorwell', 1,
      'fnv1a32:12345678', v_profile
    );
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Invalid editor document was not blocked.';
  end if;

  v_blocked := false;
  begin
    delete from public.crm_email_templates where id = v_client_template;
  exception when others then
    if sqlerrm like 'Published or versioned email templates must be archived, not deleted.%' then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'Published template deletion was not blocked.';
  end if;
end
$$;

rollback;

select true as rollback_only_contract_tests_passed,
       (select count(*) from public.crm_email_templates where name like 'Pass 3 % test') as persisted_test_rows;
