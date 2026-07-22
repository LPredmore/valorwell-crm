create or replace function private.relationship_enrollment_context(
  p_require_mutation boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.relationship_campaign_context(p_require_mutation);
$$;

create or replace function private.relationship_campaign_schedule_at(
  p_base timestamptz,
  p_timezone text,
  p_weekdays_only boolean,
  p_window_start time,
  p_window_end time,
  p_delay_days integer
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp;
  v_target_date date;
  v_target_time time;
  v_candidate timestamp;
begin
  if p_base is null then
    raise exception 'Schedule base time is required.' using errcode = '22023';
  end if;
  if p_delay_days < 0 or p_delay_days > 365 then
    raise exception 'Schedule delay must be between 0 and 365 days.' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Campaign timezone is invalid.' using errcode = '22023';
  end if;

  v_local := p_base at time zone p_timezone;
  v_target_date := v_local::date + p_delay_days;

  if p_window_start is not null and p_window_end is not null then
    if p_delay_days = 0 and v_local::time >= p_window_end then
      v_target_date := v_target_date + 1;
      v_target_time := p_window_start;
    elsif p_delay_days = 0 and v_local::time between p_window_start and p_window_end then
      v_target_time := v_local::time;
    else
      v_target_time := p_window_start;
    end if;
  else
    v_target_time := v_local::time;
  end if;

  if p_weekdays_only then
    while extract(isodow from v_target_date) in (6, 7) loop
      v_target_date := v_target_date + 1;
    end loop;
  end if;

  v_candidate := v_target_date + v_target_time;
  return v_candidate at time zone p_timezone;
end;
$$;

create or replace function private.relationship_enrollment_json(p_enrollment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', enrollment.id,
    'campaignId', enrollment.campaign_id,
    'contactId', enrollment.contact_id,
    'organizationId', enrollment.organization_id,
    'opportunityId', enrollment.opportunity_id,
    'recipientEmail', enrollment.recipient_email,
    'recipientName', enrollment.recipient_name,
    'status', enrollment.status,
    'currentStepPosition', enrollment.current_step_position,
    'nextScheduledAt', enrollment.next_scheduled_at,
    'stoppedReason', enrollment.stopped_reason,
    'respondedAt', enrollment.responded_at,
    'sourceLanguageMode', enrollment.source_language_mode,
    'personalizationContext', enrollment.personalization_context,
    'eligibilitySnapshot', enrollment.eligibility_snapshot,
    'safetyStatus', enrollment.safety_status,
    'deliveryEnabled', enrollment.delivery_enabled,
    'version', enrollment.version,
    'enrolledBy', enrollment.enrolled_by_profile_id,
    'createdAt', enrollment.created_at,
    'updatedAt', enrollment.updated_at,
    'createdBy', enrollment.created_by_profile_id,
    'updatedBy', enrollment.updated_by_profile_id
  ))
  from public.relationship_campaign_enrollments enrollment
  where enrollment.id = p_enrollment_id;
$$;

create or replace function private.evaluate_relationship_campaign_target(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_target jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_campaign public.relationship_campaigns%rowtype;
  v_contact public.relationship_contacts%rowtype;
  v_organization public.relationship_organizations%rowtype;
  v_opportunity public.relationship_opportunities%rowtype;
  v_contact_id uuid := nullif(p_target ->> 'contactId', '')::uuid;
  v_organization_id uuid := nullif(p_target ->> 'organizationId', '')::uuid;
  v_opportunity_id uuid := nullif(p_target ->> 'opportunityId', '')::uuid;
  v_source_language text := coalesce(nullif(p_target ->> 'sourceLanguageMode', ''), 'none');
  v_primary_count integer := 0;
  v_primary_contact uuid;
  v_reasons text[] := '{}'::text[];
  v_display_name text;
  v_organization_name text;
  v_personalization jsonb;
begin
  if p_target is null or jsonb_typeof(p_target) <> 'object' then
    return jsonb_build_object(
      'eligible', false,
      'reasons', jsonb_build_array('target_invalid'),
      'safetyStatus', 'pending_pass_11',
      'deliveryEnabled', false,
      'executionEnabled', false
    );
  end if;

  select * into v_campaign
  from public.relationship_campaigns campaign
  where campaign.tenant_id = p_tenant_id and campaign.id = p_campaign_id;

  if not found then
    v_reasons := array_append(v_reasons, 'campaign_not_found');
  elsif v_campaign.status <> 'active' then
    v_reasons := array_append(v_reasons, 'campaign_not_active');
  end if;

  if v_opportunity_id is not null then
    select * into v_opportunity
    from public.relationship_opportunities opportunity
    where opportunity.tenant_id = p_tenant_id and opportunity.id = v_opportunity_id;
    if not found then
      v_reasons := array_append(v_reasons, 'opportunity_not_found');
    else
      if v_organization_id is not null and v_organization_id <> v_opportunity.organization_id then
        v_reasons := array_append(v_reasons, 'target_context_conflict');
      end if;
      v_organization_id := v_opportunity.organization_id;
      if v_contact_id is null then
        v_contact_id := v_opportunity.primary_contact_id;
      elsif v_opportunity.primary_contact_id is not null and v_contact_id <> v_opportunity.primary_contact_id then
        v_reasons := array_append(v_reasons, 'target_context_conflict');
      end if;
      if v_opportunity.status <> all (array['qualified','ready_for_campaign']::text[]) then
        v_reasons := array_append(v_reasons, 'opportunity_not_qualified');
      end if;
      if v_opportunity.review_status <> 'approved' then
        v_reasons := array_append(v_reasons, 'review_not_approved');
      end if;
    end if;
  end if;

  if v_organization_id is not null then
    select * into v_organization
    from public.relationship_organizations organization
    where organization.tenant_id = p_tenant_id and organization.id = v_organization_id;
    if not found then
      v_reasons := array_append(v_reasons, 'organization_not_found');
    else
      v_organization_name := v_organization.name;
      if v_organization.do_not_contact then
        v_reasons := array_append(v_reasons, 'do_not_contact');
      end if;
    end if;
  end if;

  if v_contact_id is null and v_organization_id is not null then
    select count(*), (array_agg(affiliation.contact_id order by affiliation.contact_id))[1]
    into v_primary_count, v_primary_contact
    from public.relationship_contact_organizations affiliation
    where affiliation.tenant_id = p_tenant_id
      and affiliation.organization_id = v_organization_id
      and affiliation.is_primary;
    if v_primary_count = 1 then
      v_contact_id := v_primary_contact;
    elsif v_primary_count > 1 then
      v_reasons := array_append(v_reasons, 'recipient_contact_ambiguous');
    else
      v_reasons := array_append(v_reasons, 'recipient_contact_required');
    end if;
  end if;

  if v_contact_id is null then
    v_reasons := array_append(v_reasons, 'recipient_contact_required');
  else
    select * into v_contact
    from public.relationship_contacts contact
    where contact.tenant_id = p_tenant_id and contact.id = v_contact_id;
    if not found then
      v_reasons := array_append(v_reasons, 'contact_not_found');
    else
      if v_organization_id is not null and not exists (
        select 1
        from public.relationship_contact_organizations affiliation
        where affiliation.tenant_id = p_tenant_id
          and affiliation.organization_id = v_organization_id
          and affiliation.contact_id = v_contact_id
      ) then
        v_reasons := array_append(v_reasons, 'contact_not_linked_to_organization');
      end if;
      if nullif(lower(btrim(v_contact.email)), '') is null then
        v_reasons := array_append(v_reasons, 'missing_email');
      end if;
      if v_contact.do_not_contact then
        v_reasons := array_append(v_reasons, 'do_not_contact');
      end if;
      v_display_name := coalesce(
        nullif(btrim(v_contact.preferred_name), ''),
        nullif(btrim(concat_ws(' ', v_contact.first_name, v_contact.last_name)), ''),
        nullif(lower(btrim(v_contact.email)), '')
      );
    end if;
  end if;

  if v_source_language <> all (array['research','community','verified_anonymous','verified_named','none']::text[]) then
    v_reasons := array_append(v_reasons, 'source_language_not_allowed');
  end if;

  if v_contact_id is not null and exists (
    select 1
    from public.relationship_campaign_enrollments enrollment
    where enrollment.tenant_id = p_tenant_id
      and enrollment.campaign_id = p_campaign_id
      and enrollment.contact_id = v_contact_id
      and enrollment.status = any (array['pending','active','paused']::text[])
  ) then
    v_reasons := array_append(v_reasons, 'active_enrollment');
  end if;

  if v_contact_id is not null and exists (
    select 1
    from public.relationship_campaign_enrollments enrollment
    where enrollment.tenant_id = p_tenant_id
      and enrollment.campaign_id = p_campaign_id
      and enrollment.contact_id = v_contact_id
      and enrollment.status = 'responded'
  ) then
    v_reasons := array_append(v_reasons, 'previous_response');
  end if;

  v_reasons := array(select distinct reason from unnest(v_reasons) reason order by reason);
  v_personalization := jsonb_strip_nulls(jsonb_build_object(
    'contactDisplayName', v_display_name,
    'contactFirstName', nullif(btrim(v_contact.first_name), ''),
    'organizationName', v_organization_name,
    'organizationType', v_organization.organization_kind,
    'causeArea', v_opportunity.cause_area,
    'opportunityContext', v_opportunity.qualification,
    'senderName', v_campaign.sender_name,
    'approvedSourceLanguage', v_source_language
  ));

  return jsonb_strip_nulls(jsonb_build_object(
    'target', p_target,
    'eligible', cardinality(v_reasons) = 0,
    'reasons', to_jsonb(v_reasons),
    'resolvedContactId', v_contact_id,
    'organizationId', v_organization_id,
    'opportunityId', v_opportunity_id,
    'recipientEmail', nullif(lower(btrim(v_contact.email)), ''),
    'recipientName', v_display_name,
    'sourceLanguageMode', v_source_language,
    'personalizationContext', v_personalization,
    'evaluatedAt', now(),
    'safetyStatus', 'pending_pass_11',
    'safetyEligible', false,
    'deliveryEnabled', false,
    'executionEnabled', coalesce(v_campaign.execution_enabled, false),
    'executionBoundary', 'disabled_until_passes_11_12'
  ));
end;
$$;

create or replace function private.evaluate_relationship_campaign_eligibility(
  p_campaign_id uuid,
  p_targets jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_enrollment_context(false);
  v_tenant_id uuid := (v_context ->> 'tenant_id')::uuid;
  v_target jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if p_targets is null or jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) = 0 then
    raise exception 'At least one enrollment target is required.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_targets) > 100 then
    raise exception 'Enrollment eligibility is limited to 100 targets per request.' using errcode = '22023';
  end if;
  for v_target in select value from jsonb_array_elements(p_targets) loop
    v_results := v_results || jsonb_build_array(
      private.evaluate_relationship_campaign_target(v_tenant_id, p_campaign_id, v_target)
    );
  end loop;
  return v_results;
end;
$$;

create or replace function private.enroll_relationship_targets(
  p_campaign_id uuid,
  p_targets jsonb,
  p_expected_campaign_version bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_enrollment_context(true);
  v_actor uuid := (v_context ->> 'actor_id')::uuid;
  v_tenant_id uuid := (v_context ->> 'tenant_id')::uuid;
  v_campaign public.relationship_campaigns%rowtype;
  v_target jsonb;
  v_evaluation jsonb;
  v_evaluations jsonb := '[]'::jsonb;
  v_existing_operation text;
  v_existing_campaign_id uuid;
  v_existing_response jsonb;
  v_enrollment_id uuid;
  v_enrollment_ids uuid[] := '{}'::uuid[];
  v_contact_id uuid;
  v_organization_id uuid;
  v_opportunity_id uuid;
  v_first_step public.relationship_campaign_steps%rowtype;
  v_due_at timestamptz;
  v_response jsonb;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Enrollment idempotency key is required.' using errcode = '22023';
  end if;
  if p_targets is null or jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) = 0 then
    raise exception 'At least one enrollment target is required.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_targets) > 100 then
    raise exception 'Enrollment is limited to 100 targets per request.' using errcode = '22023';
  end if;

  select operation, campaign_id, response
  into v_existing_operation, v_existing_campaign_id, v_existing_response
  from private.relationship_enrollment_idempotency
  where tenant_id = v_tenant_id and idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing_operation <> 'enroll' or v_existing_campaign_id <> p_campaign_id then
      raise exception 'Enrollment idempotency key was already used for a different operation.' using errcode = '23505';
    end if;
    return v_existing_response;
  end if;

  select * into v_campaign
  from public.relationship_campaigns campaign
  where campaign.tenant_id = v_tenant_id and campaign.id = p_campaign_id
  for update;
  if not found then
    raise exception 'Relationship campaign not found.' using errcode = 'P0002';
  end if;
  if p_expected_campaign_version is null or p_expected_campaign_version <> v_campaign.version then
    raise exception 'Campaign changed after it was loaded. Refresh and retry.' using errcode = '40001';
  end if;
  if v_campaign.status <> 'active' then
    raise exception 'Only an active campaign definition can accept enrollments.' using errcode = '22023';
  end if;

  select * into v_first_step
  from public.relationship_campaign_steps step
  where step.tenant_id = v_tenant_id
    and step.campaign_id = p_campaign_id
    and step.is_active
  order by step.position
  limit 1;
  if not found then
    raise exception 'Campaign has no active step to plan.' using errcode = '22023';
  end if;

  for v_target in select value from jsonb_array_elements(p_targets) loop
    v_evaluation := private.evaluate_relationship_campaign_target(v_tenant_id, p_campaign_id, v_target);
    v_evaluations := v_evaluations || jsonb_build_array(v_evaluation);
    if coalesce((v_evaluation ->> 'eligible')::boolean, false) is not true then
      raise exception 'Enrollment target is not eligible: %', coalesce(v_evaluation -> 'reasons', '[]'::jsonb)::text using errcode = '22023';
    end if;
  end loop;

  for v_evaluation in select value from jsonb_array_elements(v_evaluations) loop
    v_contact_id := (v_evaluation ->> 'resolvedContactId')::uuid;
    v_organization_id := nullif(v_evaluation ->> 'organizationId', '')::uuid;
    v_opportunity_id := nullif(v_evaluation ->> 'opportunityId', '')::uuid;
    v_due_at := private.relationship_campaign_schedule_at(
      now(), v_campaign.default_timezone, v_campaign.weekdays_only,
      v_campaign.send_window_start, v_campaign.send_window_end, v_first_step.delay_days
    );

    insert into public.relationship_campaign_enrollments (
      tenant_id, campaign_id, contact_id, organization_id, opportunity_id,
      recipient_email, recipient_name, status, current_step_position, next_scheduled_at,
      source_language_mode, personalization_context, eligibility_snapshot,
      safety_status, delivery_enabled, enrolled_by_profile_id, metadata,
      created_by_profile_id, updated_by_profile_id
    ) values (
      v_tenant_id, p_campaign_id, v_contact_id, v_organization_id, v_opportunity_id,
      v_evaluation ->> 'recipientEmail', v_evaluation ->> 'recipientName', 'pending',
      v_first_step.position, v_due_at,
      v_evaluation ->> 'sourceLanguageMode', coalesce(v_evaluation -> 'personalizationContext', '{}'::jsonb),
      v_evaluation, 'pending_pass_11', false, v_actor,
      jsonb_build_object('execution_boundary', 'disabled_until_passes_11_12'),
      v_actor, v_actor
    ) returning id into v_enrollment_id;

    v_enrollment_ids := array_append(v_enrollment_ids, v_enrollment_id);

    insert into private.relationship_campaign_work_items (
      tenant_id, campaign_id, enrollment_id, campaign_step_id, step_position,
      status, due_at, available_at, idempotency_key, metadata
    ) values (
      v_tenant_id, p_campaign_id, v_enrollment_id, v_first_step.id, v_first_step.position,
      'planned', v_due_at, v_due_at,
      format('enrollment:%s:step:%s', v_enrollment_id, v_first_step.id),
      jsonb_build_object('execution_boundary', 'dormant_until_passes_11_12')
    );

    insert into public.relationship_enrollment_events (
      tenant_id, enrollment_id, event_type, from_status, to_status, reason,
      actor_profile_id, metadata
    ) values
      (v_tenant_id, v_enrollment_id, 'enrolled', null, 'pending',
       'Recipient resolved and preliminary eligibility snapshotted.', v_actor,
       jsonb_build_object('safety_status', 'pending_pass_11', 'delivery_enabled', false)),
      (v_tenant_id, v_enrollment_id, 'work_planned', 'pending', 'pending',
       'First campaign step planned; delivery remains disabled.', v_actor,
       jsonb_build_object('step_position', v_first_step.position, 'due_at', v_due_at));

    insert into public.relationship_interactions (
      tenant_id, organization_id, contact_id, opportunity_id, interaction_type,
      occurred_at, summary, metadata, created_by_profile_id, updated_by_profile_id
    ) values (
      v_tenant_id, v_organization_id, v_contact_id, v_opportunity_id,
      'campaign_enrollment', now(),
      format('Added %s to campaign %s as a pending enrollment. Delivery remains disabled.',
        coalesce(v_evaluation ->> 'recipientName', v_evaluation ->> 'recipientEmail'), v_campaign.name),
      jsonb_build_object('campaign_id', p_campaign_id, 'enrollment_id', v_enrollment_id,
        'safety_status', 'pending_pass_11', 'delivery_enabled', false),
      v_actor, v_actor
    );
  end loop;

  select coalesce(jsonb_agg(private.relationship_enrollment_json(enrollment.id) order by enrollment.created_at, enrollment.id), '[]'::jsonb)
  into v_response
  from public.relationship_campaign_enrollments enrollment
  where enrollment.tenant_id = v_tenant_id and enrollment.id = any (v_enrollment_ids);

  insert into private.relationship_enrollment_idempotency (
    tenant_id, idempotency_key, operation, campaign_id, actor_profile_id, response
  ) values (
    v_tenant_id, btrim(p_idempotency_key), 'enroll', p_campaign_id, v_actor, v_response
  );

  return v_response;
end;
$$;

create or replace function private.transition_relationship_campaign_enrollment(
  p_enrollment_id uuid,
  p_to_status text,
  p_expected_version bigint,
  p_idempotency_key text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_enrollment_context(true);
  v_actor uuid := (v_context ->> 'actor_id')::uuid;
  v_tenant_id uuid := (v_context ->> 'tenant_id')::uuid;
  v_enrollment public.relationship_campaign_enrollments%rowtype;
  v_campaign public.relationship_campaigns%rowtype;
  v_existing_operation text;
  v_existing_enrollment_id uuid;
  v_existing_response jsonb;
  v_event_type text;
  v_allowed boolean := false;
  v_response jsonb;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Enrollment transition idempotency key is required.' using errcode = '22023';
  end if;
  if p_to_status <> all (array['pending','paused','stopped']::text[]) then
    raise exception 'Pass 10 operator transitions are limited to pending, paused, and stopped.' using errcode = '22023';
  end if;

  select operation, enrollment_id, response
  into v_existing_operation, v_existing_enrollment_id, v_existing_response
  from private.relationship_enrollment_idempotency
  where tenant_id = v_tenant_id and idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing_operation <> 'transition' or v_existing_enrollment_id <> p_enrollment_id then
      raise exception 'Enrollment idempotency key was already used for a different operation.' using errcode = '23505';
    end if;
    return v_existing_response;
  end if;

  select * into v_enrollment
  from public.relationship_campaign_enrollments enrollment
  where enrollment.tenant_id = v_tenant_id and enrollment.id = p_enrollment_id
  for update;
  if not found then
    raise exception 'Relationship campaign enrollment not found.' using errcode = 'P0002';
  end if;
  if p_expected_version is null or p_expected_version <> v_enrollment.version then
    raise exception 'Enrollment changed after it was loaded. Refresh and retry.' using errcode = '40001';
  end if;

  if p_to_status = v_enrollment.status then
    v_response := private.relationship_enrollment_json(v_enrollment.id);
    insert into private.relationship_enrollment_idempotency (
      tenant_id, idempotency_key, operation, campaign_id, enrollment_id, actor_profile_id, response
    ) values (
      v_tenant_id, btrim(p_idempotency_key), 'transition', v_enrollment.campaign_id,
      v_enrollment.id, v_actor, v_response
    );
    return v_response;
  end if;

  v_allowed :=
    (v_enrollment.status = 'pending' and p_to_status = any (array['paused','stopped']::text[]))
    or (v_enrollment.status = 'active' and p_to_status = any (array['paused','stopped']::text[]))
    or (v_enrollment.status = 'paused' and p_to_status = any (array['pending','stopped']::text[]));
  if not v_allowed then
    raise exception 'Enrollment status transition from % to % is not allowed.', v_enrollment.status, p_to_status using errcode = '22023';
  end if;

  select * into v_campaign
  from public.relationship_campaigns campaign
  where campaign.tenant_id = v_tenant_id and campaign.id = v_enrollment.campaign_id;
  if p_to_status = 'pending' and v_campaign.status <> 'active' then
    raise exception 'A paused enrollment can resume only while its campaign definition is active.' using errcode = '22023';
  end if;

  v_event_type := case p_to_status
    when 'paused' then 'paused'
    when 'pending' then 'resumed'
    when 'stopped' then 'stopped'
  end;

  update public.relationship_campaign_enrollments
  set status = p_to_status,
      stopped_reason = case when p_to_status = 'stopped' then coalesce(nullif(btrim(p_reason), ''), 'Stopped by CRM operator.') else stopped_reason end,
      metadata = metadata || jsonb_strip_nulls(jsonb_build_object(
        'last_transition_reason', nullif(btrim(p_reason), ''),
        'last_transition_at', now(),
        'last_transition_by', v_actor
      )),
      updated_by_profile_id = v_actor
  where id = v_enrollment.id;

  if p_to_status = 'stopped' then
    update private.relationship_campaign_work_items
    set status = 'cancelled',
        claim_token = null,
        claimed_by = null,
        claimed_at = null,
        lease_expires_at = null,
        updated_at = now(),
        metadata = metadata || jsonb_build_object('cancelled_reason', coalesce(nullif(btrim(p_reason), ''), 'Enrollment stopped.'))
    where tenant_id = v_tenant_id
      and enrollment_id = v_enrollment.id
      and status = any (array['planned','retry_wait','claimed']::text[]);
  end if;

  insert into public.relationship_enrollment_events (
    tenant_id, enrollment_id, event_type, from_status, to_status, reason,
    actor_profile_id, metadata
  ) values (
    v_tenant_id, v_enrollment.id, v_event_type, v_enrollment.status, p_to_status,
    nullif(btrim(p_reason), ''), v_actor,
    jsonb_build_object('delivery_enabled', false, 'safety_status', 'pending_pass_11')
  );

  if p_to_status = 'stopped' then
    insert into public.relationship_interactions (
      tenant_id, organization_id, contact_id, opportunity_id, interaction_type,
      occurred_at, summary, metadata, created_by_profile_id, updated_by_profile_id
    ) values (
      v_tenant_id, v_enrollment.organization_id, v_enrollment.contact_id, v_enrollment.opportunity_id,
      'campaign_stop', now(),
      format('Stopped pending enrollment for campaign %s.', v_campaign.name),
      jsonb_build_object('campaign_id', v_campaign.id, 'enrollment_id', v_enrollment.id,
        'reason', nullif(btrim(p_reason), '')),
      v_actor, v_actor
    );
  end if;

  v_response := private.relationship_enrollment_json(v_enrollment.id);
  insert into private.relationship_enrollment_idempotency (
    tenant_id, idempotency_key, operation, campaign_id, enrollment_id, actor_profile_id, response
  ) values (
    v_tenant_id, btrim(p_idempotency_key), 'transition', v_enrollment.campaign_id,
    v_enrollment.id, v_actor, v_response
  );
  return v_response;
end;
$$;

create or replace function private.claim_relationship_campaign_work(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response jsonb;
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'Worker ID is required.' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'Claim limit must be between 1 and 100.' using errcode = '22023';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'Lease must be between 30 and 3600 seconds.' using errcode = '22023';
  end if;

  update private.relationship_campaign_work_items item
  set status = 'retry_wait',
      claim_token = null,
      claimed_by = null,
      claimed_at = null,
      lease_expires_at = null,
      available_at = now(),
      last_error_code = 'lease_expired',
      last_error_message = 'Previous worker lease expired before result recording.',
      updated_at = now()
  where item.status = 'claimed' and item.lease_expires_at <= now();

  with candidates as (
    select item.id
    from private.relationship_campaign_work_items item
    join public.relationship_campaigns campaign
      on campaign.tenant_id = item.tenant_id and campaign.id = item.campaign_id
    join public.relationship_campaign_enrollments enrollment
      on enrollment.tenant_id = item.tenant_id and enrollment.id = item.enrollment_id
    join public.relationship_campaign_steps step
      on step.tenant_id = item.tenant_id and step.id = item.campaign_step_id
    where item.status = any (array['planned','retry_wait']::text[])
      and item.available_at <= now()
      and item.due_at <= now()
      and campaign.status = 'active'
      and campaign.execution_enabled
      and enrollment.status = any (array['pending','active']::text[])
      and enrollment.delivery_enabled
      and enrollment.safety_status = 'ready'
      and step.is_active
    order by item.due_at, item.id
    for update of item skip locked
    limit p_limit
  ), claimed as (
    update private.relationship_campaign_work_items item
    set status = 'claimed',
        attempt_count = item.attempt_count + 1,
        claim_token = gen_random_uuid(),
        claimed_by = btrim(p_worker_id),
        claimed_at = now(),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        updated_at = now()
    from candidates
    where item.id = candidates.id
    returning item.*
  ), enrollment_updates as (
    update public.relationship_campaign_enrollments enrollment
    set status = 'active', updated_by_profile_id = null
    from claimed
    where enrollment.id = claimed.enrollment_id and enrollment.status = 'pending'
    returning enrollment.id
  ), event_rows as (
    insert into public.relationship_enrollment_events (
      tenant_id, enrollment_id, event_type, from_status, to_status, reason, actor_profile_id, metadata
    )
    select claimed.tenant_id, claimed.enrollment_id, 'work_claimed', null, null,
      'Due campaign work claimed by service worker.', null,
      jsonb_build_object('work_item_id', claimed.id, 'worker_id', p_worker_id,
        'claim_token', claimed.claim_token, 'attempt_count', claimed.attempt_count)
    from claimed
    returning id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'workItemId', claimed.id,
    'tenantId', claimed.tenant_id,
    'campaignId', claimed.campaign_id,
    'enrollmentId', claimed.enrollment_id,
    'campaignStepId', claimed.campaign_step_id,
    'stepPosition', claimed.step_position,
    'attemptCount', claimed.attempt_count,
    'maxAttempts', claimed.max_attempts,
    'claimToken', claimed.claim_token,
    'leaseExpiresAt', claimed.lease_expires_at
  ) order by claimed.due_at, claimed.id), '[]'::jsonb)
  into v_response
  from claimed;

  return v_response;
end;
$$;

create or replace function private.record_relationship_campaign_work_result(
  p_work_item_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_idempotency_key text,
  p_retry_at timestamptz default null,
  p_error_code text default null,
  p_error_message text default null
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
  v_next_step public.relationship_campaign_steps%rowtype;
  v_existing_operation text;
  v_existing_response jsonb;
  v_next_due timestamptz;
  v_response jsonb;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Work result idempotency key is required.' using errcode = '22023';
  end if;
  if p_outcome <> all (array['completed','retry','failed']::text[]) then
    raise exception 'Work result outcome is invalid.' using errcode = '22023';
  end if;

  select * into v_item
  from private.relationship_campaign_work_items item
  where item.id = p_work_item_id
  for update;
  if not found then
    raise exception 'Campaign work item not found.' using errcode = 'P0002';
  end if;

  select operation, response into v_existing_operation, v_existing_response
  from private.relationship_enrollment_idempotency
  where tenant_id = v_item.tenant_id and idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing_operation <> 'work_result' then
      raise exception 'Work result idempotency key was already used for a different operation.' using errcode = '23505';
    end if;
    return v_existing_response;
  end if;

  if v_item.status <> 'claimed' or v_item.claim_token is distinct from p_claim_token then
    raise exception 'Campaign work claim is no longer valid.' using errcode = '40001';
  end if;
  if v_item.lease_expires_at <= now() then
    raise exception 'Campaign work claim lease has expired.' using errcode = '40001';
  end if;

  select * into v_campaign
  from public.relationship_campaigns campaign
  where campaign.tenant_id = v_item.tenant_id and campaign.id = v_item.campaign_id;
  select * into v_enrollment
  from public.relationship_campaign_enrollments enrollment
  where enrollment.tenant_id = v_item.tenant_id and enrollment.id = v_item.enrollment_id
  for update;

  if not v_campaign.execution_enabled or not v_enrollment.delivery_enabled or v_enrollment.safety_status <> 'ready' then
    raise exception 'Campaign execution, enrollment delivery, and safety gates must all be enabled before recording work.' using errcode = '42501';
  end if;

  if p_outcome = 'retry' then
    if v_item.attempt_count >= v_item.max_attempts then
      raise exception 'Campaign work item has exhausted its retry allowance.' using errcode = '22023';
    end if;
    if p_retry_at is null or p_retry_at <= now() then
      raise exception 'A future retry time is required.' using errcode = '22023';
    end if;
    update private.relationship_campaign_work_items
    set status = 'retry_wait', available_at = p_retry_at,
        claim_token = null, claimed_by = null, claimed_at = null, lease_expires_at = null,
        last_error_code = nullif(btrim(p_error_code), ''),
        last_error_message = nullif(btrim(p_error_message), ''), updated_at = now()
    where id = v_item.id;
    insert into public.relationship_enrollment_events (
      tenant_id, enrollment_id, event_type, reason, actor_profile_id, metadata
    ) values (
      v_item.tenant_id, v_item.enrollment_id, 'work_retry_scheduled',
      nullif(btrim(p_error_message), ''), null,
      jsonb_build_object('work_item_id', v_item.id, 'retry_at', p_retry_at,
        'error_code', nullif(btrim(p_error_code), ''), 'attempt_count', v_item.attempt_count)
    );
  elsif p_outcome = 'failed' then
    update private.relationship_campaign_work_items
    set status = 'failed', claim_token = null, claimed_by = null, claimed_at = null,
        lease_expires_at = null, last_error_code = nullif(btrim(p_error_code), ''),
        last_error_message = nullif(btrim(p_error_message), ''), updated_at = now()
    where id = v_item.id;
    update public.relationship_campaign_enrollments
    set status = 'failed', next_scheduled_at = null, updated_by_profile_id = null
    where id = v_enrollment.id;
    insert into public.relationship_enrollment_events (
      tenant_id, enrollment_id, event_type, from_status, to_status, reason, actor_profile_id, metadata
    ) values (
      v_item.tenant_id, v_item.enrollment_id, 'failed', v_enrollment.status, 'failed',
      nullif(btrim(p_error_message), ''), null,
      jsonb_build_object('work_item_id', v_item.id, 'error_code', nullif(btrim(p_error_code), ''))
    );
  else
    update private.relationship_campaign_work_items
    set status = 'completed', completed_at = now(), claim_token = null, claimed_by = null,
        claimed_at = null, lease_expires_at = null, last_error_code = null,
        last_error_message = null, updated_at = now()
    where id = v_item.id;
    insert into public.relationship_enrollment_events (
      tenant_id, enrollment_id, event_type, reason, actor_profile_id, metadata
    ) values (
      v_item.tenant_id, v_item.enrollment_id, 'step_completed',
      'Campaign step work completed.', null,
      jsonb_build_object('work_item_id', v_item.id, 'step_position', v_item.step_position)
    );

    select * into v_next_step
    from public.relationship_campaign_steps step
    where step.tenant_id = v_item.tenant_id
      and step.campaign_id = v_item.campaign_id
      and step.is_active
      and step.position > v_item.step_position
    order by step.position
    limit 1;

    if found then
      v_next_due := private.relationship_campaign_schedule_at(
        now(), v_campaign.default_timezone, v_campaign.weekdays_only,
        v_campaign.send_window_start, v_campaign.send_window_end, v_next_step.delay_days
      );
      insert into private.relationship_campaign_work_items (
        tenant_id, campaign_id, enrollment_id, campaign_step_id, step_position,
        status, due_at, available_at, idempotency_key, metadata
      ) values (
        v_item.tenant_id, v_item.campaign_id, v_item.enrollment_id, v_next_step.id,
        v_next_step.position, 'planned', v_next_due, v_next_due,
        format('enrollment:%s:step:%s', v_item.enrollment_id, v_next_step.id),
        jsonb_build_object('planned_after_work_item_id', v_item.id)
      ) on conflict (enrollment_id, campaign_step_id) do nothing;
      update public.relationship_campaign_enrollments
      set status = 'active', current_step_position = v_next_step.position,
          next_scheduled_at = v_next_due, updated_by_profile_id = null
      where id = v_enrollment.id;
      insert into public.relationship_enrollment_events (
        tenant_id, enrollment_id, event_type, reason, actor_profile_id, metadata
      ) values (
        v_item.tenant_id, v_item.enrollment_id, 'work_planned',
        'Next active campaign step planned.', null,
        jsonb_build_object('step_position', v_next_step.position, 'due_at', v_next_due)
      );
    else
      update public.relationship_campaign_enrollments
      set status = 'completed', current_step_position = null, next_scheduled_at = null,
          updated_by_profile_id = null
      where id = v_enrollment.id;
      insert into public.relationship_enrollment_events (
        tenant_id, enrollment_id, event_type, from_status, to_status, reason, actor_profile_id, metadata
      ) values (
        v_item.tenant_id, v_item.enrollment_id, 'completed', v_enrollment.status, 'completed',
        'All active campaign steps completed.', null, '{}'::jsonb
      );
    end if;
  end if;

  v_response := jsonb_build_object(
    'workItemId', v_item.id,
    'outcome', p_outcome,
    'enrollment', private.relationship_enrollment_json(v_item.enrollment_id)
  );
  insert into private.relationship_enrollment_idempotency (
    tenant_id, idempotency_key, operation, campaign_id, enrollment_id, actor_profile_id, response
  ) values (
    v_item.tenant_id, btrim(p_idempotency_key), 'work_result', v_item.campaign_id,
    v_item.enrollment_id, null, v_response
  );
  return v_response;
end;
$$;

create or replace function public.evaluate_relationship_campaign_eligibility(
  p_campaign_id uuid,
  p_targets jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.evaluate_relationship_campaign_eligibility(p_campaign_id, p_targets);
$$;

create or replace function public.enroll_relationship_targets(
  p_campaign_id uuid,
  p_targets jsonb,
  p_expected_campaign_version bigint,
  p_idempotency_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.enroll_relationship_targets(
    p_campaign_id, p_targets, p_expected_campaign_version, p_idempotency_key
  );
$$;

create or replace function public.transition_relationship_campaign_enrollment(
  p_enrollment_id uuid,
  p_to_status text,
  p_expected_version bigint,
  p_idempotency_key text,
  p_reason text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.transition_relationship_campaign_enrollment(
    p_enrollment_id, p_to_status, p_expected_version, p_idempotency_key, p_reason
  );
$$;

revoke all on function private.relationship_enrollment_context(boolean) from public, anon;
grant execute on function private.relationship_enrollment_context(boolean) to authenticated, service_role;
revoke all on function private.relationship_campaign_schedule_at(timestamptz, text, boolean, time, time, integer) from public, anon, authenticated;
grant execute on function private.relationship_campaign_schedule_at(timestamptz, text, boolean, time, time, integer) to service_role;
revoke all on function private.relationship_enrollment_json(uuid) from public, anon;
grant execute on function private.relationship_enrollment_json(uuid) to authenticated, service_role;
revoke all on function private.evaluate_relationship_campaign_target(uuid, uuid, jsonb) from public, anon;
grant execute on function private.evaluate_relationship_campaign_target(uuid, uuid, jsonb) to authenticated, service_role;
revoke all on function private.evaluate_relationship_campaign_eligibility(uuid, jsonb) from public, anon;
grant execute on function private.evaluate_relationship_campaign_eligibility(uuid, jsonb) to authenticated, service_role;
revoke all on function private.enroll_relationship_targets(uuid, jsonb, bigint, text) from public, anon;
grant execute on function private.enroll_relationship_targets(uuid, jsonb, bigint, text) to authenticated, service_role;
revoke all on function private.transition_relationship_campaign_enrollment(uuid, text, bigint, text, text) from public, anon;
grant execute on function private.transition_relationship_campaign_enrollment(uuid, text, bigint, text, text) to authenticated, service_role;
revoke all on function private.claim_relationship_campaign_work(text, integer, integer) from public, anon, authenticated;
grant execute on function private.claim_relationship_campaign_work(text, integer, integer) to service_role;
revoke all on function private.record_relationship_campaign_work_result(uuid, uuid, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function private.record_relationship_campaign_work_result(uuid, uuid, text, text, timestamptz, text, text) to service_role;

revoke all on function public.evaluate_relationship_campaign_eligibility(uuid, jsonb) from public, anon;
grant execute on function public.evaluate_relationship_campaign_eligibility(uuid, jsonb) to authenticated, service_role;
revoke all on function public.enroll_relationship_targets(uuid, jsonb, bigint, text) from public, anon;
grant execute on function public.enroll_relationship_targets(uuid, jsonb, bigint, text) to authenticated, service_role;
revoke all on function public.transition_relationship_campaign_enrollment(uuid, text, bigint, text, text) from public, anon;
grant execute on function public.transition_relationship_campaign_enrollment(uuid, text, bigint, text, text) to authenticated, service_role;

comment on function public.evaluate_relationship_campaign_eligibility(uuid, jsonb) is
  'Resolves relationship targets to required contacts and returns preliminary Pass 10 eligibility. Suppression and unsubscribe safety remains pending Pass 11.';
comment on function public.enroll_relationship_targets(uuid, jsonb, bigint, text) is
  'Atomically creates pending non-clinical campaign enrollments, immutable recipient and eligibility snapshots, events, interactions, and dormant first-step work.';
comment on function private.claim_relationship_campaign_work(text, integer, integer) is
  'Service-only SKIP LOCKED claim function. It returns no work while campaign execution, enrollment delivery, or safety gates remain disabled.';
comment on function private.record_relationship_campaign_work_result(uuid, uuid, text, text, timestamptz, text, text) is
  'Service-only idempotent retry, terminal failure, and campaign-step advancement foundation. It creates no communication or provider record.';
