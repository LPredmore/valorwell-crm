-- Client Journey deterministic daily census and material-state model gate.
-- The census always runs. client_journey_ai_enabled controls only Gemini execution.
-- Volatile age counters remain evidence but are excluded from the material-state fingerprint.

CREATE OR REPLACE FUNCTION public.ai_ops_build_client_journey_batches(p_tenant_id uuid, p_run_id uuid, p_cutoff_at timestamp with time zone DEFAULT now(), p_batch_size integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_batch_size integer := least(greatest(coalesce(p_batch_size, 6), 5), 8);
  v_prompt_version text := '4';
  v_material_state_version text := '4';
  v_model_enabled boolean := false;
  v_row record;
  v_entities jsonb := '[]'::jsonb;
  v_batch_index integer := 0;
  v_total integer := 0;
  v_deterministic_no_model integer := 0;
  v_model_review_candidates integer := 0;
  v_queued_candidates integer := 0;
  v_suppressed_candidates integer := 0;
  v_batches integer := 0;
  v_entity_key text;
  v_eval_hash text;
  v_prior_eval_hash text;
  v_payload jsonb;
  v_material_state jsonb;
  v_signals text[];
  v_stage_timing_signals text[];
  v_review_reasons text[];
  v_active_exceptions jsonb;
  v_material_exceptions jsonb;
  v_active_exception_count integer;
  v_active_ai_findings jsonb;
  v_material_ai_findings jsonb;
  v_active_ai_finding_count integer;
  v_active_exceptions_total integer := 0;
  v_active_exception_clients integer := 0;
  v_overdue_exceptions integer := 0;
  v_new_exceptions_today integer := 0;
  v_has_active_issue boolean;
  v_material_changed boolean;
  v_is_candidate boolean;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  select coalesce(f.enabled, false)
    into v_model_enabled
  from private.ai_ops_flags f
  where f.tenant_id = p_tenant_id
    and f.flag_name = 'client_journey_ai_enabled'
  limit 1;
  v_model_enabled := coalesce(v_model_enabled, false);

  select
    count(*) filter (where e.resolution_state in ('open','in_progress'))::int,
    count(distinct e.client_id) filter (where e.resolution_state in ('open','in_progress'))::int,
    count(*) filter (
      where e.resolution_state in ('open','in_progress')
        and e.review_due_at is not null
        and e.review_due_at < p_cutoff_at
    )::int,
    count(*) filter (
      where (e.created_at at time zone 'America/Chicago')::date =
            (p_cutoff_at at time zone 'America/Chicago')::date
    )::int
  into v_active_exceptions_total, v_active_exception_clients, v_overdue_exceptions, v_new_exceptions_today
  from public.client_journey_exceptions e
  where e.tenant_id = p_tenant_id;

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
    v_review_reasons := '{}'::text[];

    select
      coalesce(jsonb_agg(jsonb_build_object(
        'exceptionKey', private.ai_ops_client_journey_exception_key(e.id),
        'reasonCode', e.reason_code,
        'category', e.category,
        'exceptionType', e.exception_type,
        'reasonDetail', left(e.reason_detail, 600),
        'nextAction', left(e.next_action, 600),
        'resolutionState', e.resolution_state,
        'ownerAssigned', e.owner_profile_id is not null,
        'reviewDueAt', e.review_due_at,
        'overdue', e.review_due_at is not null and e.review_due_at < p_cutoff_at,
        'ageDays', greatest(0, floor(extract(epoch from (p_cutoff_at - e.created_at)) / 86400)::int),
        'daysSinceUpdated', greatest(0, floor(extract(epoch from (p_cutoff_at - e.updated_at)) / 86400)::int),
        'source', e.source,
        'relatedEntityType', e.related_entity_type
      ) order by e.id), '[]'::jsonb),
      coalesce(jsonb_agg(jsonb_build_object(
        'exceptionKey', private.ai_ops_client_journey_exception_key(e.id),
        'reasonCode', e.reason_code,
        'category', e.category,
        'exceptionType', e.exception_type,
        'resolutionState', e.resolution_state,
        'ownerAssigned', e.owner_profile_id is not null,
        'overdue', e.review_due_at is not null and e.review_due_at < p_cutoff_at,
        'reasonDetailHash', md5(coalesce(e.reason_detail,'')),
        'nextActionHash', md5(coalesce(e.next_action,'')),
        'source', e.source,
        'relatedEntityType', e.related_entity_type
      ) order by e.id), '[]'::jsonb),
      count(*)::int
    into v_active_exceptions, v_material_exceptions, v_active_exception_count
    from public.client_journey_exceptions e
    where e.tenant_id = p_tenant_id
      and e.client_id = v_row.id
      and e.resolution_state in ('open','in_progress');

    select
      coalesce(jsonb_agg(jsonb_build_object(
        'findingKey', 'a' || left(md5(f.id::text), 12),
        'status', f.status,
        'severity', f.severity,
        'title', left(coalesce(f.title,''),300),
        'summary', left(coalesce(f.summary,''),600),
        'relatedExceptionKey', case when f.related_existing_exception_id is null then null
          else private.ai_ops_client_journey_exception_key(f.related_existing_exception_id) end
      ) order by f.id), '[]'::jsonb),
      coalesce(jsonb_agg(jsonb_build_object(
        'findingKey', 'a' || left(md5(f.id::text), 12),
        'status', f.status,
        'severity', f.severity,
        'relatedExceptionKey', case when f.related_existing_exception_id is null then null
          else private.ai_ops_client_journey_exception_key(f.related_existing_exception_id) end
      ) order by f.id), '[]'::jsonb),
      count(*)::int
    into v_active_ai_findings, v_material_ai_findings, v_active_ai_finding_count
    from public.ai_operations_findings f
    where f.tenant_id = p_tenant_id
      and f.module = 'client_journey'
      and f.entity_type = 'client'
      and f.entity_id = v_row.id::text
      and f.status in ('open','snoozed')
      and f.related_existing_exception_id is null;

    if v_row.lifecycle_stage = 'matching'
       and v_row.therapist_match_expires_at is not null
       and v_row.therapist_match_expires_at < p_cutoff_at then
      v_stage_timing_signals := array_append(v_stage_timing_signals, 'therapistMatchExpiredUnresolved');
      v_signals := array_append(v_signals, 'therapistMatchExpiredUnresolved');
    end if;
    if v_row.therapist_led_no_movement_24h then
      v_stage_timing_signals := array_append(v_stage_timing_signals, 'therapistLedSchedulingNoMovement24h');
      v_signals := array_append(v_signals, 'therapistLedSchedulingNoMovement24h');
    end if;
    if v_row.self_scheduling_no_movement_3d then
      v_stage_timing_signals := array_append(v_stage_timing_signals, 'selfSchedulingNoMovement3d');
      v_signals := array_append(v_signals, 'selfSchedulingNoMovement3d');
    end if;
    if v_row.lifecycle_stage = 'scheduled' and v_row.upcoming_appointments = 0 then
      v_stage_timing_signals := array_append(v_stage_timing_signals, 'scheduledWithoutFutureAppointment');
      v_signals := array_append(v_signals, 'scheduledWithoutFutureAppointment');
    end if;
    if v_row.lifecycle_stage in ('early_care','established_care')
       and v_row.care_cadence = 'regular'
       and v_row.at_risk
       and v_row.upcoming_appointments = 0 then
      v_stage_timing_signals := array_append(v_stage_timing_signals, 'regularCareContinuityAtRisk');
      v_signals := array_append(v_signals, 'regularCareContinuityAtRisk');
    end if;
    if v_row.recent_cancellations > 0
       and v_row.upcoming_appointments = 0
       and v_row.lifecycle_stage in ('scheduled','early_care','established_care') then
      v_signals := array_append(v_signals, 'cancelledWithoutReschedule');
    end if;
    if v_row.recent_cancellations >= 2
       and v_row.lifecycle_stage in ('scheduled','early_care','established_care') then
      v_signals := array_append(v_signals, 'recentRepeatedCancellationOrNoShow');
    end if;
    if v_row.lifecycle_stage in ('matched','scheduled','early_care','established_care')
       and not v_row.has_clinician then
      v_signals := array_append(v_signals, 'unassignedClinician');
    end if;
    if v_row.engagement_state in ('unresponsive_warm','unresponsive_cold','went_dark') then
      v_signals := array_append(v_signals, 'engagementStateIndicatesUnresponsive');
      if v_row.upcoming_appointments = 0 then
        v_signals := array_append(v_signals, 'noRecentContactAndNoFutureAppointment');
      end if;
    end if;
    if v_row.open_support_requests > 0 then
      v_signals := array_append(v_signals, 'openSupportRequest');
    end if;
    if v_active_exception_count > 0 then
      v_signals := array_append(v_signals, 'hasActiveJourneyException');
    end if;
    if v_row.at_risk and v_row.at_risk_since is not null
       and v_row.appointments_since_at_risk = 0
       and (v_row.last_contact_at is null or v_row.last_contact_at < v_row.at_risk_since) then
      v_signals := array_append(v_signals, 'atRiskWithoutRecentProgress');
    end if;
    if v_row.lifecycle_stage = 'closed'
       and (v_active_exception_count > 0 or v_row.open_support_requests > 0) then
      v_signals := array_append(v_signals, 'closedWithUnresolvedOperationalItems');
    end if;
    if (v_row.lifecycle_stage in ('registration','intake','matching') and v_row.upcoming_appointments > 0)
       or (v_row.lifecycle_stage = 'closed' and v_row.upcoming_appointments > 0) then
      v_signals := array_append(v_signals, 'lifecycleAppointmentConflict');
    end if;
    if v_row.eligibility_state in ('coverage_issue','manual_review')
       and v_row.lifecycle_stage <> 'closed' then
      v_signals := array_append(v_signals, 'eligibilityBlockingProgress');
    end if;

    v_material_state := jsonb_build_object(
      'version', v_material_state_version,
      'lifecycleStage', v_row.lifecycle_stage,
      'engagementState', v_row.engagement_state,
      'eligibilityState', v_row.eligibility_state,
      'contactPolicy', v_row.contact_policy,
      'servicePolicy', v_row.service_policy,
      'careCadence', v_row.care_cadence,
      'atRisk', v_row.at_risk,
      'hasAssignedClinician', v_row.has_clinician,
      'therapistMatchState', case when v_row.lifecycle_stage in ('matching','matched') then v_row.therapist_match_state else null end,
      'therapistMatchSchedulingBranch', case when v_row.lifecycle_stage in ('matching','matched') then v_row.therapist_match_scheduling_branch else null end,
      'clinicianSelfSchedulingEnabled', case when v_row.lifecycle_stage='matched' then v_row.clinician_self_scheduling_enabled else null end,
      'therapistMatchExpired', v_row.lifecycle_stage='matching' and v_row.therapist_match_expires_at is not null and v_row.therapist_match_expires_at < p_cutoff_at,
      'lastContactDirection', v_row.last_contact_direction,
      'lastContactChannel', v_row.last_contact_channel,
      'hasUpcomingAppointment', v_row.upcoming_appointments > 0,
      'hasRecentCancellationOrNoShow', v_row.recent_cancellations > 0,
      'hasRepeatedRecentCancellationOrNoShow', v_row.recent_cancellations >= 2,
      'hasOpenSupportRequest', v_row.open_support_requests > 0,
      'closureReason', v_row.closure_reason,
      'stageTimingSignals', to_jsonb(v_stage_timing_signals),
      'derivedSignals', to_jsonb(v_signals),
      'activeExceptions', v_material_exceptions,
      'activeAiFindings', v_material_ai_findings
    );
    v_eval_hash := md5(v_material_state::text);

    v_prior_eval_hash := null;
    select s.evaluation_hash
      into v_prior_eval_hash
    from private.ai_ops_snapshots s
    where s.tenant_id = p_tenant_id
      and s.entity_type = 'client'
      and s.entity_id = v_row.id::text
      and s.snapshot_type like 'client_journey:%'
      and s.payload->>'materialStateVersion' = v_material_state_version
      and s.snapshot_type <> 'client_journey:' || p_run_id::text
    order by s.cutoff_at desc, s.created_at desc
    limit 1;

    v_material_changed := v_prior_eval_hash is not null and v_prior_eval_hash <> v_eval_hash;
    v_has_active_issue := cardinality(v_signals) > 0
      or v_active_exception_count > 0
      or v_active_ai_finding_count > 0;

    if v_active_exception_count > 0 then
      v_review_reasons := array_append(v_review_reasons, 'active_source_exception');
    end if;
    if cardinality(v_signals) > 0 then
      v_review_reasons := array_append(v_review_reasons, 'deterministic_operational_signal');
    end if;
    if v_active_ai_finding_count > 0 then
      v_review_reasons := array_append(v_review_reasons, 'active_ai_finding_reassessment');
    end if;
    if v_material_changed then
      v_review_reasons := array_append(v_review_reasons, 'material_state_changed');
    end if;

    v_is_candidate := v_has_active_issue or v_material_changed;

    v_payload := jsonb_build_object(
      'entityKey', v_entity_key,
      'materialStateVersion', v_material_state_version,
      'materialStateChanged', v_material_changed,
      'hasPriorMaterialBaseline', v_prior_eval_hash is not null,
      'hasActiveOperationalIssue', v_has_active_issue,
      'modelReviewReasons', to_jsonb(v_review_reasons),
      'modelExecutionEnabled', v_model_enabled,
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
      'clinicianSelfSchedulingEnabled', case when v_row.lifecycle_stage='matched' then v_row.clinician_self_scheduling_enabled else null end,
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
      'activeOperationalExceptions', v_active_exception_count,
      'activeExceptions', v_active_exceptions,
      'activeAiFindings', v_active_ai_findings,
      'openSupportRequests', v_row.open_support_requests,
      'closedInLastDay', v_row.closed_at is not null,
      'closureReason', v_row.closure_reason,
      'derivedSignals', to_jsonb(v_signals)
    );

    insert into private.ai_ops_snapshots (
      tenant_id, entity_type, entity_id, snapshot_type, snapshot_hash, evaluation_hash,
      cutoff_at, payload, expires_at
    ) values (
      p_tenant_id, 'client', v_row.id::text, 'client_journey:' || p_run_id::text,
      v_entity_key, v_eval_hash, p_cutoff_at, v_payload, now() + interval '14 days'
    );

    if not v_is_candidate then
      v_deterministic_no_model := v_deterministic_no_model + 1;
      continue;
    end if;

    v_model_review_candidates := v_model_review_candidates + 1;
    if not v_model_enabled then
      v_suppressed_candidates := v_suppressed_candidates + 1;
      continue;
    end if;

    v_queued_candidates := v_queued_candidates + 1;
    v_entities := v_entities || v_payload;

    if jsonb_array_length(v_entities) >= v_batch_size then
      v_batch_index := v_batch_index + 1;
      perform public.ai_ops_enqueue_work(
        p_tenant_id, p_run_id, 'client_journey',
        'client_journey:' || p_run_id::text || ':' || v_batch_index::text,
        'client_journey_review', jsonb_build_object('entities', v_entities),
        v_prompt_version, '1', 100, null, '{}'::uuid[]
      );
      v_batches := v_batches + 1;
      v_entities := '[]'::jsonb;
    end if;
  end loop;

  if v_model_enabled and jsonb_array_length(v_entities) > 0 then
    v_batch_index := v_batch_index + 1;
    perform public.ai_ops_enqueue_work(
      p_tenant_id, p_run_id, 'client_journey',
      'client_journey:' || p_run_id::text || ':' || v_batch_index::text,
      'client_journey_review', jsonb_build_object('entities', v_entities),
      v_prompt_version, '1', 100, null, '{}'::uuid[]
    );
    v_batches := v_batches + 1;
  end if;

  if v_total <> v_deterministic_no_model + v_model_review_candidates then
    raise exception 'Client Journey deterministic census accounting mismatch.';
  end if;
  if v_model_enabled and v_model_review_candidates <> v_queued_candidates then
    raise exception 'Client Journey candidate queue accounting mismatch.';
  end if;
  if not v_model_enabled and v_queued_candidates <> 0 then
    raise exception 'Client Journey model work was queued while model execution was disabled.';
  end if;

  return jsonb_build_object(
    'sourceItemsTotal', v_total,
    'itemsReused', 0,
    'itemsAnalyzed', 0,
    'itemsFailed', 0,
    'clientsChecked', v_total,
    'clientsAccounted', v_total,
    'deterministicNoModel', v_deterministic_no_model,
    'reusedWithoutModel', 0,
    'noModelThisRun', v_deterministic_no_model + v_suppressed_candidates,
    'modelExecutionEnabled', v_model_enabled,
    'modelReviewCandidates', v_model_review_candidates,
    'geminiCandidates', v_queued_candidates,
    'geminiQueued', v_queued_candidates,
    'geminiSuppressed', v_suppressed_candidates,
    'geminiBatches', v_batches,
    'geminiReviewed', 0,
    'geminiFailed', 0,
    'geminiPending', v_queued_candidates,
    'activeExceptions', v_active_exceptions_total,
    'activeExceptionClients', v_active_exception_clients,
    'newExceptionsToday', v_new_exceptions_today,
    'overdueExceptions', v_overdue_exceptions,
    'aiEscalatedExceptions', 0,
    'materialStateVersion', v_material_state_version,
    'promptVersion', v_prompt_version,
    'cutoffAt', p_cutoff_at
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.ai_ops_finalize_module_status(p_tenant_id uuid, p_run_id uuid, p_module ai_ops_module_enum)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_total integer;
  v_completed integer;
  v_failed integer;
  v_pending integer;
  v_status public.ai_ops_run_status_enum;
  v_expected_entities integer := 0;
  v_completed_entities integer := 0;
  v_failed_entities integer := 0;
  v_pending_entities integer := 0;
  v_coverage jsonb := '{}'::jsonb;
  v_clients_checked integer := 0;
  v_deterministic_no_model integer := 0;
  v_model_review_candidates integer := 0;
  v_model_enabled boolean := false;
  v_suppressed integer := 0;
  v_percent numeric := 100;
  v_queue_mismatch boolean := false;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  select count(*),
         count(*) filter (where status = 'completed'),
         count(*) filter (where status = 'failed'),
         count(*) filter (where status in ('queued','processing','retry_wait'))
    into v_total, v_completed, v_failed, v_pending
  from private.ai_ops_work_items
  where tenant_id = p_tenant_id and run_id = p_run_id and module = p_module;

  if p_module = 'client_journey' then
    select coalesce(m.coverage,'{}'::jsonb) into v_coverage
    from public.ai_operations_module_runs m
    where m.run_id=p_run_id and m.tenant_id=p_tenant_id and m.module='client_journey'
    limit 1;

    v_clients_checked := coalesce((v_coverage->>'clientsChecked')::int,0);
    v_deterministic_no_model := coalesce((v_coverage->>'deterministicNoModel')::int,0);
    v_model_review_candidates := coalesce((v_coverage->>'modelReviewCandidates')::int,0);
    v_model_enabled := coalesce((v_coverage->>'modelExecutionEnabled')::boolean,false);

    select
      coalesce(sum(jsonb_array_length(coalesce(w.input_payload->'entities','[]'::jsonb))),0)::int,
      coalesce(sum(case when w.status='completed' then jsonb_array_length(coalesce(w.structured_result->'results','[]'::jsonb)) else 0 end),0)::int,
      coalesce(sum(case when w.status='failed' then jsonb_array_length(coalesce(w.input_payload->'entities','[]'::jsonb)) else 0 end),0)::int,
      coalesce(sum(case when w.status in ('queued','processing','retry_wait') then jsonb_array_length(coalesce(w.input_payload->'entities','[]'::jsonb)) else 0 end),0)::int
    into v_expected_entities, v_completed_entities, v_failed_entities, v_pending_entities
    from private.ai_ops_work_items w
    where w.tenant_id=p_tenant_id and w.run_id=p_run_id and w.module='client_journey';

    v_queue_mismatch := (v_model_enabled and v_expected_entities <> v_model_review_candidates)
      or (not v_model_enabled and v_expected_entities <> 0);

    if v_queue_mismatch then
      v_status := 'failed';
    elsif not v_model_enabled then
      v_status := 'success';
    elsif v_total = 0 then
      v_status := 'success';
    elsif v_pending > 0 then
      v_status := 'running';
    elsif v_completed = v_total then
      v_status := 'success';
    elsif v_completed > 0 then
      v_status := 'partial';
    else
      v_status := 'failed';
    end if;

    v_suppressed := case when v_model_enabled then 0 else v_model_review_candidates end;
    v_percent := case
      when v_model_review_candidates = 0 then 100
      when not v_model_enabled then 0
      else round((100.0 * v_completed_entities / v_model_review_candidates)::numeric,1)
    end;

    v_coverage := v_coverage || jsonb_build_object(
      'clientsAccounted',v_deterministic_no_model + v_model_review_candidates,
      'reusedWithoutModel',0,
      'noModelThisRun',v_deterministic_no_model + v_suppressed,
      'geminiCandidates',v_expected_entities,
      'geminiQueued',v_expected_entities,
      'geminiSuppressed',v_suppressed,
      'geminiReviewed',v_completed_entities,
      'geminiFailed',v_failed_entities,
      'geminiPending',v_pending_entities,
      'geminiWorkItems',v_total,
      'geminiCompletedWorkItems',v_completed,
      'geminiFailedWorkItems',v_failed,
      'modelCoveragePercent',v_percent,
      'modelCoverageComplete',(
        v_model_review_candidates = 0
        or (v_model_enabled and not v_queue_mismatch and v_completed_entities = v_model_review_candidates and v_failed_entities = 0 and v_pending_entities = 0)
      )
    );

    update public.ai_operations_module_runs
       set status=v_status,
           source_items_total=greatest(coalesce(source_items_total,0),v_clients_checked),
           items_reused=0,
           items_analyzed=v_completed_entities,
           items_failed=v_failed_entities,
           coverage=v_coverage,
           completed_at=case when v_status='running' then null else now() end,
           error_code=case
             when v_queue_mismatch then 'candidate_queue_mismatch'
             when v_status='failed' then coalesce(error_code,'work_items_failed')
             when v_status='partial' then coalesce(error_code,'work_items_incomplete')
             else null end,
           updated_at=now()
     where run_id=p_run_id and tenant_id=p_tenant_id and module='client_journey';
  else
    if v_total = 0 then
      v_status := 'success';
    elsif v_pending > 0 then
      v_status := 'running';
    elsif v_completed = v_total then
      v_status := 'success';
    elsif v_completed > 0 then
      v_status := 'partial';
    else
      v_status := 'failed';
    end if;

    update public.ai_operations_module_runs
       set status = v_status,
           items_analyzed = greatest(coalesce(items_analyzed, 0), v_completed),
           items_failed = greatest(coalesce(items_failed, 0), v_failed),
           completed_at = case when v_status = 'running' then null else now() end,
           error_code = case
             when v_status = 'failed' then coalesce(error_code, 'work_items_failed')
             when v_status = 'partial' then coalesce(error_code, 'work_items_incomplete')
             else null end,
           updated_at = now()
     where run_id = p_run_id and module = p_module;
  end if;

  return jsonb_build_object(
    'module',p_module,'status',v_status,'workItems',v_total,
    'completed',v_completed,'failed',v_failed,'pending',v_pending,
    'clientsChecked',case when p_module='client_journey' then v_clients_checked else null end,
    'deterministicNoModel',case when p_module='client_journey' then v_deterministic_no_model else null end,
    'modelReviewCandidates',case when p_module='client_journey' then v_model_review_candidates else null end,
    'modelExecutionEnabled',case when p_module='client_journey' then v_model_enabled else null end,
    'entitiesExpected',case when p_module='client_journey' then v_expected_entities else null end,
    'entitiesReviewed',case when p_module='client_journey' then v_completed_entities else null end,
    'entitiesFailed',case when p_module='client_journey' then v_failed_entities else null end,
    'entitiesPending',case when p_module='client_journey' then v_pending_entities else null end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.ai_ops_build_executive_brief_input(p_tenant_id uuid, p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prompt_version text := '4';
  v_modules jsonb;
  v_counts jsonb;
  v_top jsonb;
  v_new jsonb;
  v_resolved jsonb;
  v_integrity jsonb;
  v_client_journey jsonb;
  v_prior_date date;
  v_prior_critical_high integer := 0;
  v_current_critical_high integer := 0;
  v_business_date date;
  v_payload jsonb;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  select r.business_date into v_business_date
  from public.ai_operations_runs r where r.id = p_run_id;

  select max(r.business_date) into v_prior_date
  from public.ai_operations_runs r
  where r.tenant_id = p_tenant_id and r.business_date < coalesce(v_business_date, current_date);

  select coalesce(jsonb_agg(jsonb_build_object(
    'module', m.module, 'status', m.status, 'coverage', m.coverage,
    'sourceItemsTotal', m.source_items_total, 'itemsAnalyzed', m.items_analyzed,
    'itemsReused', m.items_reused, 'itemsFailed', m.items_failed,
    'errorCode', m.error_code
  ) order by m.module), '[]'::jsonb)
    into v_modules
  from public.ai_operations_module_runs m where m.run_id = p_run_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'module', f.module, 'severity', f.severity, 'count', f.count
  )), '[]'::jsonb) into v_counts
  from (
    select f.module::text as module, f.severity::text as severity, count(*)::int as count
    from public.ai_operations_findings f
    where f.tenant_id = p_tenant_id and f.status = 'open'
    group by f.module, f.severity
  ) f;

  select coalesce(jsonb_agg(t.item order by t.rank_severity, t.is_new desc, t.first_detected_at), '[]'::jsonb)
    into v_top
  from (
    select
      case f.severity::text when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end as rank_severity,
      (v_prior_date is null or f.first_detected_at::date >= coalesce(v_prior_date, current_date)) as is_new,
      f.first_detected_at,
      jsonb_build_object(
        'title', f.title,
        'module', f.module,
        'severity', f.severity,
        'summary', left(coalesce(f.summary, ''), 400),
        'recommendedAction', left(coalesce(f.recommended_action, ''), 300),
        'state', case when v_prior_date is not null and f.first_detected_at::date >= v_prior_date then 'new' else 'ongoing' end,
        'firstDetectedAt', f.first_detected_at,
        'lastSeenAt', f.last_seen_at
      ) as item
    from public.ai_operations_findings f
    where f.tenant_id = p_tenant_id
      and f.status = 'open'
      and f.severity::text in ('critical','high')
    order by case f.severity::text when 'critical' then 1 else 2 end, f.first_detected_at desc
    limit 25
  ) t;

  select count(*)::int into v_current_critical_high
  from public.ai_operations_findings f
  where f.tenant_id = p_tenant_id and f.status = 'open' and f.severity::text in ('critical','high');

  if v_prior_date is not null then
    select count(*)::int into v_prior_critical_high
    from public.ai_operations_findings f
    where f.tenant_id = p_tenant_id
      and f.severity::text in ('critical','high')
      and f.first_detected_at::date <= v_prior_date
      and (f.resolved_at is null or f.resolved_at::date > v_prior_date);

    select coalesce(jsonb_agg(jsonb_build_object('title', f.title, 'module', f.module, 'severity', f.severity)), '[]'::jsonb)
      into v_new
    from public.ai_operations_findings f
    where f.tenant_id = p_tenant_id and f.status = 'open' and f.first_detected_at::date > v_prior_date;

    select coalesce(jsonb_agg(jsonb_build_object('title', f.title, 'module', f.module, 'severity', f.severity)), '[]'::jsonb)
      into v_resolved
    from public.ai_operations_findings f
    where f.tenant_id = p_tenant_id and f.resolved_at is not null and f.resolved_at::date > v_prior_date;
  else
    v_new := '[]'::jsonb;
    v_resolved := '[]'::jsonb;
  end if;

  select coalesce(jsonb_build_object('status', m.status, 'coverage', m.coverage, 'errorCode', m.error_code), '{}'::jsonb)
    into v_integrity
  from public.ai_operations_module_runs m
  where m.run_id = p_run_id and m.module = 'system_integrity';

  select coalesce(jsonb_build_object(
    'status',m.status,
    'clientsChecked',coalesce((m.coverage->>'clientsChecked')::int,m.source_items_total,0),
    'clientsAccounted',coalesce((m.coverage->>'clientsAccounted')::int,m.source_items_total,0),
    'deterministicNoModel',coalesce((m.coverage->>'deterministicNoModel')::int,0),
    'reusedWithoutModel',coalesce((m.coverage->>'reusedWithoutModel')::int,0),
    'noModelThisRun',coalesce((m.coverage->>'noModelThisRun')::int,0),
    'modelExecutionEnabled',coalesce((m.coverage->>'modelExecutionEnabled')::boolean,false),
    'modelReviewCandidates',coalesce((m.coverage->>'modelReviewCandidates')::int,0),
    'geminiCandidates',coalesce((m.coverage->>'geminiCandidates')::int,0),
    'geminiQueued',coalesce((m.coverage->>'geminiQueued')::int,0),
    'geminiSuppressed',coalesce((m.coverage->>'geminiSuppressed')::int,0),
    'geminiBatches',coalesce((m.coverage->>'geminiBatches')::int,0),
    'geminiReviewed',coalesce((m.coverage->>'geminiReviewed')::int,m.items_analyzed,0),
    'geminiFailed',coalesce((m.coverage->>'geminiFailed')::int,m.items_failed,0),
    'geminiPending',coalesce((m.coverage->>'geminiPending')::int,0),
    'activeExceptions',coalesce((m.coverage->>'activeExceptions')::int,0),
    'activeExceptionClients',coalesce((m.coverage->>'activeExceptionClients')::int,0),
    'newExceptionsToday',coalesce((m.coverage->>'newExceptionsToday')::int,0),
    'overdueExceptions',coalesce((m.coverage->>'overdueExceptions')::int,0),
    'aiEscalatedExceptions',coalesce((m.coverage->>'aiEscalatedExceptions')::int,0),
    'modelCoveragePercent',coalesce((m.coverage->>'modelCoveragePercent')::numeric,100),
    'modelCoverageComplete',coalesce((m.coverage->>'modelCoverageComplete')::boolean,false),
    'materialStateVersion',coalesce(m.coverage->>'materialStateVersion','4'),
    'errorCode',m.error_code
  ),jsonb_build_object('status','not_run')) into v_client_journey
  from public.ai_operations_module_runs m
  where m.run_id=p_run_id and m.module='client_journey';

  v_payload := jsonb_build_object(
    'businessDate', v_business_date,
    'priorBusinessDate', v_prior_date,
    'modules', v_modules,
    'openFindings', v_counts,
    'topFindings', coalesce(v_top, '[]'::jsonb),
    'newSincePriorBusinessDay', coalesce(v_new, '[]'::jsonb),
    'resolvedSincePriorBusinessDay', coalesce(v_resolved, '[]'::jsonb),
    'criticalHighCount', v_current_critical_high,
    'priorCriticalHighCount', v_prior_critical_high,
    'criticalHighChange', v_current_critical_high - v_prior_critical_high,
    'systemIntegrity', coalesce(v_integrity, '{}'::jsonb),
    'clientJourney', coalesce(v_client_journey,jsonb_build_object('status','not_run')),
    'verifiedHealthyModules', coalesce((
      select jsonb_agg(m.module order by m.module)
      from public.ai_operations_module_runs m
      where m.run_id = p_run_id
        and m.status = 'success'
        and not exists (
          select 1 from public.ai_operations_findings f
          where f.tenant_id = p_tenant_id and f.status = 'open' and f.module = m.module
        )
    ), '[]'::jsonb),
    'unavailableOrPartialModules', coalesce((
      select jsonb_agg(jsonb_build_object('module', m.module, 'status', m.status, 'errorCode', m.error_code) order by m.module)
      from public.ai_operations_module_runs m
      where m.run_id = p_run_id and m.status <> 'success'
    ), '[]'::jsonb)
  );

  perform public.ai_ops_enqueue_work(
    p_tenant_id, p_run_id, 'executive_brief',
    'executive_brief:' || p_run_id::text,
    'executive_brief_synthesis', v_payload,
    v_prompt_version, '1', 10, null, '{}'::uuid[]
  );

  return v_payload;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ai_ops_ingest_executive_brief(p_tenant_id uuid, p_run_id uuid, p_force_partial boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
  v_business_date date;
  v_degraded integer;
  v_gaps jsonb;
  v_pending integer;
  v_brief_id uuid;
  v_is_partial boolean;
  v_model text;
  v_prompt_version text;
  v_settings_model text;
  v_brief_status text;
  v_publication text;
  v_client_journey jsonb;
  v_client_journey_section jsonb;
  v_sections jsonb;
  v_cj_suffix text := '';
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  select business_date into v_business_date from public.ai_operations_runs where id = p_run_id;
  select s.model into v_settings_model from public.ai_operations_settings s where s.tenant_id = p_tenant_id;

  select w.structured_result,
         coalesce(nullif(w.token_usage->>'model', ''), w.requested_model, v_settings_model),
         coalesce(nullif(w.token_usage->>'promptVersion', ''), w.prompt_version)
    into v_result, v_model, v_prompt_version
  from private.ai_ops_work_items w
  where w.tenant_id = p_tenant_id and w.run_id = p_run_id
    and w.module = 'executive_brief' and w.status = 'completed'
  order by w.completed_at desc limit 1;

  select count(*) into v_pending
  from private.ai_ops_work_items
  where tenant_id = p_tenant_id and run_id = p_run_id
    and module = 'executive_brief' and status in ('queued','processing','retry_wait');

  if v_result is null and not p_force_partial then
    return jsonb_build_object('status', 'pending', 'pendingWorkItems', v_pending);
  end if;

  if v_model is null then
    select coalesce(nullif(w.requested_model, ''), v_settings_model), w.prompt_version
      into v_model, v_prompt_version
    from private.ai_ops_work_items w
    where w.tenant_id = p_tenant_id and w.run_id = p_run_id and w.module = 'executive_brief'
    order by w.created_at desc limit 1;
  end if;

  v_model := coalesce(v_model, v_settings_model);
  v_prompt_version := coalesce(v_prompt_version, '4');

  select count(*) filter (where status in ('failed','partial','running','pending')) into v_degraded
  from public.ai_operations_module_runs
  where run_id = p_run_id and module <> 'executive_brief';

  select coalesce(jsonb_agg(jsonb_build_object('module', module, 'status', status, 'errorCode', error_code)), '[]'::jsonb)
    into v_gaps
  from public.ai_operations_module_runs
  where run_id = p_run_id and module <> 'executive_brief'
    and status in ('failed','partial','running','pending');

  select coalesce(m.coverage,'{}'::jsonb) into v_client_journey
  from public.ai_operations_module_runs m
  where m.run_id=p_run_id and m.module='client_journey'
  limit 1;

  if coalesce((v_client_journey->>'geminiSuppressed')::int,0) > 0 then
    v_cj_suffix := v_cj_suffix || format(' · Gemini paused: %s candidates suppressed', v_client_journey->>'geminiSuppressed');
  end if;
  if coalesce((v_client_journey->>'geminiFailed')::int,0) > 0
     or coalesce((v_client_journey->>'geminiPending')::int,0) > 0 then
    v_cj_suffix := v_cj_suffix || format(
      ' · %s AI failed · %s AI pending',
      coalesce(v_client_journey->>'geminiFailed','0'),
      coalesce(v_client_journey->>'geminiPending','0')
    );
  end if;

  if coalesce(v_client_journey,'{}'::jsonb) ? 'clientsChecked' then
    v_client_journey_section := jsonb_build_object(
      'key','client_journey',
      'heading','Client Journey',
      'body',format(
        '%s clients checked · %s deterministically no model · %s model-review candidates · %s Gemini queued · %s AI reviewed · %s active exceptions · %s new today · %s overdue · %s AI escalated%s',
        coalesce(v_client_journey->>'clientsChecked','0'),
        coalesce(v_client_journey->>'deterministicNoModel','0'),
        coalesce(v_client_journey->>'modelReviewCandidates','0'),
        coalesce(v_client_journey->>'geminiQueued','0'),
        coalesce(v_client_journey->>'geminiReviewed','0'),
        coalesce(v_client_journey->>'activeExceptions','0'),
        coalesce(v_client_journey->>'newExceptionsToday','0'),
        coalesce(v_client_journey->>'overdueExceptions','0'),
        coalesce(v_client_journey->>'aiEscalatedExceptions','0'),
        v_cj_suffix
      ),
      'itemCount',coalesce((v_client_journey->>'activeExceptions')::int,0),
      'metrics',v_client_journey
    );
  else
    v_client_journey_section := null;
  end if;

  select coalesce(jsonb_agg(section), '[]'::jsonb) into v_sections
  from jsonb_array_elements(coalesce(v_result->'sections','[]'::jsonb)) section
  where section->>'key' is distinct from 'client_journey';

  if v_client_journey_section is not null then
    v_sections := jsonb_build_array(v_client_journey_section) || coalesce(v_sections,'[]'::jsonb);
  end if;

  v_is_partial := coalesce(v_degraded, 0) > 0 or v_result is null;
  v_brief_status := case when v_result is null then 'partial' else 'published' end;

  insert into public.ai_operations_briefs (
    run_id, tenant_id, business_date, is_partial, status, sections, coverage_manifest,
    everything_normal, generated_at, model, prompt_version
  ) values (
    p_run_id, p_tenant_id, v_business_date, v_is_partial, v_brief_status,
    coalesce(v_sections, '[]'::jsonb),
    jsonb_build_object(
      'gaps', v_gaps,
      'modelResultAvailable', v_result is not null,
      'clientJourney', coalesce(v_client_journey,'{}'::jsonb)
    ),
    case when v_is_partial then '[]'::jsonb else coalesce(v_result->'everythingNormal', '[]'::jsonb) end,
    now(), v_model, v_prompt_version
  )
  on conflict (tenant_id, business_date) do update
    set run_id = excluded.run_id,
        is_partial = excluded.is_partial,
        status = excluded.status,
        sections = excluded.sections,
        coverage_manifest = excluded.coverage_manifest,
        everything_normal = excluded.everything_normal,
        model = excluded.model,
        prompt_version = excluded.prompt_version,
        generated_at = now(),
        updated_at = now()
  returning id into v_brief_id;

  v_publication := case when v_is_partial then 'published_partial' else 'published' end;
  update public.ai_operations_runs
     set publication_status = v_publication, updated_at = now()
   where id = p_run_id and coalesce(publication_status, '') <> v_publication;

  return jsonb_build_object(
    'status', v_brief_status,
    'briefId', v_brief_id,
    'isPartial', v_is_partial,
    'publicationStatus', v_publication,
    'model', v_model,
    'promptVersion', v_prompt_version,
    'gaps', v_gaps,
    'clientJourney', coalesce(v_client_journey,'{}'::jsonb)
  );
end;
$function$;
