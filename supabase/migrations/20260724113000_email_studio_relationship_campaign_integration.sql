-- Email Studio Pass 7: canonical relationship campaign step integration.
-- This migration changes authoring/persistence only. It does not alter execution,
-- enrollment, suppression, worker claims, Resend delivery, or webhook behavior.

create or replace function private.get_relationship_campaign(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(false);
  v_tenant_id uuid := (v_context ->> 'tenant_id')::uuid;
  v_campaign public.relationship_campaigns%rowtype;
  v_steps jsonb;
begin
  select * into v_campaign
  from public.relationship_campaigns campaign
  where campaign.id = p_campaign_id
    and campaign.tenant_id = v_tenant_id;

  if not found then
    raise exception 'Relationship campaign not found.' using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'id', step.id,
        'position', step.position,
        'subjectTemplate', step.subject_template,
        'bodyTemplate', step.body_template,
        'contentMode', step.content_mode,
        'editorDocument', step.editor_document,
        'renderedHtml', step.body_html_template,
        'renderedText', step.body_text_template,
        'preheader', step.preheader_template,
        'themeKey', step.theme_key,
        'editorSchemaVersion', step.editor_schema_version,
        'renderHash', step.render_hash,
        'templateId', version.template_id,
        'templateVersionId', step.template_version_id,
        'delayDays', step.delay_days,
        'stopOnReply', step.stop_on_reply,
        'isActive', step.is_active,
        'createdAt', step.created_at,
        'updatedAt', step.updated_at
      )) order by step.position
    ),
    '[]'::jsonb
  ) into v_steps
  from public.relationship_campaign_steps step
  left join public.crm_email_template_versions version
    on version.tenant_id = step.tenant_id
   and version.id = step.template_version_id
  where step.tenant_id = v_campaign.tenant_id
    and step.campaign_id = v_campaign.id;

  return jsonb_strip_nulls(jsonb_build_object(
    'id', v_campaign.id,
    'name', v_campaign.name,
    'purpose', v_campaign.purpose,
    'initiative', v_campaign.initiative,
    'ownerId', v_campaign.owner_profile_id,
    'senderName', v_campaign.sender_name,
    'senderEmail', v_campaign.sender_email,
    'status', v_campaign.status,
    'marketingLifecycleStage', v_campaign.marketing_lifecycle_stage,
    'brief', v_campaign.brief,
    'defaultTimezone', v_campaign.default_timezone,
    'weekdaysOnly', v_campaign.weekdays_only,
    'sendWindowStart', v_campaign.send_window_start,
    'sendWindowEnd', v_campaign.send_window_end,
    'executionEnabled', v_campaign.execution_enabled,
    'activatedAt', v_campaign.activated_at,
    'completedAt', v_campaign.completed_at,
    'archivedAt', v_campaign.archived_at,
    'version', v_campaign.version,
    'steps', v_steps,
    'metricsAvailable', false,
    'createdAt', v_campaign.created_at,
    'updatedAt', v_campaign.updated_at,
    'createdBy', v_campaign.created_by_profile_id,
    'updatedBy', v_campaign.updated_by_profile_id
  ));
end;
$$;

