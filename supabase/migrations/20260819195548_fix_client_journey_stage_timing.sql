create or replace function public.ai_ops_build_client_journey_batches(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamptz default now(),
  p_batch_size integer default 6
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_batch_size integer := least(greatest(coalesce(p_batch_size, 6), 5), 8);
  v_prompt_version text := '2';
  v_row record;
  v_entities jsonb := '[]'::jsonb;
  v_batch_index integer := 0;
  v_total integer := 0;
  v_reused integer := 0;
  v_fresh integer := 0;
  v_batches integer := 0;
  v_entity_key text;
  v_eval_hash text;
  v_payload jsonb;
  v_signals text[];
  v_stage_timing_signals text[];
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  for v_row in
    select
      c.id,
      c.lifecycle_stage::text as lifecycle_stage,
      c.engagement_state::text as engagement_state,
      c.eligibility_state::text as eligibility_state,
      c.contact_policy::text as contact_policy,
      c.service_policy::text as service_policy,
      c.care_cadence::text as care_cadence,
      c.at_risk,
      c.at_risk_since,
      c.primary_staff_id is not null as has_clinician,
      c.closed_at,
      c.closure_reason::text as closure_reason,
      c.last_contact_at,
      c.last_contact_direction,
      c.last_contact_channel,
      c.lifecycle_stage_changed_at,
      case when c.last_contact_at is null then null
           else floor(extract(epoch from (p_cutoff_at - c.last_contact_at)) / 86400)::int end as days_since_contact,
      case when c.lifecycle_stage_changed_at is null then null
           else greatest(0, floor(extract(epoch from (p_cutoff_at - c.lifecycle_stage_changed_at)) / 86400)::int) end as days_in_stage,
      (select m.state::text from public.client_therapist_matches m
        where m.client_id = c.id and m.resolved_at is null
        order by m.created_at desc limit 1) as therapist_match_state,
      (select m.scheduling_branch from public.client_therapist_matches m
        where m.client_id = c.id and m.resolved_at is null
        order by m.created_at desc limit 1) as therapist_match_scheduling_branch,
      (select m.expires_at from public.client_therapist_matches m
        where m.client_id = c.id and m.resolved_at is null
        order by m.created_at desc limit 1) as therapist_match_expires_at,
      (select s.prov_self_scheduling_enabled from public.staff s
        where s.id = c.primary_staff_id and s.tenant_id = c.tenant_id
        limit 1) as clinician_self_scheduling_enabled,
      (select count(*) from public.appointments a
        where a.client_id = c.id and a.start_at > p_cutoff_at
          and a.status::text not in ('cancelled','no_show'))::int as upcoming_appointments,
      (select min(a.start_at) from public.appointments a
        where a.client_id = c.id and a.start_at > p_cutoff_at
          and a.status::text not in ('cancelled','no_show')) as next_appointment_at,
      (select max(a.start_at) from public.appointments a
        where a.client_id = c.id and a.start_at <= p_cutoff_at
          and a.status::text not in ('cancelled','no_show')) as last_appointment_at,
      (select count(*) from public.appointments a
        where a.client_id = c.id
          and a.start_at between p_cutoff_at - interval '30 days' and p_cutoff_at
          and a.status::text in ('cancelled','no_show'))::int as recent_cancellations,
      (select count(*) from public.client_journey_exceptions e
        where e.client_id = c.id and e.resolution_state = 'open')::int as open_exceptions,
      (select count(*) from public.client_support_requests r
        where r.client_id = c.id and coalesce(r.status,'open') not in ('resolved','closed'))::int as open_support_requests,
      (
        c.lifecycle_stage::text = 'matched'
        and c.lifecycle_stage_changed_at is not null
        and c.lifecycle_stage_changed_at <= p_cutoff_at - interval '24 hours'
        and exists (
          select 1 from public.staff s
          where s.id = c.primary_staff_id
            and s.tenant_id = c.tenant_id
            and s.prov_self_scheduling_enabled is false
        )
        and not exists (
          select 1 from public.appointments a
          where a.client_id = c.id and a.created_at >= c.lifecycle_stage_changed_at
        )
      ) as therapist_led_no_movement_24h,
      (
        c.lifecycle_stage::text = 'matched'
        and c.lifecycle_stage_changed_at is not null
        and c.lifecycle_stage_changed_at <= p_cutoff_at - interval '3 days'
        and exists (
          select 1 from public.staff s
          where s.id = c.primary_staff_id
            and s.tenant_id = c.tenant_id
            and s.prov_self_scheduling_enabled is true
        )
        and not exists (
          select 1 from public.appointments a
          where a.client_id = c.id and a.created_at >= c.lifecycle_stage_changed_at
        )
      ) as self_scheduling_no_movement_3d,
      (select count(*) from public.appointments a
        where a.client_id = c.id and c.at_risk_since is not null
          and a.created_at >= c.at_risk_since)::int as appointments_since_at_risk
    from public.clients c
    where c.tenant_id = p_tenant_id
      and (
        coalesce(c.lifecycle_stage::text, '') <> 'closed'
        or (c.closed_at is not null and c.closed_at >= p_cutoff_at - interval '24 hours')
      )
    order by c.id
  loop
    v_total := v_total + 1;
    v_entity_key := 'c' || left(md5(v_row.id::text || p_run_id::text), 12);
    v_signals := '{}'::text[];
    v_stage_timing_signals := '{}'::text[];

    -- Stage timing is intentionally workflow-specific. Raw age in a stage is context only.
    -- Registration and Intake timing is handled by campaign/engagement state, not a generic AI age rule.
    -- Matching may legitimately remain open while provider availability is being worked, so age alone is never a concern.
    if v_row.lifecycle_stage = 'matching'
       and v_row.therapist_match_expires_at is not null
       and v_row.therapist_match_expires_at < p_cutoff_at then
      v_stage_timing_signals := array_append(v_stage_timing_signals, 'therapistMatchExpiredUnresolved'::text);
      v_signals := array_append(v_signals, 'therapistMatchExpiredUnresolved'::text);
    end if;

    if v_row.therapist_led_no_movement_24h then
      v_stage_timing_signals := array_append(v_stage_timing_signals, 'therapistLedSchedulingNoMovement24h'::text);
      v_signals := array_append(v_signals, 'therapistLedSchedulingNoMovement24h'::text);
    end if;

    if v_row.self_scheduling_no_movement_3d then
      v_stage_timing_signals := array_append(v_stage_timing_signals, 'selfSchedulingNoMovement3d'::text);
      v_signals := array_append(v_signals, 'selfSchedulingNoMovement3d'::text);
    end if;

    if v_row.lifecycle_stage = 'scheduled' and v_row.upcoming_appointments = 0 then
      v_stage_timing_signals := array_append(v_stage_timing_signals, 'scheduledWithoutFutureAppointment'::text);
      v_signals := array_append(v_signals, 'scheduledWithoutFutureAppointment'::text);
    end if;

    if v_row.lifecycle_stage in ('early_care','established_care')
       and v_row.care_cadence = 'regular'
       and v_row.at_risk
       and v_row.upcoming_appointments = 0 then
      v_stage_timing_signals := array_append(v_stage_timing_signals, 'regularCareContinuityAtRisk'::text);
      v_signals := array_append(v_signals, 'regularCareContinuityAtRisk'::text);
    end if;

    if v_row.recent_cancellations > 0
       and v_row.upcoming_appointments = 0
       and v_row.lifecycle_stage in ('scheduled','early_care','established_care') then
      v_signals := array_append(v_signals, 'cancelledWithoutReschedule'::text);
    end if;

    if v_row.recent_cancellations >= 2
       and v_row.lifecycle_stage in ('scheduled','early_care','established_care') then
      v_signals := array_append(v_signals, 'recentRepeatedCancellationOrNoShow'::text);
    end if;

    if v_row.lifecycle_stage in ('matched','scheduled','early_care','established_care')
       and not v_row.has_clinician then
      v_signals := array_append(v_signals, 'unassignedClinician'::text);
    end if;

    -- A therapist-match row is not itself an operational problem. Only stage-consistent timing failures above are signals.

    if v_row.engagement_state in ('unresponsive_warm','unresponsive_cold','went_dark') then
      v_signals := array_append(v_signals, 'engagementStateIndicatesUnresponsive'::text);
      if v_row.upcoming_appointments = 0 then
        v_signals := array_append(v_signals, 'noRecentContactAndNoFutureAppointment'::text);
      end if;
    end if;

    if v_row.open_support_requests > 0 then
      v_signals := array_append(v_signals, 'openSupportRequest'::text);
    end if;

    if v_row.open_exceptions > 0 then
      v_signals := array_append(v_signals, 'hasOpenJourneyException'::text);
    end if;

    if v_row.at_risk and v_row.at_risk_since is not null
       and v_row.appointments_since_at_risk = 0
       and (v_row.last_contact_at is null or v_row.last_contact_at < v_row.at_risk_since) then
      v_signals := array_append(v_signals, 'atRiskWithoutRecentProgress'::text);
    end if;

    if v_row.lifecycle_stage = 'closed'
       and (v_row.open_exceptions > 0 or v_row.open_support_requests > 0) then
      v_signals := array_append(v_signals, 'closedWithUnresolvedOperationalItems'::text);
    end if;

    if (v_row.lifecycle_stage in ('registration','intake','matching') and v_row.upcoming_appointments > 0)
       or (v_row.lifecycle_stage = 'closed' and v_row.upcoming_appointments > 0) then
      v_signals := array_append(v_signals, 'lifecycleAppointmentConflict'::text);
    end if;

    if v_row.eligibility_state in ('coverage_issue','manual_review')
       and v_row.lifecycle_stage <> 'closed' then
      v_signals := array_append(v_signals, 'eligibilityBlockingProgress'::text);
    end if;

    v_payload := jsonb_build_object(
      'entityKey', v_entity_key,
      'lifecycleStage', v_row.lifecycle_stage,
      'engagementState', v_row.engagement_state,
      'eligibilityState', v_row.eligibility_state,
      'contactPolicy', v_row.contact_policy,
      'servicePolicy', v_row.service_policy,
      'careCadence', v_row.care_cadence,
      'atRisk', v_row.at_risk,
      'daysAtRisk', case when v_row.at_risk_since is null then null
        else greatest(0, floor(extract(epoch from (p_cutoff_at - v_row.at_risk_since)) / 86400)::int) end,
      'hasAssignedClinician', v_row.has_clinician,
      'therapistMatchState', case when v_row.lifecycle_stage in ('matching','matched') then v_row.therapist_match_state else null end,
      'therapistMatchSchedulingBranch', case when v_row.lifecycle_stage in ('matching','matched') then v_row.therapist_match_scheduling_branch else null end,
      'daysSinceLastContact', v_row.days_since_contact,
      'lastContactDirection', v_row.last_contact_direction,
      'lastContactChannel', v_row.last_contact_channel,
      'daysInCurrentStage', v_row.days_in_stage,
      'stageAgeIsInformationalOnly', true,
      'stageTimingSignals', to_jsonb(v_stage_timing_signals),
      'upcomingAppointments', v_row.upcoming_appointments,
      'daysUntilNextAppointment', case when v_row.next_appointment_at is null then null
        else floor(extract(epoch from (v_row.next_appointment_at - p_cutoff_at)) / 86400)::int end,
      'daysSinceLastAppointment', case when v_row.last_appointment_at is null then null
        else greatest(0, floor(extract(epoch from (p_cutoff_at - v_row.last_appointment_at)) / 86400)::int) end,
      'cancellationsOrNoShowsLast30Days', v_row.recent_cancellations,
      'openOperationalExceptions', v_row.open_exceptions,
      'openSupportRequests', v_row.open_support_requests,
      'closedInLastDay', v_row.closed_at is not null,
      'closureReason', v_row.closure_reason,
      'derivedSignals', to_jsonb(v_signals)
    );

    v_eval_hash := md5((v_payload - 'entityKey')::text);

    insert into private.ai_ops_snapshots (
      tenant_id, entity_type, entity_id, snapshot_type, snapshot_hash, evaluation_hash,
      cutoff_at, payload, expires_at
    ) values (
      p_tenant_id, 'client', v_row.id::text, 'client_journey:' || p_run_id::text,
      v_entity_key, v_eval_hash, p_cutoff_at, v_payload, now() + interval '14 days'
    );

    if exists (
      select 1
      from private.ai_ops_snapshots s
      join private.ai_ops_work_items w
        on w.tenant_id = s.tenant_id
       and w.module = 'client_journey'
       and w.status = 'completed'
       and w.structured_result is not null
       and w.prompt_version = v_prompt_version
       and w.created_at >= now() - interval '7 days'
      where s.tenant_id = p_tenant_id
        and s.entity_type = 'client'
        and s.entity_id = v_row.id::text
        and s.evaluation_hash = v_eval_hash
        and s.snapshot_type <> 'client_journey:' || p_run_id::text
        and w.input_payload::text like '%' || s.snapshot_hash || '%'
    ) then
      v_reused := v_reused + 1;
      continue;
    end if;

    v_fresh := v_fresh + 1;
    v_entities := v_entities || v_payload;

    if jsonb_array_length(v_entities) >= v_batch_size then
      v_batch_index := v_batch_index + 1;
      perform public.ai_ops_enqueue_work(
        p_tenant_id, p_run_id, 'client_journey',
        'client_journey:' || p_run_id::text || ':' || v_batch_index::text,
        'client_journey_review',
        jsonb_build_object('entities', v_entities),
        v_prompt_version, '1', 100, null, '{}'::uuid[]
      );
      v_batches := v_batches + 1;
      v_entities := '[]'::jsonb;
    end if;
  end loop;

  if jsonb_array_length(v_entities) > 0 then
    v_batch_index := v_batch_index + 1;
    perform public.ai_ops_enqueue_work(
      p_tenant_id, p_run_id, 'client_journey',
      'client_journey:' || p_run_id::text || ':' || v_batch_index::text,
      'client_journey_review',
      jsonb_build_object('entities', v_entities),
      v_prompt_version, '1', 100, null, '{}'::uuid[]
    );
    v_batches := v_batches + 1;
  end if;

  return jsonb_build_object(
    'clientsTargeted', v_total,
    'clientsAccounted', v_total,
    'freshlyQueued', v_fresh,
    'reused', v_reused,
    'unavailable', 0,
    'batchesQueued', v_batches,
    'promptVersion', v_prompt_version,
    'cutoffAt', p_cutoff_at
  );
end;
$function$;

comment on function public.ai_ops_build_client_journey_batches(uuid,uuid,timestamptz,integer) is
'Builds Client Journey AI review batches. daysInCurrentStage uses lifecycle_stage_changed_at. Stage age alone is informational; timing concerns are emitted only through stage-specific deterministic stageTimingSignals.';
