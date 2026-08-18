-- Align client campaign automation with canonical client lifecycle and engagement state.
-- Client campaigns enter from lifecycle_stage, stop on any lifecycle movement or inbound
-- email/SMS, and may apply an engagement outcome when their final step completes.

alter table public.crm_campaigns
  add column if not exists on_complete_lifecycle_stage public.client_lifecycle_stage_enum,
  add column if not exists on_complete_engagement_state public.client_engagement_state_enum;

comment on column public.crm_campaigns.on_complete_lifecycle_stage is
  'Lifecycle state expected to remain in place when an automated client campaign exhausts all steps. Actual lifecycle progression remains owned by canonical workflow events.';
comment on column public.crm_campaigns.on_complete_engagement_state is
  'Optional canonical engagement state applied when an automated client campaign exhausts all steps without a lifecycle change or inbound response.';

-- Preserve the useful part of legacy completion behavior without mutating legacy pat_status.
update public.crm_campaigns
set on_complete_engagement_state = case
      when lower(regexp_replace(coalesce(on_complete_status, ''), '[^a-z]+', '_', 'g')) in ('unresponsive_warm_', 'unresponsive_warm')
        then 'unresponsive_warm'::public.client_engagement_state_enum
      when lower(regexp_replace(coalesce(on_complete_status, ''), '[^a-z]+', '_', 'g')) in ('unresponsive_cold_', 'unresponsive_cold')
        then 'unresponsive_cold'::public.client_engagement_state_enum
      when lower(coalesce(on_complete_status, '')) like '%went dark%'
        then 'went_dark'::public.client_engagement_state_enum
      else on_complete_engagement_state
    end,
    on_complete_action = 'do_nothing',
    on_complete_status = null
where on_complete_action = 'change_status'
   or on_complete_status is not null;

-- Normalize the already-created client campaign triggers to the canonical dimension/value.
update public.crm_campaign_triggers
set trigger_dimension = 'lifecycle_stage',
    trigger_operator = 'equals',
    trigger_value = case
      when lower(coalesce(trigger_value, trigger_on_status, '')) in ('registered', 'registration') then 'registration'
      when lower(coalesce(trigger_value, trigger_on_status, '')) = 'intake' then 'intake'
      when lower(coalesce(trigger_value, trigger_on_status, '')) = 'matching' then 'matching'
      when lower(coalesce(trigger_value, trigger_on_status, '')) = 'matched' then 'matched'
      when lower(coalesce(trigger_value, trigger_on_status, '')) = 'scheduled' then 'scheduled'
      when lower(coalesce(trigger_value, trigger_on_status, '')) in ('early care', 'early_care', 'early sessions') then 'early_care'
      when lower(coalesce(trigger_value, trigger_on_status, '')) in ('established care', 'established_care', 'established') then 'established_care'
      when lower(coalesce(trigger_value, trigger_on_status, '')) = 'closed' then 'closed'
      else trigger_value
    end,
    trigger_event = 'lifecycle_changed',
    trigger_version = greatest(coalesce(trigger_version, 1), 1),
    is_manual_only = false,
    trigger_on_status = null
where coalesce(trigger_dimension, '') in ('lifecycle', 'lifecycle_stage')
   or lower(coalesce(trigger_on_status, '')) in (
     'registered','registration','intake','matching','matched','scheduled',
     'early care','early_care','early sessions','established care','established_care','established','closed'
   );

-- Waitlist is not a canonical lifecycle stage anymore. Keep the record for audit, but do not fire it.
update public.crm_campaign_triggers
set is_active = false
where lower(coalesce(trigger_value, trigger_on_status, '')) = 'waitlist';

create unique index if not exists crm_campaign_triggers_unique_lifecycle_entry
  on public.crm_campaign_triggers (tenant_id, trigger_dimension, trigger_value)
  where is_active
    and not coalesce(is_manual_only, false)
    and trigger_dimension = 'lifecycle_stage';

-- Direct-mode campaign enrollment while the newer trigger control plane remains in shadow.
-- This is the existing canonical trigger function with an explicit Do Not Contact enrollment block.
create or replace function public.crm_process_canonical_campaign_triggers()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_trigger record;
  v_campaign record;
  v_existing uuid;
  v_enrollment_id uuid;
  v_first_step record;
  v_scheduled timestamptz;
