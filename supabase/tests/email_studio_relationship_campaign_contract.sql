-- Rollback-only contract for Email Studio Pass 7.
-- Run after the Pass 7 migrations. No test rows persist.

begin;

do $$
declare
  v_tenant uuid;
  v_profile uuid;
  v_template jsonb;
  v_publish jsonb;
  v_campaign jsonb;
  v_legacy jsonb;
  v_blocked boolean := false;
  v_html text;
  v_campaign_id uuid;
  v_legacy_id uuid;
begin
  select tenant_id, profile_id into v_tenant, v_profile
  from public.crm_user_capabilities
  where crm_role = 'crm_admin'::public.crm_capability_role
  limit 1;
  if v_tenant is null or v_profile is null then
    raise exception 'Pass 7 contract requires one CRM admin capability.';
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_profile::text, 'role', 'authenticated')::text,
    true
  );

  v_template := public.crm_email_template_save_draft(
    null,
    'Pass 7 rollback relationship template',
    'Rollback-only relationship campaign template',
    'Hello {{contact_first_name}}',
    'relationship',
    'campaign',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}'::jsonb,
    '<p>Hello {{contact_first_name}} from {{organization_name}}</p>',
    'Hello {{contact_first_name}} from {{organization_name}}',
    'A note for {{contact_display_name}}',
    'plain-outreach',
    1,
    'fnv1a32:1234abcd'
  );
  v_publish := public.crm_email_template_publish((v_template ->> 'id')::uuid, 'Pass 7 rollback publication');

  v_campaign := public.save_relationship_campaign(
    null,
    null,
    'pass7-contract-canonical-' || gen_random_uuid()::text,
    jsonb_build_object(
      'name', 'Pass 7 rollback canonical campaign',
      'purpose', 'Validate canonical relationship campaign persistence.',
      'senderName', 'ValorWell',
      'senderEmail', 'outreach@example.org',
      'marketingLifecycleStage', 'source_lock',
      'brief', '{}'::jsonb,
      'defaultTimezone', 'America/Chicago',
      'weekdaysOnly', true,
      'sendWindowStart', '09:00',
      'sendWindowEnd', '17:00'
    ),
    jsonb_build_array(jsonb_build_object(
      'subjectTemplate', 'Hello {{contact_first_name}}',
      'bodyTemplate', 'Hello {{contact_first_name}} from {{organization_name}}',
      'contentMode', 'campaign',
      'editorDocument', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}'::jsonb,
      'renderedHtml', '<p>Hello {{contact_first_name}} from {{organization_name}}</p>',
      'renderedText', 'Hello {{contact_first_name}} from {{organization_name}}',
      'preheader', 'A note for {{contact_display_name}}',
      'themeKey', 'plain-outreach',
      'editorSchemaVersion', 1,
      'renderHash', 'fnv1a32:1234abcd',
      'templateId', v_publish ->> 'template_id',
      'templateVersionId', v_publish ->> 'version_id',
      'delayDays', 0,
      'stopOnReply', true,
      'isActive', true
    ))
  );
  v_campaign_id := (v_campaign ->> 'id')::uuid;

  if coalesce((v_campaign ->> 'executionEnabled')::boolean, true) then
    raise exception 'Pass 7 changed relationship campaign execution state.';
  end if;
  if v_campaign #>> '{steps,0,contentMode}' <> 'campaign'
     or v_campaign #>> '{steps,0,renderHash}' <> 'fnv1a32:1234abcd'
     or (v_campaign #>> '{steps,0,templateVersionId}')::uuid <> (v_publish ->> 'version_id')::uuid then
    raise exception 'Canonical campaign response did not preserve the Email Studio snapshot and version attribution.';
  end if;
  if not exists (
    select 1 from public.relationship_campaign_steps
    where tenant_id = v_tenant
      and campaign_id = v_campaign_id
      and content_mode = 'campaign'
      and body_html_template like '<p>Hello%'
      and body_text_template like 'Hello%'
      and render_hash = 'fnv1a32:1234abcd'
      and template_version_id = (v_publish ->> 'version_id')::uuid
  ) then
    raise exception 'Canonical relationship campaign step was not persisted.';
  end if;

  v_legacy := public.save_relationship_campaign(
    null,
    null,
    'pass7-contract-legacy-' || gen_random_uuid()::text,
    jsonb_build_object(
      'name', 'Pass 7 rollback legacy campaign',
      'purpose', 'Validate legacy relationship campaign compatibility.',
      'senderName', 'ValorWell',
      'senderEmail', 'outreach@example.org',
      'marketingLifecycleStage', 'source_lock',
      'brief', '{}'::jsonb,
      'defaultTimezone', 'America/Chicago',
      'weekdaysOnly', true,
      'sendWindowStart', '09:00',
      'sendWindowEnd', '17:00'
    ),
    jsonb_build_array(jsonb_build_object(
      'subjectTemplate', 'Legacy subject',
      'bodyTemplate', 'Legacy body',
      'delayDays', 0,
      'stopOnReply', true,
      'isActive', true
    ))
  );
  v_legacy_id := (v_legacy ->> 'id')::uuid;
  if exists (
    select 1 from public.relationship_campaign_steps
    where tenant_id = v_tenant
      and campaign_id = v_legacy_id
      and (content_mode is not null or editor_document is not null or template_version_id is not null)
  ) then
    raise exception 'Legacy relationship campaign step was rewritten as canonical content.';
  end if;

  begin
    perform public.save_relationship_campaign(
      null,
      null,
      'pass7-contract-invalid-mode-' || gen_random_uuid()::text,
      jsonb_build_object(
        'name', 'Pass 7 rollback invalid campaign',
        'purpose', 'Validate mode rejection.',
        'senderName', 'ValorWell',
        'senderEmail', 'outreach@example.org',
        'marketingLifecycleStage', 'source_lock',
        'brief', '{}'::jsonb,
        'defaultTimezone', 'America/Chicago',
        'weekdaysOnly', true
      ),
      jsonb_build_array(jsonb_build_object(
        'subjectTemplate', 'Invalid',
        'bodyTemplate', 'Invalid',
        'contentMode', 'newsletter',
        'editorDocument', '{"type":"doc","content":[]}'::jsonb,
        'renderedHtml', '<p>Invalid</p>',
        'renderedText', 'Invalid',
        'themeKey', 'plain-outreach',
        'editorSchemaVersion', 1,
        'renderHash', 'fnv1a32:87654321',
        'delayDays', 0,
        'stopOnReply', true,
        'isActive', true
      ))
    );
  exception when others then
    if sqlerrm = 'Relationship campaign Email Studio content must use Campaign mode.' then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'Non-Campaign Email Studio content was accepted.';
  end if;

  v_html := private.render_relationship_html(
    '<p>{{contact_first_name}} — {{organization_type}}</p>',
    '{"contactFirstName":"<Alex>","organizationType":"Nonprofit & partner"}'::jsonb,
    'https://example.org/unsubscribe?a=1&b=2',
    E'ValorWell\nMissouri'
  );
  if v_html <> '<p>&lt;Alex&gt; — Nonprofit &amp; partner</p>' then
    raise exception 'Relationship HTML variables were not escaped correctly: %', v_html;
  end if;

  v_blocked := false;
  begin
    perform private.render_relationship_text(
      '{{approved_source_sentence}}',
      '{}'::jsonb,
      'https://example.org/unsubscribe',
      'ValorWell'
    );
  exception when others then
    if sqlerrm = 'Relationship campaign template contains unresolved variables.' then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'Missing evidence-backed relationship context did not fail closed.';
  end if;
end
$$;

rollback;

select
  (select count(*) from public.crm_email_templates where name like 'Pass 7 rollback%') as persisted_templates,
  (select count(*) from public.relationship_campaigns where name like 'Pass 7 rollback%') as persisted_campaigns;
