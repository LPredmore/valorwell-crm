create or replace function private.relationship_campaign_context(
  p_require_mutation boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_context jsonb;
  v_tenant_id uuid;
  v_role text;
begin
  if v_actor is null then
    raise exception 'Authenticated CRM access is required.' using errcode = '42501';
  end if;

  v_context := public.get_crm_operating_context();
  v_tenant_id := nullif(v_context ->> 'current_tenant_id', '')::uuid;
  v_role := coalesce(v_context ->> 'crm_role', 'crm_none');

  if v_tenant_id is null or v_role = 'crm_none' then
    raise exception 'No operating tenant is selected for this CRM session.' using errcode = '42501';
  end if;

  if p_require_mutation and v_role <> all (array['crm_admin','crm_operator']::text[]) then
    raise exception 'You do not have permission to manage relationship campaigns.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'actor_id', v_actor,
    'tenant_id', v_tenant_id,
    'crm_role', v_role
  );
end;
$$;

create or replace function private.relationship_campaign_brief_errors(p_brief jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_errors text[] := '{}'::text[];
  v_key text;
begin
  if p_brief is null or jsonb_typeof(p_brief) <> 'object' then
    return array['Campaign brief must be a JSON object.'];
  end if;

  foreach v_key in array array[
    'sourceDomain','audience','objective','primaryConversion','cta','destination',
    'channel','budgetClass','attributionSource','receivingDomain','primaryMetric'
  ]::text[]
  loop
    if nullif(btrim(p_brief ->> v_key), '') is null then
      v_errors := array_append(v_errors, format('Campaign brief field %s is required.', v_key));
    end if;
  end loop;

  if jsonb_typeof(p_brief -> 'pauseReviewTriggers') <> 'array'
     or jsonb_array_length(p_brief -> 'pauseReviewTriggers') = 0 then
    v_errors := array_append(v_errors, 'Campaign brief requires at least one pause or review trigger.');
  end if;

  if p_brief ? 'operatingDependencies'
     and jsonb_typeof(p_brief -> 'operatingDependencies') <> 'array' then
    v_errors := array_append(v_errors, 'Campaign operatingDependencies must be an array.');
  end if;

  if p_brief ? 'excludedAudiences'
     and jsonb_typeof(p_brief -> 'excludedAudiences') <> 'array' then
    v_errors := array_append(v_errors, 'Campaign excludedAudiences must be an array.');
  end if;

  return v_errors;
end;
$$;

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
  select *
  into v_campaign
  from public.relationship_campaigns campaign
  where campaign.id = p_campaign_id
    and campaign.tenant_id = v_tenant_id;

  if not found then
    raise exception 'Relationship campaign not found.' using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', step.id,
        'position', step.position,
        'subjectTemplate', step.subject_template,
        'bodyTemplate', step.body_template,
        'delayDays', step.delay_days,
        'stopOnReply', step.stop_on_reply,
        'isActive', step.is_active,
        'createdAt', step.created_at,
        'updatedAt', step.updated_at
      ) order by step.position
    ),
    '[]'::jsonb
  )
  into v_steps
  from public.relationship_campaign_steps step
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