begin
  if new.to_value is null then
    return new;
  end if;

  -- After cutover the campaign trigger engine owns automatic enrolment.
  if private.crm_control_plane_flag(new.tenant_id, 'client_trigger_cutover_enabled') then
    return new;
  end if;

  -- Contact policy is a global campaign block, not a campaign-editor dimension.
  if exists (
    select 1
    from public.clients c
    where c.id = new.client_id
      and c.tenant_id = new.tenant_id
      and c.contact_policy::text = 'do_not_contact'
  ) then
    return new;
  end if;

  for v_trigger in
    select ct.*
    from public.crm_campaign_triggers ct
    where ct.tenant_id = new.tenant_id
      and ct.is_active = true
      and ct.is_manual_only = false
      and ct.trigger_dimension = new.dimension::text
      and (
        (ct.trigger_operator = 'equals' and ct.trigger_value = new.to_value)
        or (ct.trigger_operator = 'not_equals' and ct.trigger_value <> new.to_value)
        or (ct.trigger_operator = 'any')
      )
  loop
    select id, is_active into v_campaign
    from public.crm_campaigns
    where id = v_trigger.campaign_id;

    if v_campaign.id is null or v_campaign.is_active = false then
      continue;
    end if;

    select id into v_existing
    from public.crm_campaign_enrollments
    where client_id = new.client_id
      and campaign_id = v_trigger.campaign_id
      and status in ('active','paused')
    limit 1;

    if v_existing is not null then
      continue;
    end if;

    select id into v_existing
    from public.crm_campaign_enrollments
    where client_id = new.client_id and status = 'active'
    limit 1;

    if v_existing is not null then
      continue;
    end if;

    insert into public.crm_campaign_enrollments
      (campaign_id, client_id, tenant_id, current_step, status, enrolled_at)
    values
      (v_trigger.campaign_id, new.client_id, new.tenant_id, 0, 'active', now())
    returning id into v_enrollment_id;

    select id, delay_days, delay_hours, channel into v_first_step
    from public.crm_campaign_steps
    where campaign_id = v_trigger.campaign_id and is_active = true
    order by step_order limit 1;

    if v_first_step.id is not null then
      v_scheduled := now()
        + (coalesce(v_first_step.delay_days,0) || ' days')::interval
        + (coalesce(v_first_step.delay_hours,0) || ' hours')::interval;

      insert into public.crm_campaign_step_logs
        (enrollment_id, step_id, tenant_id, client_id, scheduled_for, status, channel)
      values
        (v_enrollment_id, v_first_step.id, new.tenant_id, new.client_id, v_scheduled, 'scheduled', v_first_step.channel);
    end if;

    insert into public.crm_activity_events (tenant_id, client_id, event_type, metadata)
    values (new.tenant_id, new.client_id, 'campaign_auto_enrolled', jsonb_build_object(
      'triggered_by', 'canonical_lifecycle_entry',
      'dimension', new.dimension::text,
      'value', new.to_value,
      'campaign_id', v_trigger.campaign_id,
      'enrollment_id', v_enrollment_id
    ));
  end loop;

  return new;
end;
$function$;

-- Stop every open client campaign before a lifecycle change can enroll the client in a new lifecycle campaign.
create or replace function private.crm_stop_client_campaigns_on_lifecycle_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_enrollment record;
  v_count integer := 0;
