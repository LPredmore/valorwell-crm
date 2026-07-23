begin;

do $$
declare
  v_tenant uuid;
  v_profile uuid;
  v_template jsonb;
  v_publish_one jsonb;
  v_publish_two jsonb;
  v_copy jsonb;
  v_blocked boolean := false;
begin
  select tenant_id, profile_id
  into v_tenant, v_profile
  from public.crm_user_capabilities
  where crm_role = 'crm_admin'::public.crm_capability_role
  limit 1;

  if v_tenant is null or v_profile is null then
    raise exception 'Test requires one CRM admin capability row.';
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_profile::text, 'role', 'authenticated')::text,
    true
  );

  if (public.crm_email_studio_context() ->> 'tenant_id')::uuid <> v_tenant then
    raise exception 'Email Studio context did not resolve the CRM tenant.';
  end if;

  v_template := public.crm_email_template_save_draft(
    null,
    'Pass 5 lifecycle test',
    'Rollback-only test template',
    'Hello {{first_name}}',
    'client',
    'campaign',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}'::jsonb,
    '<p>Hello {{first_name}}</p>',
    'Hello {{first_name}}',
    'A test message',
    'valorwell',
    1,
    'fnv1a32:11111111'
  );

  v_publish_one := public.crm_email_template_publish(
    (v_template ->> 'id')::uuid,
    'Initial publication'
  );
  if (v_publish_one ->> 'version_number')::integer <> 1 then
    raise exception 'First published version number was not 1.';
  end if;

  begin
    perform public.crm_email_template_publish(
      (v_template ->> 'id')::uuid,
      'Duplicate publication'
    );
  exception when others then
    if sqlerrm = 'This template has no unpublished content changes.' then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'Unchanged publication was not blocked.';
  end if;

  perform public.crm_email_template_reopen_draft((v_template ->> 'id')::uuid);

  v_template := public.crm_email_template_save_draft(
    (v_template ->> 'id')::uuid,
    'Pass 5 lifecycle test',
    'Rollback-only test template',
    'Updated hello {{first_name}}',
    'client',
    'campaign',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Updated hello"}]}]}'::jsonb,
    '<p>Updated hello {{first_name}}</p>',
    'Updated hello {{first_name}}',
    'An updated test message',
    'valorwell',
    1,
    'fnv1a32:22222222'
  );

  v_publish_two := public.crm_email_template_publish(
    (v_template ->> 'id')::uuid,
    'Second publication'
  );
  if (v_publish_two ->> 'version_number')::integer <> 2 then
    raise exception 'Second published version number was not 2.';
  end if;

  v_copy := public.crm_email_template_copy(
    (v_template ->> 'id')::uuid,
    'Pass 5 lifecycle copy'
  );
  if v_copy ->> 'status' <> 'draft'
     or v_copy ->> 'current_published_version_id' is not null then
    raise exception 'Template copy was not an independent draft.';
  end if;

  perform public.crm_email_template_archive((v_template ->> 'id')::uuid);
  if not exists (
    select 1
    from public.crm_email_templates
    where id = (v_template ->> 'id')::uuid
      and status = 'archived'
      and archived_at is not null
      and is_active = false
  ) then
    raise exception 'Template was not archived correctly.';
  end if;
end
$$;

rollback;

select
  (select count(*)
   from public.crm_email_templates
   where name like 'Pass 5 lifecycle%') as persisted_templates,
  (select count(*)
   from public.crm_email_template_versions v
   join public.crm_email_templates t on t.id = v.template_id
   where t.name like 'Pass 5 lifecycle%') as persisted_versions;