create or replace function private.save_relationship_campaign(
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
  v_actor uuid := (v_context ->> 'actor_id')::uuid;
  v_tenant_id uuid := (v_context ->> 'tenant_id')::uuid;
  v_existing_operation text;
  v_existing_campaign_id uuid;
  v_existing_response jsonb;
  v_current public.relationship_campaigns%rowtype;
  v_campaign_id uuid := p_campaign_id;
  v_owner_id uuid;
  v_name text;
  v_purpose text;
  v_initiative text;
  v_sender_name text;
  v_sender_email text;
  v_marketing_stage text;
  v_brief jsonb;
  v_timezone text;
  v_weekdays_only boolean;
  v_send_window_start time;
  v_send_window_end time;
  v_step jsonb;
  v_ordinality bigint;
  v_response jsonb;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Campaign save idempotency key is required.' using errcode = '22023';
  end if;
  if p_campaign is null or jsonb_typeof(p_campaign) <> 'object' then
    raise exception 'Campaign payload must be a JSON object.' using errcode = '22023';
  end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'Campaign steps must be a JSON array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_steps) > 20 then
    raise exception 'Relationship campaigns are limited to 20 steps.' using errcode = '22023';
  end if;

  select operation, campaign_id, response
  into v_existing_operation, v_existing_campaign_id, v_existing_response
  from private.relationship_campaign_idempotency
  where tenant_id = v_tenant_id
    and idempotency_key = btrim(p_idempotency_key);

  if found then
    if v_existing_operation <> 'save'
       or (p_campaign_id is not null and v_existing_campaign_id <> p_campaign_id) then
      raise exception 'Campaign idempotency key was already used for a different operation.' using errcode = '23505';
    end if;
    return v_existing_response;
  end if;

  v_name := nullif(regexp_replace(btrim(p_campaign ->> 'name'), '\s+', ' ', 'g'), '');
  v_purpose := nullif(btrim(p_campaign ->> 'purpose'), '');
  v_initiative := nullif(btrim(p_campaign ->> 'initiative'), '');
  v_sender_name := nullif(regexp_replace(btrim(p_campaign ->> 'senderName'), '\s+', ' ', 'g'), '');
  v_sender_email := nullif(lower(btrim(p_campaign ->> 'senderEmail')), '');
  v_owner_id := nullif(p_campaign ->> 'ownerId', '')::uuid;
  v_marketing_stage := coalesce(nullif(p_campaign ->> 'marketingLifecycleStage', ''), 'source_lock');
  v_brief := coalesce(p_campaign -> 'brief', '{}'::jsonb);
  v_timezone := coalesce(nullif(btrim(p_campaign ->> 'defaultTimezone'), ''), 'America/Chicago');
  v_weekdays_only := coalesce((p_campaign ->> 'weekdaysOnly')::boolean, true);
  v_send_window_start := nullif(p_campaign ->> 'sendWindowStart', '')::time;
  v_send_window_end := nullif(p_campaign ->> 'sendWindowEnd', '')::time;

  if v_name is null or v_purpose is null or v_sender_name is null or v_sender_email is null then
    raise exception 'Campaign name, purpose, sender name, and sender email are required.' using errcode = '22023';
  end if;
  if v_sender_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Campaign sender email is invalid.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_brief) <> 'object' then
    raise exception 'Campaign brief must be a JSON object.' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    raise exception 'Campaign timezone is invalid.' using errcode = '22023';
  end if;
  if (v_send_window_start is null) <> (v_send_window_end is null)
     or (v_send_window_start is not null and v_send_window_start >= v_send_window_end) then
    raise exception 'Campaign send window must include a valid start and end time.' using errcode = '22023';
  end if;
  if v_owner_id is not null and not exists (
    select 1
    from public.crm_user_capabilities capability
    where capability.profile_id = v_owner_id
      and capability.tenant_id = v_tenant_id
      and capability.crm_role <> 'crm_none'::public.crm_capability_role
  ) then
    raise exception 'Campaign owner must be an active CRM user in the operating tenant.' using errcode = '22023';
  end if;

  if p_campaign_id is null then
    insert into public.relationship_campaigns (
      tenant_id, name, purpose, initiative, owner_profile_id,
      sender_name, sender_email, status, marketing_lifecycle_stage,
      brief, default_timezone, weekdays_only, send_window_start, send_window_end,
      execution_enabled, metadata, created_by_profile_id, updated_by_profile_id
    ) values (
      v_tenant_id, v_name, v_purpose, v_initiative, v_owner_id,
      v_sender_name, v_sender_email, 'draft', v_marketing_stage,
      v_brief, v_timezone, v_weekdays_only, v_send_window_start, v_send_window_end,
      false, jsonb_build_object('execution_boundary', 'disabled_until_passes_10_12'),
      v_actor, v_actor
    ) returning id into v_campaign_id;
  else
    select *
    into v_current
    from public.relationship_campaigns campaign
    where campaign.id = p_campaign_id
      and campaign.tenant_id = v_tenant_id
    for update;

    if not found then
      raise exception 'Relationship campaign not found.' using errcode = 'P0002';
    end if;
    if p_expected_version is null or p_expected_version <> v_current.version then
      raise exception 'Campaign changed after it was loaded. Refresh and retry.' using errcode = '40001';
    end if;
    if v_current.status <> all (array['draft','paused']::text[]) then
      raise exception 'Only draft or paused campaigns can be edited.' using errcode = '22023';
    end if;

    update public.relationship_campaigns
    set name = v_name,
        purpose = v_purpose,
        initiative = v_initiative,
        owner_profile_id = v_owner_id,
        sender_name = v_sender_name,
        sender_email = v_sender_email,
        marketing_lifecycle_stage = v_marketing_stage,
        brief = v_brief,
        default_timezone = v_timezone,
        weekdays_only = v_weekdays_only,
        send_window_start = v_send_window_start,
        send_window_end = v_send_window_end,
        updated_by_profile_id = v_actor
    where id = v_current.id;
  end if;

  delete from public.relationship_campaign_steps
  where tenant_id = v_tenant_id
    and campaign_id = v_campaign_id;

  for v_step, v_ordinality in
    select value, ordinality
    from jsonb_array_elements(p_steps) with ordinality
  loop
    if jsonb_typeof(v_step) <> 'object' then
      raise exception 'Every campaign step must be a JSON object.' using errcode = '22023';
    end if;
    if nullif(btrim(v_step ->> 'subjectTemplate'), '') is null
       or nullif(btrim(v_step ->> 'bodyTemplate'), '') is null then
      raise exception 'Every campaign step requires a subject and body template.' using errcode = '22023';
    end if;

    insert into public.relationship_campaign_steps (
      tenant_id, campaign_id, position, subject_template, body_template,
      delay_days, stop_on_reply, is_active, metadata,
      created_by_profile_id, updated_by_profile_id
    ) values (
      v_tenant_id,
      v_campaign_id,
      v_ordinality::integer,
      v_step ->> 'subjectTemplate',
      v_step ->> 'bodyTemplate',
      coalesce(nullif(v_step ->> 'delayDays', '')::integer, 0),
      coalesce((v_step ->> 'stopOnReply')::boolean, true),
      coalesce((v_step ->> 'isActive')::boolean, true),
      '{}'::jsonb,
      v_actor,
      v_actor
    );
  end loop;

  v_response := private.get_relationship_campaign(v_campaign_id);

  insert into private.relationship_campaign_idempotency (
    tenant_id, idempotency_key, campaign_id, operation, actor_profile_id, response
  ) values (
    v_tenant_id, btrim(p_idempotency_key), v_campaign_id, 'save', v_actor, v_response
  );

  return v_response;
