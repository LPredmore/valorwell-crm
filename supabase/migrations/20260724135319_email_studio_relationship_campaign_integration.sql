-- Email Studio Pass 7: canonical relationship campaign integration.
-- Authoring, persistence, and delivery payload compatibility are upgraded without
-- changing execution, enrollment, suppression, work-claim, provider, or webhook gates.

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
    v_step_id := null;
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

create or replace function private.escape_relationship_html(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(
    replace(
      replace(
        replace(
          replace(coalesce(p_value, ''), '&', '&amp;'),
          '<', '&lt;'
        ),
        '>', '&gt;'
      ),
      '"', '&quot;'
    ),
    '''', '&#39;'
  );
$$;

create or replace function private.render_relationship_html(
  p_template text,
  p_context jsonb,
  p_unsubscribe_url text,
  p_postal_address text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result text := coalesce(p_template, '');
  v_first_name text;
begin
  v_first_name := coalesce(
    nullif(p_context ->> 'contactFirstName', ''),
    nullif(p_context ->> 'contactDisplayName', ''),
    'there'
  );
  v_result := replace(v_result, '{{recipient_name}}', private.escape_relationship_html(coalesce(nullif(p_context ->> 'contactDisplayName', ''), 'there')));
  v_result := replace(v_result, '{{first_name}}', private.escape_relationship_html(v_first_name));
  v_result := replace(v_result, '{{contact_first_name}}', private.escape_relationship_html(v_first_name));
  v_result := replace(v_result, '{{contact_display_name}}', private.escape_relationship_html(coalesce(nullif(p_context ->> 'contactDisplayName', ''), 'there')));
  v_result := replace(v_result, '{{organization_name}}', private.escape_relationship_html(coalesce(nullif(p_context ->> 'organizationName', ''), '')));
  v_result := replace(v_result, '{{sender_name}}', private.escape_relationship_html(coalesce(nullif(p_context ->> 'senderName', ''), '')));
  v_result := replace(v_result, '{{unsubscribe_url}}', private.escape_relationship_html(coalesce(p_unsubscribe_url, '')));
  v_result := replace(v_result, '{{postal_address}}', replace(private.escape_relationship_html(coalesce(p_postal_address, '')), E'\n', '<br>'));
  if v_result ~ '\{\{[^{}]+\}\}' then
    raise exception 'Relationship campaign HTML contains unresolved variables.' using errcode = '22023';
  end if;
  return v_result;
end;
$$;

create or replace function private.relationship_communication_json(p_communication_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', c.id,
    'workItemId', c.work_item_id,
    'campaignId', c.campaign_id,
    'campaignStepId', c.campaign_step_id,
    'enrollmentId', c.enrollment_id,
    'organizationId', c.organization_id,
    'contactId', c.contact_id,
    'opportunityId', c.opportunity_id,
    'direction', c.direction,
    'channel', c.channel,
    'status', c.status,
    'senderEmail', c.sender_email,
    'recipientEmail', c.recipient_email,
    'subject', c.subject,
    'renderedBody', c.rendered_body,
    'renderedHtml', c.rendered_html,
    'renderedText', c.rendered_text,
    'renderedPreheader', c.rendered_preheader,
    'renderHash', c.render_hash,
    'templateVersionId', c.template_version_id,
    'provider', c.provider,
    'providerMessageId', c.provider_message_id,
    'providerThreadId', c.provider_thread_id,
    'occurredAt', c.occurred_at,
    'scheduledFor', c.scheduled_for,
    'sentAt', c.sent_at,
    'deliveredAt', c.delivered_at,
    'failedAt', c.failed_at,
    'errorCode', c.error_code,
    'errorMessage', c.error_message,
    'metadata', c.metadata,
    'createdAt', c.created_at,
    'updatedAt', c.updated_at,
    'createdBy', c.created_by_profile_id,
    'updatedBy', c.updated_by_profile_id
  ))
  from public.relationship_communications c
  where c.id = p_communication_id;
$$;

create or replace function private.prepare_relationship_campaign_delivery(
  p_work_item_id uuid,
  p_claim_token uuid,
  p_idempotency_key text,
  p_unsubscribe_base_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item private.relationship_campaign_work_items%rowtype;
  v_campaign public.relationship_campaigns%rowtype;
  v_enrollment public.relationship_campaign_enrollments%rowtype;
  v_step public.relationship_campaign_steps%rowtype;
  v_config private.relationship_delivery_provider_configs%rowtype;
  v_existing record;
  v_comm_id uuid;
  v_token jsonb;
  v_unsub text;
  v_subject text;
  v_text_template text;
  v_html_template text;
  v_text text;
  v_html text;
  v_preheader text;
  v_response jsonb;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Delivery preparation idempotency key is required.' using errcode = '22023';
  end if;
  if nullif(btrim(p_unsubscribe_base_url), '') is null or p_unsubscribe_base_url !~ '^https://' then
    raise exception 'A secure unsubscribe base URL is required.' using errcode = '22023';
  end if;

  select * into v_item
  from private.relationship_campaign_work_items
  where id = p_work_item_id
  for update;
  if not found then
    raise exception 'Campaign work item not found.' using errcode = 'P0002';
  end if;

  select operation, work_item_id, response into v_existing
  from private.relationship_delivery_idempotency
  where tenant_id = v_item.tenant_id
    and idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing.operation <> 'prepare' or v_existing.work_item_id is distinct from p_work_item_id then
      raise exception 'Preparation idempotency key was already used for another operation.' using errcode = '23505';
    end if;
    return v_existing.response;
  end if;

  if v_item.status <> 'claimed'
     or v_item.claim_token is distinct from p_claim_token
     or v_item.lease_expires_at <= now() then
    raise exception 'Campaign work claim is no longer valid.' using errcode = '40001';
  end if;

  select * into v_campaign from public.relationship_campaigns where tenant_id = v_item.tenant_id and id = v_item.campaign_id;
  select * into v_enrollment from public.relationship_campaign_enrollments where tenant_id = v_item.tenant_id and id = v_item.enrollment_id for update;
  select * into v_step from public.relationship_campaign_steps where tenant_id = v_item.tenant_id and id = v_item.campaign_step_id;
  perform private.revalidate_relationship_enrollment(v_item.tenant_id, v_enrollment.id, null, 'Final pre-delivery safety revalidation.');
  select * into v_enrollment from public.relationship_campaign_enrollments where tenant_id = v_item.tenant_id and id = v_item.enrollment_id for update;
  select * into v_config from private.relationship_delivery_provider_configs where tenant_id = v_item.tenant_id and provider = 'resend';

  if not found or v_config.status <> 'ready' then
    raise exception 'Relationship delivery provider is not ready.' using errcode = '42501';
  end if;
  if not v_campaign.execution_enabled
     or not v_enrollment.delivery_enabled
     or v_enrollment.safety_status <> 'ready'
     or v_enrollment.status <> all(array['pending', 'active']::text[]) then
    raise exception 'Campaign execution, enrollment delivery, and safety gates must all remain enabled.' using errcode = '42501';
  end if;
  if lower(v_campaign.sender_email) <> lower(v_config.sender_email) then
    raise exception 'Campaign sender is not the verified provider sender.' using errcode = '42501';
  end if;

  select id into v_comm_id
  from public.relationship_communications
  where work_item_id = v_item.id
    and direction = 'outbound';

  if v_comm_id is null then
    v_token := private.issue_relationship_unsubscribe_token(
      v_item.tenant_id,
      v_enrollment.contact_id,
      v_campaign.id,
      v_enrollment.recipient_email,
      now() + interval '30 days'
    );
    v_unsub := rtrim(p_unsubscribe_base_url, '/?') || '?token=' || (v_token ->> 'token');
    v_subject := private.render_relationship_text(v_step.subject_template, v_enrollment.personalization_context, v_unsub, v_config.postal_address);

    v_text_template := coalesce(nullif(v_step.body_text_template, ''), v_step.body_template);
    if position('{{unsubscribe_url}}' in v_text_template) = 0 then
      v_text_template := v_text_template || E'\n\n---\nUnsubscribe from non-clinical ValorWell relationship outreach: {{unsubscribe_url}}';
    end if;
    if position('{{postal_address}}' in v_text_template) = 0 then
      v_text_template := v_text_template || E'\n{{postal_address}}';
    end if;
    v_text := private.render_relationship_text(v_text_template, v_enrollment.personalization_context, v_unsub, v_config.postal_address);

    if nullif(btrim(v_step.body_html_template), '') is not null then
      v_html_template := v_step.body_html_template;
      if position('{{unsubscribe_url}}' in v_html_template) = 0 then
        v_html_template := v_html_template || '<hr><p>Unsubscribe from non-clinical ValorWell relationship outreach: <a href="{{unsubscribe_url}}">unsubscribe</a>';
      else
        v_html_template := v_html_template || '<hr><p>';
      end if;
      if position('{{postal_address}}' in v_html_template) = 0 then
        v_html_template := v_html_template || '<br>{{postal_address}}';
      end if;
      v_html_template := v_html_template || '</p>';
      v_html := private.render_relationship_html(v_html_template, v_enrollment.personalization_context, v_unsub, v_config.postal_address);
    end if;

    if nullif(btrim(v_step.preheader_template), '') is not null then
      v_preheader := private.render_relationship_text(v_step.preheader_template, v_enrollment.personalization_context, v_unsub, v_config.postal_address);
    end if;

    insert into public.relationship_communications(
      tenant_id,
      work_item_id,
      campaign_id,
      campaign_step_id,
      enrollment_id,
      organization_id,
      contact_id,
      opportunity_id,
      direction,
      channel,
      status,
      sender_email,
      recipient_email,
      subject,
      rendered_body,
      rendered_html,
      rendered_text,
      rendered_preheader,
      render_hash,
      template_version_id,
      provider,
      occurred_at,
      scheduled_for,
      metadata
    ) values (
      v_item.tenant_id,
      v_item.id,
      v_campaign.id,
      v_step.id,
      v_enrollment.id,
      v_enrollment.organization_id,
      v_enrollment.contact_id,
      v_enrollment.opportunity_id,
      'outbound',
      'email',
      'scheduled',
      lower(v_campaign.sender_email),
      lower(v_enrollment.recipient_email),
      v_subject,
      v_text,
      v_html,
      v_text,
      v_preheader,
      v_step.render_hash,
      v_step.template_version_id,
      'resend',
      now(),
      v_item.due_at,
      jsonb_build_object(
        'attempt_count', v_item.attempt_count,
        'unsubscribe_expires_at', v_token ->> 'expiresAt',
        'email_content_mode', coalesce(v_step.content_mode, 'legacy')
      )
    ) returning id into v_comm_id;

    insert into public.relationship_communication_events(tenant_id, communication_id, provider, event_type, occurred_at, payload)
    values(v_item.tenant_id, v_comm_id, 'crm', 'scheduled', now(), jsonb_build_object('work_item_id', v_item.id, 'attempt_count', v_item.attempt_count));
    insert into public.relationship_enrollment_events(tenant_id, enrollment_id, event_type, reason, metadata)
    values(v_item.tenant_id, v_enrollment.id, 'communication_scheduled', 'Canonical outbound communication prepared for provider delivery.', jsonb_build_object('communication_id', v_comm_id, 'work_item_id', v_item.id));
  else
    update public.relationship_communications
    set status = 'scheduled',
        failed_at = null,
        error_code = null,
        error_message = null,
        metadata = metadata || jsonb_build_object('attempt_count', v_item.attempt_count)
    where id = v_comm_id
      and status = 'failed';
  end if;

  v_response := private.relationship_communication_json(v_comm_id) || jsonb_build_object(
    'replyTo', v_config.inbound_address,
    'providerIdempotencyKey', 'relationship-communication:' || v_comm_id::text
  );
  insert into private.relationship_delivery_idempotency(tenant_id, idempotency_key, operation, work_item_id, communication_id, response)
  values(v_item.tenant_id, btrim(p_idempotency_key), 'prepare', v_item.id, v_comm_id, v_response);
  return v_response;
end;
$$;

revoke all on function private.save_relationship_campaign_email_studio(uuid, bigint, text, jsonb, jsonb) from public, anon;
grant execute on function private.save_relationship_campaign_email_studio(uuid, bigint, text, jsonb, jsonb) to authenticated, service_role;
revoke all on function public.save_relationship_campaign(uuid, bigint, text, jsonb, jsonb) from public, anon;
grant execute on function public.save_relationship_campaign(uuid, bigint, text, jsonb, jsonb) to authenticated, service_role;
revoke all on function private.escape_relationship_html(text) from public, anon, authenticated;
grant execute on function private.escape_relationship_html(text) to service_role;
revoke all on function private.render_relationship_html(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function private.render_relationship_html(text, jsonb, text, text) to service_role;
revoke all on function private.relationship_communication_json(uuid) from public, anon;
grant execute on function private.relationship_communication_json(uuid) to authenticated, service_role;
revoke all on function private.prepare_relationship_campaign_delivery(uuid, uuid, text, text) from public, anon;
grant execute on function private.prepare_relationship_campaign_delivery(uuid, uuid, text, text) to service_role;

comment on function public.save_relationship_campaign(uuid, bigint, text, jsonb, jsonb) is
  'Atomically saves relationship campaign definitions and canonical Email Studio step snapshots without changing execution controls.';
comment on function private.prepare_relationship_campaign_delivery(uuid, uuid, text, text) is
  'Preserves all existing relationship delivery gates while preparing canonical HTML/text snapshots when Email Studio content exists.';