begin
  if new.state_dimension::text <> 'lifecycle_stage'
     or coalesce(new.source, '') = 'migration_backfill'
     or new.old_status is not distinct from new.new_status then
    return new;
  end if;

  for v_enrollment in
    select e.id, e.campaign_id, e.status
    from public.crm_campaign_enrollments e
    where e.tenant_id = new.tenant_id
      and e.client_id = new.client_id
      and e.status in ('active','paused')
    for update
  loop
    update public.crm_campaign_step_logs
    set status = 'skipped',
        skip_reason = 'lifecycle_changed',
        claimed_at = null,
        claim_token = null,
        updated_at = clock_timestamp()
    where enrollment_id = v_enrollment.id
      and status in ('scheduled','processing');

    update public.crm_campaign_enrollments
    set status = 'cancelled',
        completed_at = coalesce(completed_at, new.changed_at, clock_timestamp()),
        paused_at = coalesce(paused_at, new.changed_at, clock_timestamp()),
        pause_reason = 'lifecycle_changed',
        updated_at = clock_timestamp()
    where id = v_enrollment.id;

    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    insert into public.crm_activity_events (tenant_id, client_id, event_type, old_value, new_value, metadata)
    values (
      new.tenant_id,
      new.client_id,
      'campaigns_stopped_on_lifecycle_change',
      new.old_status,
      new.new_status,
      jsonb_build_object('stopped_enrollments', v_count, 'source', new.source, 'reason', new.reason)
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_05_crm_stop_campaigns_on_lifecycle_history on public.client_status_history;
create trigger trg_05_crm_stop_campaigns_on_lifecycle_history
after insert on public.client_status_history
for each row
when (new.state_dimension = 'lifecycle_stage'::public.client_state_dimension_enum)
execute function private.crm_stop_client_campaigns_on_lifecycle_change();

-- Canonical state history is the source of truth. Mirror new events into the CRM automation audit
-- so both the current direct trigger and the future control-plane trigger engine receive the same event.
create unique index if not exists crm_client_state_audit_canonical_history_correlation
  on public.crm_client_state_audit (correlation_id)
  where correlation_id is not null and source = 'canonical_client_state_history';

create or replace function private.crm_bridge_client_state_history_to_audit()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if coalesce(new.source, '') = 'migration_backfill' then
    return new;
  end if;

  insert into public.crm_client_state_audit (
    tenant_id, client_id, dimension, from_value, to_value, reason,
    actor_profile_id, actor_label, source, correlation_id, created_at
  ) values (
    new.tenant_id,
    new.client_id,
    new.state_dimension,
    new.old_status,
    new.new_status,
    new.reason,
    new.changed_by,
    'canonical_client_state_engine',
    'canonical_client_state_history',
    new.id,
    coalesce(new.changed_at, new.created_at, clock_timestamp())
  )
  on conflict (correlation_id) where correlation_id is not null and source = 'canonical_client_state_history'
  do nothing;

  return new;
end;
$function$;

drop trigger if exists trg_10_crm_bridge_client_state_history_to_audit on public.client_status_history;
create trigger trg_10_crm_bridge_client_state_history_to_audit
after insert on public.client_status_history
for each row
execute function private.crm_bridge_client_state_history_to_audit();

-- A newly-created client has entered their initial lifecycle even before any transition history exists.
create or replace function private.crm_emit_initial_client_lifecycle_audit()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.lifecycle_stage is null
     or coalesce(current_setting('valorwell.client_state_source', true), '') = 'migration_backfill' then
    return new;
  end if;

  insert into public.crm_client_state_audit (
    tenant_id, client_id, dimension, from_value, to_value, reason,
    actor_profile_id, actor_label, source, created_at
  ) values (
    new.tenant_id,
    new.id,
    'lifecycle_stage'::public.client_state_dimension_enum,
    null,
    new.lifecycle_stage::text,
    'Client entered initial lifecycle stage.',
    auth.uid(),
    'client_insert',
    'client_insert',
    clock_timestamp()
  );

  return new;
end;
$function$;

drop trigger if exists trg_crm_initial_client_lifecycle_audit on public.clients;
create trigger trg_crm_initial_client_lifecycle_audit
after insert on public.clients
for each row
execute function private.crm_emit_initial_client_lifecycle_audit();

-- Central response handler used by both inbound email and inbound SMS persistence.
create or replace function private.crm_handle_client_campaign_response(
  p_tenant_id uuid,
  p_client_id uuid,
  p_channel text,
  p_received_at timestamptz,
  p_correlation_id text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_enrollment_ids uuid[] := '{}'::uuid[];
  v_campaign_id uuid;
  v_creator uuid;
  v_stopped integer := 0;
  v_task_id uuid;
  v_previous_context jsonb;
  v_current_engagement public.client_engagement_state_enum;
  v_received_at timestamptz := coalesce(p_received_at, clock_timestamp());
  v_channel text := lower(btrim(coalesce(p_channel, '')));
begin
  if v_channel not in ('email','sms') then
    raise exception 'Unsupported campaign response channel: %', p_channel using errcode='22023';
  end if;

  if not exists (
    select 1 from public.clients c
    where c.id = p_client_id and c.tenant_id = p_tenant_id
  ) then
    return jsonb_build_object('handled', false, 'reason', 'client_not_found');
  end if;

  select
    coalesce(array_agg(e.id order by e.enrolled_at), '{}'::uuid[]),
    (array_agg(e.campaign_id order by e.enrolled_at desc))[1],
    (array_agg(c.created_by_profile_id order by e.enrolled_at desc))[1]
  into v_enrollment_ids, v_campaign_id, v_creator
  from public.crm_campaign_enrollments e
  join public.crm_campaigns c on c.id = e.campaign_id and c.tenant_id = e.tenant_id
  where e.tenant_id = p_tenant_id
    and e.client_id = p_client_id
    and e.status in ('active','paused');

  v_stopped := coalesce(cardinality(v_enrollment_ids), 0);
  if v_stopped = 0 then
    return jsonb_build_object('handled', false, 'reason', 'no_open_campaign');
  end if;

  update public.crm_campaign_step_logs
  set status = 'skipped',
      skip_reason = 'client_responded',
      claimed_at = null,
      claim_token = null,
      updated_at = clock_timestamp()
  where enrollment_id = any(v_enrollment_ids)
    and status in ('scheduled','processing');

  update public.crm_campaign_enrollments
  set status = 'responded',
      completed_at = coalesce(completed_at, v_received_at),
      paused_at = coalesce(paused_at, v_received_at),
      pause_reason = v_channel || '_response',
      updated_at = clock_timestamp()
  where id = any(v_enrollment_ids)
    and status in ('active','paused');

  -- A response proves the client is currently responsive. Preserve the canonical state engine audit path.
  select c.engagement_state into v_current_engagement
  from public.clients c
  where c.id = p_client_id and c.tenant_id = p_tenant_id
  for update;

  if v_current_engagement is distinct from 'normal'::public.client_engagement_state_enum then
    v_previous_context := public.client_state_engine_begin_context(
      'campaign_response',
      format('Inbound %s response stopped automated client campaign messaging.', v_channel),
      null
    );
    begin
      update public.clients
      set engagement_state = 'normal'::public.client_engagement_state_enum
      where id = p_client_id and tenant_id = p_tenant_id;
      perform public.client_state_engine_restore_context(v_previous_context);
    exception when others then
      perform public.client_state_engine_restore_context(v_previous_context);
      raise;
    end;
  end if;

  -- Reuse one open dashboard task per client until a staff member resolves it.
  select t.id into v_task_id
  from public.crm_tasks t
  where t.tenant_id = p_tenant_id
    and t.client_id = p_client_id
    and t.type = 'client_follow_up'::public.crm_task_type_enum
    and t.status in ('not_started','in_progress','waiting','blocked')
    and 'personalized-response-required' = any(t.tags)
  order by t.created_at desc
  limit 1;

  if v_creator is null then
    select cap.profile_id into v_creator
    from public.crm_user_capabilities cap
    where cap.tenant_id = p_tenant_id
      and cap.crm_role::text in ('crm_admin','crm_operator')
    order by case cap.crm_role::text when 'crm_admin' then 0 else 1 end, cap.granted_at
    limit 1;
  end if;

  if v_task_id is null and v_creator is not null then
    insert into public.crm_tasks (
      tenant_id, title, description, client_id, campaign_id,
      type, priority, status, created_by_profile_id, start_at, due_at, tags
    ) values (
      p_tenant_id,
      'Needs Personalized Response',
      format('Client sent an inbound %s while enrolled in an automated campaign. Automated campaign messaging was stopped. A personalized response is required.', upper(v_channel)),
      p_client_id,
      v_campaign_id,
      'client_follow_up'::public.crm_task_type_enum,
      'high'::public.crm_task_priority_enum,
      'not_started'::public.crm_task_status_enum,
      v_creator,
      v_received_at,
      v_received_at + interval '1 day',
      array['campaign-response','personalized-response-required',v_channel]::text[]
    ) returning id into v_task_id;
  elsif v_task_id is not null then
    update public.crm_tasks
    set campaign_id = coalesce(campaign_id, v_campaign_id),
        priority = 'high'::public.crm_task_priority_enum,
        updated_at = clock_timestamp()
    where id = v_task_id;
  end if;

  insert into public.crm_activity_events (tenant_id, client_id, event_type, metadata)
  values (
    p_tenant_id,
    p_client_id,
    'campaign_response_requires_personalized_reply',
    jsonb_build_object(
      'channel', v_channel,
      'correlation_id', p_correlation_id,
      'stopped_enrollments', v_stopped,
      'campaign_id', v_campaign_id,
      'task_id', v_task_id
    )
  );

  perform public.trg_enqueue_clickup_sync(p_client_id);

  return jsonb_build_object(
    'handled', true,
    'stoppedEnrollments', v_stopped,
    'taskId', v_task_id,
    'engagementState', 'normal'
  );
end;
$function$;

create or replace function private.crm_handle_inbound_email_campaign_response()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.direction = 'inbound' and new.client_id is not null and new.tenant_id is not null then
    perform private.crm_handle_client_campaign_response(
      new.tenant_id,
      new.client_id,
      'email',
      coalesce(new.received_at, new.occurred_at, new.created_at, clock_timestamp()),
      coalesce(new.provider_message_id, new.id::text)
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_crm_inbound_email_stops_client_campaign on public.crm_email_messages;
create trigger trg_crm_inbound_email_stops_client_campaign
after insert on public.crm_email_messages
for each row
when (new.direction = 'inbound' and new.client_id is not null)
execute function private.crm_handle_inbound_email_campaign_response();

create or replace function private.crm_handle_inbound_sms_campaign_response()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.client_id is not null and new.tenant_id is not null then
    perform private.crm_handle_client_campaign_response(
      new.tenant_id,
      new.client_id,
      'sms',
      coalesce(new.received_at, new.created_at, clock_timestamp()),
      coalesce(new.ringcentral_message_id, new.id::text)
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_crm_inbound_sms_stops_client_campaign on public.crm_inbound_sms_logs;
create trigger trg_crm_inbound_sms_stops_client_campaign
after insert on public.crm_inbound_sms_logs
for each row
when (new.client_id is not null)
execute function private.crm_handle_inbound_sms_campaign_response();

-- Apply completion outcomes from the authoritative final-step send event. Lifecycle progression
-- is intentionally not fabricated by the campaign: if a lifecycle target is recorded, it must
-- match the client's current lifecycle. Real progression remains owned by the underlying workflow.
create or replace function private.crm_apply_client_campaign_completion()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_step public.crm_campaign_steps%rowtype;
  v_enrollment public.crm_campaign_enrollments%rowtype;
  v_campaign public.crm_campaigns%rowtype;
  v_client public.clients%rowtype;
  v_previous_context jsonb;
begin
  if new.status <> 'sent' or old.status is not distinct from new.status then
    return new;
  end if;

  select * into v_step from public.crm_campaign_steps where id = new.step_id;
  if not found then return new; end if;

  select * into v_enrollment
  from public.crm_campaign_enrollments
  where id = new.enrollment_id
  for update;
  if not found or v_enrollment.status <> 'active' then return new; end if;

  if exists (
    select 1
    from public.crm_campaign_steps s
    where s.campaign_id = v_enrollment.campaign_id
      and s.is_active
      and s.step_order > v_step.step_order
  ) then
    return new;
  end if;

  select * into v_campaign
  from public.crm_campaigns
  where id = v_enrollment.campaign_id and tenant_id = v_enrollment.tenant_id;
  if not found then return new; end if;

  select * into v_client
  from public.clients
  where id = v_enrollment.client_id and tenant_id = v_enrollment.tenant_id
  for update;
  if not found then return new; end if;

  update public.crm_campaign_enrollments
  set status = 'completed',
      completed_at = coalesce(completed_at, new.sent_at, clock_timestamp()),
      current_step = v_step.step_order,
      updated_at = clock_timestamp()
  where id = v_enrollment.id and status = 'active';

  if v_campaign.on_complete_engagement_state is not null
     and v_client.engagement_state is distinct from v_campaign.on_complete_engagement_state then
    v_previous_context := public.client_state_engine_begin_context(
      'engagement_workflow',
      format('Campaign %s completed all automated steps.', v_campaign.name),
      v_campaign.created_by_profile_id
    );
    begin
      update public.clients
      set engagement_state = v_campaign.on_complete_engagement_state
      where id = v_client.id and tenant_id = v_client.tenant_id;
      perform public.client_state_engine_restore_context(v_previous_context);
    exception when others then
      perform public.client_state_engine_restore_context(v_previous_context);
      raise;
    end;
  end if;

  if v_campaign.on_complete_lifecycle_stage is not null
     and v_client.lifecycle_stage is distinct from v_campaign.on_complete_lifecycle_stage then
    insert into public.crm_activity_events (tenant_id, client_id, event_type, metadata)
    values (
      v_client.tenant_id,
      v_client.id,
      'campaign_completion_lifecycle_not_applied',
      jsonb_build_object(
        'campaign_id', v_campaign.id,
        'configured_lifecycle', v_campaign.on_complete_lifecycle_stage::text,
        'current_lifecycle', v_client.lifecycle_stage::text,
        'reason', 'Canonical lifecycle progression requires the underlying workflow event.'
      )
    );
  end if;

  insert into public.crm_activity_events (tenant_id, client_id, event_type, metadata)
  values (
    v_client.tenant_id,
    v_client.id,
    'campaign_completed_canonical_outcome',
    jsonb_build_object(
      'campaign_id', v_campaign.id,
      'enrollment_id', v_enrollment.id,
      'lifecycle', v_client.lifecycle_stage::text,
      'engagement_outcome', v_campaign.on_complete_engagement_state::text
    )
  );

  perform public.trg_enqueue_clickup_sync(v_client.id);
  return new;
end;
$function$;

drop trigger if exists trg_crm_apply_client_campaign_completion on public.crm_campaign_step_logs;
create trigger trg_crm_apply_client_campaign_completion
after update of status on public.crm_campaign_step_logs
for each row
when (new.status = 'sent' and old.status is distinct from new.status)
execute function private.crm_apply_client_campaign_completion();