end;
$$;

create or replace function private.transition_relationship_campaign(
  p_campaign_id uuid,
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
  v_context jsonb := private.relationship_campaign_context(true);
  v_actor uuid := (v_context ->> 'actor_id')::uuid;
  v_tenant_id uuid := (v_context ->> 'tenant_id')::uuid;
  v_existing_operation text;
  v_existing_campaign_id uuid;
  v_existing_response jsonb;
  v_campaign public.relationship_campaigns%rowtype;
  v_errors text[];
  v_response jsonb;
  v_allowed boolean := false;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Campaign transition idempotency key is required.' using errcode = '22023';
  end if;
  if p_to_status <> all (array['draft','active','paused','completed','archived']::text[]) then
    raise exception 'Campaign status is invalid.' using errcode = '22023';
  end if;

  select operation, campaign_id, response
  into v_existing_operation, v_existing_campaign_id, v_existing_response
  from private.relationship_campaign_idempotency
  where tenant_id = v_tenant_id
    and idempotency_key = btrim(p_idempotency_key);

  if found then
    if v_existing_operation <> 'transition' or v_existing_campaign_id <> p_campaign_id then
      raise exception 'Campaign idempotency key was already used for a different operation.' using errcode = '23505';
    end if;
    return v_existing_response;
  end if;

  select *
  into v_campaign
  from public.relationship_campaigns campaign
  where campaign.id = p_campaign_id
    and campaign.tenant_id = v_tenant_id
  for update;

  if not found then
    raise exception 'Relationship campaign not found.' using errcode = 'P0002';
  end if;
  if p_expected_version is null or p_expected_version <> v_campaign.version then
    raise exception 'Campaign changed after it was loaded. Refresh and retry.' using errcode = '40001';
  end if;

  if p_to_status = v_campaign.status then
    v_response := private.get_relationship_campaign(v_campaign.id);
    insert into private.relationship_campaign_idempotency (
      tenant_id, idempotency_key, campaign_id, operation, actor_profile_id, response
    ) values (
      v_tenant_id, btrim(p_idempotency_key), v_campaign.id, 'transition', v_actor, v_response
    );
    return v_response;
  end if;

  v_allowed :=
    (v_campaign.status = 'draft' and p_to_status = any (array['active','archived']::text[]))
    or (v_campaign.status = 'active' and p_to_status = any (array['paused','completed']::text[]))
    or (v_campaign.status = 'paused' and p_to_status = any (array['active','completed','archived']::text[]))
    or (v_campaign.status = 'completed' and p_to_status = 'archived');

  if not v_allowed then
    raise exception 'Campaign status transition from % to % is not allowed.', v_campaign.status, p_to_status using errcode = '22023';
  end if;

  if p_to_status = 'active' then
    v_errors := private.relationship_campaign_brief_errors(v_campaign.brief);
    if cardinality(v_errors) > 0 then
      raise exception 'Campaign is not ready for activation: %', array_to_string(v_errors, ' ') using errcode = '22023';
    end if;
    if v_campaign.marketing_lifecycle_stage <> 'ready' then
      raise exception 'Campaign marketing lifecycle must be Ready before activation.' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from public.relationship_campaign_steps step
      where step.tenant_id = v_tenant_id
        and step.campaign_id = v_campaign.id
        and step.is_active
    ) then
      raise exception 'Campaign requires at least one active step before activation.' using errcode = '22023';
    end if;
  end if;

  update public.relationship_campaigns
  set status = p_to_status,
      marketing_lifecycle_stage = case
        when p_to_status = 'active' then 'live'
        when p_to_status = 'paused' then 'pause'
        when p_to_status = 'completed' then 'measure'
        when p_to_status = 'archived' then 'stop_supersede'
        else marketing_lifecycle_stage
      end,
      activated_at = case when p_to_status = 'active' then coalesce(activated_at, now()) else activated_at end,
      completed_at = case when p_to_status = 'completed' then now() else completed_at end,
      archived_at = case when p_to_status = 'archived' then now() else archived_at end,
      metadata = metadata || jsonb_strip_nulls(jsonb_build_object(
        'last_status_reason', nullif(btrim(p_reason), ''),
        'last_status_changed_at', now(),
        'last_status_changed_by', v_actor,
        'execution_boundary', 'disabled_until_passes_10_12'
      )),
      updated_by_profile_id = v_actor
  where id = v_campaign.id;

  v_response := private.get_relationship_campaign(v_campaign.id);

  insert into private.relationship_campaign_idempotency (
    tenant_id, idempotency_key, campaign_id, operation, actor_profile_id, response
  ) values (
    v_tenant_id, btrim(p_idempotency_key), v_campaign.id, 'transition', v_actor, v_response
  );

  return v_response;