create or replace function private.save_relationship_campaign_email_studio(
  p_campaign_id uuid,
  p_expected_version bigint,
  p_idempotency_key text,
  p_campaign jsonb,
  p_steps jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant_id uuid := (v_context ->> 'tenant_id')::uuid;
  v_response jsonb;
  v_campaign_id uuid;
  v_step jsonb;
  v_ordinality bigint;
  v_step_id uuid;
  v_template_version public.crm_email_template_versions%rowtype;
  v_editor jsonb;
  v_mode text;
begin
  v_response := private.save_relationship_campaign(
    p_campaign_id,
    p_expected_version,
    p_idempotency_key,
    p_campaign,
    p_steps
  );
  v_campaign_id := (v_response ->> 'id')::uuid;

  for v_step, v_ordinality in
    select value, ordinality
    from jsonb_array_elements(p_steps) with ordinality
  loop
    select step.id into v_step_id
    from public.relationship_campaign_steps step
    where step.tenant_id = v_tenant_id
      and step.campaign_id = v_campaign_id
      and step.position = v_ordinality::integer;

    if v_step_id is null then
      raise exception 'Relationship campaign step % was not created.', v_ordinality using errcode = 'P0002';
    end if;

    v_editor := v_step -> 'editorDocument';
    v_mode := nullif(v_step ->> 'contentMode', '');

    if v_editor is null or v_editor = 'null'::jsonb then
      update public.relationship_campaign_steps
      set content_mode = null,
          editor_document = null,
          body_html_template = null,
          body_text_template = null,
          preheader_template = null,
          theme_key = null,
          editor_schema_version = null,
          render_hash = null,
          template_version_id = null
      where id = v_step_id;
      continue;
    end if;

    if v_mode <> 'campaign' then
      raise exception 'Relationship campaign Email Studio content must use Campaign mode.' using errcode = '22023';
    end if;
    if jsonb_typeof(v_editor) <> 'object'
       or v_editor ->> 'type' <> 'doc'
       or jsonb_typeof(v_editor -> 'content') <> 'array' then
      raise exception 'Relationship campaign Email Studio document is invalid.' using errcode = '22023';
    end if;
    if nullif(btrim(v_step ->> 'renderedHtml'), '') is null
       or nullif(btrim(v_step ->> 'renderedText'), '') is null
       or nullif(btrim(v_step ->> 'themeKey'), '') is null
       or nullif(btrim(v_step ->> 'renderHash'), '') is null
       or coalesce(nullif(v_step ->> 'editorSchemaVersion', '')::integer, 0) < 1 then
      raise exception 'Relationship campaign Email Studio snapshot is incomplete.' using errcode = '22023';
    end if;

    if nullif(v_step ->> 'templateVersionId', '') is not null then
      select * into v_template_version
      from public.crm_email_template_versions version
      where version.id = (v_step ->> 'templateVersionId')::uuid
        and version.tenant_id = v_tenant_id;
      if not found then
        raise exception 'Published email template version is unavailable.' using errcode = '22023';
      end if;
      if v_template_version.content_scope <> 'relationship'
         or v_template_version.content_mode <> 'campaign' then
        raise exception 'Relationship campaigns may use only relationship-scoped Campaign template versions.' using errcode = '22023';
      end if;
      if nullif(v_step ->> 'templateId', '') is not null
         and v_template_version.template_id <> (v_step ->> 'templateId')::uuid then
        raise exception 'Email template identity does not match the selected immutable version.' using errcode = '22023';
      end if;
    end if;

    update public.relationship_campaign_steps
    set content_mode = 'campaign',
        editor_document = v_editor,
        body_html_template = v_step ->> 'renderedHtml',
        body_text_template = v_step ->> 'renderedText',
        body_template = v_step ->> 'renderedText',
        preheader_template = nullif(v_step ->> 'preheader', ''),
        theme_key = v_step ->> 'themeKey',
        editor_schema_version = (v_step ->> 'editorSchemaVersion')::integer,
        render_hash = v_step ->> 'renderHash',
        template_version_id = nullif(v_step ->> 'templateVersionId', '')::uuid
    where id = v_step_id;
  end loop;

  return private.get_relationship_campaign(v_campaign_id);
end;
$$;

create or replace function public.save_relationship_campaign(
  p_campaign_id uuid,
  p_expected_version bigint,
  p_idempotency_key text,
  p_campaign jsonb,
  p_steps jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.save_relationship_campaign_email_studio(
    p_campaign_id,
    p_expected_version,
    p_idempotency_key,
    p_campaign,
    p_steps
  );
$$;

revoke all on function private.save_relationship_campaign_email_studio(uuid, bigint, text, jsonb, jsonb) from public, anon;
grant execute on function private.save_relationship_campaign_email_studio(uuid, bigint, text, jsonb, jsonb) to authenticated, service_role;
revoke all on function public.save_relationship_campaign(uuid, bigint, text, jsonb, jsonb) from public, anon;
grant execute on function public.save_relationship_campaign(uuid, bigint, text, jsonb, jsonb) to authenticated, service_role;

comment on function public.save_relationship_campaign(uuid, bigint, text, jsonb, jsonb) is
  'Atomically saves relationship campaign definitions and canonical Email Studio step snapshots without changing execution controls.';