end;
$$;

create or replace function public.get_relationship_campaign(p_campaign_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_relationship_campaign(p_campaign_id);
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
  select private.save_relationship_campaign(
    p_campaign_id, p_expected_version, p_idempotency_key, p_campaign, p_steps
  );
$$;

create or replace function public.transition_relationship_campaign(
  p_campaign_id uuid,
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
  select private.transition_relationship_campaign(
    p_campaign_id, p_to_status, p_expected_version, p_idempotency_key, p_reason
  );
$$;

grant usage on schema private to authenticated, service_role;

revoke all on function private.relationship_campaign_context(boolean) from public, anon;
grant execute on function private.relationship_campaign_context(boolean) to authenticated, service_role;
revoke all on function private.relationship_campaign_brief_errors(jsonb) from public, anon, authenticated;
grant execute on function private.relationship_campaign_brief_errors(jsonb) to service_role;
revoke all on function private.get_relationship_campaign(uuid) from public, anon;
grant execute on function private.get_relationship_campaign(uuid) to authenticated, service_role;
revoke all on function private.save_relationship_campaign(uuid, bigint, text, jsonb, jsonb) from public, anon;
grant execute on function private.save_relationship_campaign(uuid, bigint, text, jsonb, jsonb) to authenticated, service_role;
revoke all on function private.transition_relationship_campaign(uuid, text, bigint, text, text) from public, anon;
grant execute on function private.transition_relationship_campaign(uuid, text, bigint, text, text) to authenticated, service_role;

revoke all on function public.get_relationship_campaign(uuid) from public, anon;
grant execute on function public.get_relationship_campaign(uuid) to authenticated, service_role;
revoke all on function public.save_relationship_campaign(uuid, bigint, text, jsonb, jsonb) from public, anon;
grant execute on function public.save_relationship_campaign(uuid, bigint, text, jsonb, jsonb) to authenticated, service_role;
revoke all on function public.transition_relationship_campaign(uuid, text, bigint, text, text) from public, anon;
grant execute on function public.transition_relationship_campaign(uuid, text, bigint, text, text) to authenticated, service_role;

comment on function public.save_relationship_campaign(uuid, bigint, text, jsonb, jsonb) is
  'Creates or version-checks and atomically saves a non-clinical relationship campaign definition and ordered steps. No delivery is enabled.';
comment on function public.transition_relationship_campaign(uuid, text, bigint, text, text) is
  'Applies guarded campaign definition lifecycle transitions. Active status does not enable execution.';
