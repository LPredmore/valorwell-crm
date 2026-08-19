-- Client Journey AI finding lifecycle and client-oriented reporting.
-- Stable known exceptions remain authoritative source records; only escalations and genuinely new concerns become AI findings.

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
  v_prompt_version text := '3';
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
  v_active_exceptions jsonb;
  v_active_exception_count integer;
  v_active_exceptions_total integer := 0;
  v_active_exception_clients integer := 0;
  v_overdue_exceptions integer := 0;
  v_new_exceptions_today integer := 0;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

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

    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'exceptionKey', private.ai_ops_client_journey_exception_key(e.id),
            'reasonCode', e.reason_code,
            'category', e.category,
            'exceptionType', e.exception_type,
            'reasonDetail', left(e.reason_detail, 600),
            'nextAction', left(e.next_action, 600),
            'resolutionState', e.resolution_state,
            'ownerAssigned', e.owner_profile_id is not null,
            'reviewDueAt', e.review_due_at,
            'overdue', e.review_due_at < p_cutoff_at,
            'ageDays', greatest(0, floor(extract(epoch from (p_cutoff_at - e.created_at)) / 86400)::int),
            'daysSinceUpdated', greatest(0, floor(extract(epoch from (p_cutoff_at - e.updated_at)) / 86400)::int),
            'source', e.source,
            'relatedEntityType', e.related_entity_type
          )
          order by e.review_due_at, e.created_at, e.id
        ),
        '[]'::jsonb
      ),
      count(*)::int
    into v_active_exceptions, v_active_exception_count
    from public.client_journey_exceptions e
    where e.tenant_id = p_tenant_id
      and e.client_id = v_row.id
      and e.resolution_state in ('open','in_progress');

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
    if v_row.lifecycle_stage in ('matched','scheduled','early_care','established_care') and not v_row.has_clinician then
      v_signals := array_append(v_signals, 'unassignedClinician'::text);
    end if;
    if v_row.engagement_state in ('unresponsive_warm','unresponsive_cold','went_dark') then
      v_signals := array_append(v_signals, 'engagementStateIndicatesUnresponsive'::text);
      if v_row.upcoming_appointments = 0 then
        v_signals := array_append(v_signals, 'noRecentContactAndNoFutureAppointment'::text);
      end if;
    end if;
    if v_row.open_support_requests > 0 then
      v_signals := array_append(v_signals, 'openSupportRequest'::text);
    end if;
    if v_active_exception_count > 0 then
      v_signals := array_append(v_signals, 'hasActiveJourneyException'::text);
    end if;
    if v_row.at_risk and v_row.at_risk_since is not null
       and v_row.appointments_since_at_risk = 0
       and (v_row.last_contact_at is null or v_row.last_contact_at < v_row.at_risk_since) then
      v_signals := array_append(v_signals, 'atRiskWithoutRecentProgress'::text);
    end if;
    if v_row.lifecycle_stage = 'closed' and (v_active_exception_count > 0 or v_row.open_support_requests > 0) then
      v_signals := array_append(v_signals, 'closedWithUnresolvedOperationalItems'::text);
    end if;
    if (v_row.lifecycle_stage in ('registration','intake','matching') and v_row.upcoming_appointments > 0)
       or (v_row.lifecycle_stage = 'closed' and v_row.upcoming_appointments > 0) then
      v_signals := array_append(v_signals, 'lifecycleAppointmentConflict'::text);
    end if;
    if v_row.eligibility_state in ('coverage_issue','manual_review') and v_row.lifecycle_stage <> 'closed' then
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
      'daysAtRisk', case when v_row.at_risk_since is null then null else greatest(0, floor(extract(epoch from (p_cutoff_at - v_row.at_risk_since)) / 86400)::int) end,
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
      'daysUntilNextAppointment', case when v_row.next_appointment_at is null then null else floor(extract(epoch from (v_row.next_appointment_at - p_cutoff_at)) / 86400)::int end,
      'daysSinceLastAppointment', case when v_row.last_appointment_at is null then null else greatest(0, floor(extract(epoch from (p_cutoff_at - v_row.last_appointment_at)) / 86400)::int) end,
      'cancellationsOrNoShowsLast30Days', v_row.recent_cancellations,
      'openOperationalExceptions', v_row.open_exceptions,
      'activeOperationalExceptions', v_active_exception_count,
      'activeExceptions', v_active_exceptions,
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
        'client_journey_review', jsonb_build_object('entities', v_entities),
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
      'client_journey_review', jsonb_build_object('entities', v_entities),
      v_prompt_version, '1', 100, null, '{}'::uuid[]
    );
    v_batches := v_batches + 1;
  end if;

  return jsonb_build_object(
    'sourceItemsTotal', v_total,
    'itemsReused', v_reused,
    'itemsAnalyzed', 0,
    'itemsFailed', 0,
    'clientsChecked', v_total,
    'clientsAccounted', v_total,
    'reusedWithoutModel', v_reused,
    'noModelThisRun', v_reused,
    'deterministicNoModel', 0,
    'geminiCandidates', v_fresh,
    'geminiBatches', v_batches,
    'geminiReviewed', 0,
    'geminiFailed', 0,
    'geminiPending', v_fresh,
    'activeExceptions', v_active_exceptions_total,
    'activeExceptionClients', v_active_exception_clients,
    'newExceptionsToday', v_new_exceptions_today,
    'overdueExceptions', v_overdue_exceptions,
    'aiEscalatedExceptions', 0,
    'promptVersion', v_prompt_version,
    'cutoffAt', p_cutoff_at
  );
end;
$function$;

create or replace function public.ai_ops_ingest_client_journey_results(
  p_tenant_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_item record;
  v_result jsonb;
  v_client uuid;
  v_snapshot_payload jsonb;
  v_expected_exception_keys text[];
  v_related_exception_keys text[];
  v_assessment_keys text[];
  v_assessment_row jsonb;
  v_exception_id uuid;
  v_exception_key text;
  v_assessment text;
  v_rationale text;
  v_disposition text;
  v_fingerprint text;
  v_finding_id uuid;
  v_upsert_result jsonb;
  v_evidence jsonb;
  v_clients_reviewed integer := 0;
  v_unmatched integer := 0;
  v_exception_assessments integer := 0;
  v_stable_existing_clients integer := 0;
  v_escalating_existing_clients integer := 0;
  v_appears_resolved_clients integer := 0;
  v_new_concern_clients integer := 0;
  v_no_concern_clients_count integer := 0;
  v_findings_upserted integer := 0;
  v_stale_resolved integer := 0;
  v_reviewed_clients uuid[] := '{}'::uuid[];
  v_explicit_no_concern_clients uuid[] := '{}'::uuid[];
  v_escalated_exception_ids uuid[] := '{}'::uuid[];
  v_stale record;
  v_source_active boolean;
  v_client_reviewed boolean;
  v_exception_escalated boolean;
  v_event_type text;
  v_reason text;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  for v_item in
    select w.id, w.structured_result
    from private.ai_ops_work_items w
    where w.tenant_id = p_tenant_id and w.run_id = p_run_id
      and w.module = 'client_journey' and w.status = 'completed'
  loop
    for v_result in select value from jsonb_array_elements(coalesce(v_item.structured_result->'results', '[]'::jsonb)) loop
      v_client := null;
      v_snapshot_payload := null;
      select s.entity_id::uuid, s.payload into v_client, v_snapshot_payload
      from private.ai_ops_snapshots s
      where s.tenant_id = p_tenant_id
        and s.snapshot_type = 'client_journey:' || p_run_id::text
        and s.snapshot_hash = v_result->>'entityKey'
      limit 1;

      if v_client is null then
        v_unmatched := v_unmatched + 1;
        continue;
      end if;

      select coalesce(array_agg(x->>'exceptionKey' order by x->>'exceptionKey'), '{}'::text[])
      into v_expected_exception_keys
      from jsonb_array_elements(coalesce(v_snapshot_payload->'activeExceptions', '[]'::jsonb)) x;

      select coalesce(array_agg(value order by value), '{}'::text[])
      into v_related_exception_keys
      from jsonb_array_elements_text(coalesce(v_result->'relatedExceptionKeys', '[]'::jsonb));

      select coalesce(array_agg(x->>'exceptionKey' order by x->>'exceptionKey'), '{}'::text[])
      into v_assessment_keys
      from jsonb_array_elements(coalesce(v_result->'exceptionAssessments', '[]'::jsonb)) x;

      if cardinality(v_related_exception_keys) <> cardinality(array(select distinct unnest(v_related_exception_keys))) then
        raise exception 'Client Journey AI result contains duplicate related exception keys for entity %.', v_result->>'entityKey';
      end if;
      if cardinality(v_assessment_keys) <> cardinality(array(select distinct unnest(v_assessment_keys)))
         or cardinality(v_assessment_keys) <> cardinality(v_expected_exception_keys)
         or exists (select 1 from unnest(v_assessment_keys) k where not (k = any(v_expected_exception_keys)))
         or exists (select 1 from unnest(v_expected_exception_keys) k where not (k = any(v_assessment_keys))) then
        raise exception 'Client Journey AI result exception assessments do not exactly cover supplied active exceptions for entity %.', v_result->>'entityKey';
      end if;
      if exists (select 1 from unnest(v_related_exception_keys) k where not (k = any(v_expected_exception_keys))) then
        raise exception 'Client Journey AI result references an exception key that was not supplied for entity %.', v_result->>'entityKey';
      end if;

      v_disposition := coalesce(v_result->>'concernDisposition','none');
      if v_disposition in ('stable_existing','escalating_existing','appears_resolved_existing') and cardinality(v_related_exception_keys) = 0 then
        raise exception 'Client Journey AI result marked an existing concern without an exact related exception key for entity %.', v_result->>'entityKey';
      end if;
      if v_disposition in ('none','new_concern') and cardinality(v_related_exception_keys) > 0 then
        raise exception 'Client Journey AI result returned related exception keys for a non-existing concern disposition for entity %.', v_result->>'entityKey';
      end if;
      if coalesce((v_result->>'noConcern')::boolean,false) and v_disposition <> 'none' then
        raise exception 'Client Journey AI result combined noConcern=true with concernDisposition=% for entity %.', v_disposition, v_result->>'entityKey';
      end if;
      if v_disposition = 'escalating_existing'
         and not exists (select 1 from jsonb_array_elements(coalesce(v_result->'exceptionAssessments','[]'::jsonb)) a where a->>'assessment' = 'escalating') then
        raise exception 'Client Journey AI result marked escalating_existing without an escalating exception assessment for entity %.', v_result->>'entityKey';
      end if;
      if v_disposition in ('none','stable_existing','appears_resolved_existing')
         and exists (select 1 from jsonb_array_elements(coalesce(v_result->'exceptionAssessments','[]'::jsonb)) a where a->>'assessment' = 'escalating') then
        raise exception 'Client Journey AI result contains an escalating exception assessment inconsistent with concernDisposition=% for entity %.', v_disposition, v_result->>'entityKey';
      end if;

      v_clients_reviewed := v_clients_reviewed + 1;
      if not (v_client = any(v_reviewed_clients)) then
        v_reviewed_clients := array_append(v_reviewed_clients, v_client);
      end if;

      if coalesce((v_result->>'noConcern')::boolean,false) then
        v_no_concern_clients_count := v_no_concern_clients_count + 1;
        if not (v_client = any(v_explicit_no_concern_clients)) then
          v_explicit_no_concern_clients := array_append(v_explicit_no_concern_clients, v_client);
        end if;
      elsif v_disposition = 'stable_existing' then
        v_stable_existing_clients := v_stable_existing_clients + 1;
      elsif v_disposition = 'escalating_existing' then
        v_escalating_existing_clients := v_escalating_existing_clients + 1;
      elsif v_disposition = 'appears_resolved_existing' then
        v_appears_resolved_clients := v_appears_resolved_clients + 1;
      elsif v_disposition = 'new_concern' then
        v_new_concern_clients := v_new_concern_clients + 1;
      end if;

      for v_assessment_row in select value from jsonb_array_elements(coalesce(v_result->'exceptionAssessments','[]'::jsonb)) loop
        v_exception_key := v_assessment_row->>'exceptionKey';
        v_assessment := v_assessment_row->>'assessment';
        v_rationale := left(coalesce(v_assessment_row->>'rationale',''),1000);
        v_exception_id := null;
        select e.id into v_exception_id
        from public.client_journey_exceptions e
        where e.tenant_id = p_tenant_id
          and e.client_id = v_client
          and private.ai_ops_client_journey_exception_key(e.id) = v_exception_key
        limit 1;

        if v_exception_id is null then
          raise exception 'Client Journey AI result exception key could not be mapped to its exact source record for entity %.', v_result->>'entityKey';
        end if;
        v_exception_assessments := v_exception_assessments + 1;

        if v_assessment = 'escalating' then
          if not (v_exception_id = any(v_escalated_exception_ids)) then
            v_escalated_exception_ids := array_append(v_escalated_exception_ids, v_exception_id);
          end if;
          v_fingerprint := 'client_journey:exception_escalation:' || v_exception_id::text;
          v_evidence := jsonb_build_array(jsonb_build_object(
            'sourceType','client_journey_exception','exceptionKey',v_exception_key,
            'assessment','escalating','rationale',v_rationale
          ));
          v_upsert_result := public.ai_ops_upsert_finding(
            p_tenant_id, p_run_id, 'client_journey', v_fingerprint,
            left(coalesce(v_result->>'title','Client journey exception escalated'),300),
            coalesce(nullif(v_result->>'severity',''),'medium')::public.ai_ops_severity_enum,
            left(coalesce(v_result->>'summary',''),2000),
            left(coalesce(v_result->>'recommendedAction',''),1000),
            'client', v_client::text, nullif(v_result->>'confidence','')::numeric,
            v_exception_id, v_evidence
          );
          v_finding_id := nullif(v_upsert_result->>'findingId','')::uuid;
          if v_finding_id is null then raise exception 'Client Journey AI exception escalation upsert did not return a finding id.'; end if;
          update public.ai_operations_findings set related_existing_exception_id=v_exception_id, updated_at=now()
          where id=v_finding_id and tenant_id=p_tenant_id;
          delete from private.ai_ops_client_journey_finding_exception_links where finding_id=v_finding_id and exception_id<>v_exception_id;
          insert into private.ai_ops_client_journey_finding_exception_links(
            finding_id,tenant_id,client_id,exception_id,exception_key,assessment,rationale,first_seen_run_id,last_seen_run_id,last_seen_at
          ) values (
            v_finding_id,p_tenant_id,v_client,v_exception_id,v_exception_key,'escalating',v_rationale,p_run_id,p_run_id,now()
          ) on conflict (finding_id,exception_id) do update
            set exception_key=excluded.exception_key,assessment=excluded.assessment,rationale=excluded.rationale,last_seen_run_id=excluded.last_seen_run_id,last_seen_at=now();
          v_findings_upserted := v_findings_upserted + 1;
        end if;
      end loop;

      if not coalesce((v_result->>'noConcern')::boolean,false) and v_disposition='new_concern' then
        v_fingerprint := 'client_journey:new:' || v_client::text || ':' || coalesce(nullif(v_result->>'concernType',''),'unspecified');
        v_upsert_result := public.ai_ops_upsert_finding(
          p_tenant_id,p_run_id,'client_journey',v_fingerprint,
          left(coalesce(v_result->>'title','Client journey concern'),300),
          coalesce(nullif(v_result->>'severity',''),'medium')::public.ai_ops_severity_enum,
          left(coalesce(v_result->>'summary',''),2000),
          left(coalesce(v_result->>'recommendedAction',''),1000),
          'client',v_client::text,nullif(v_result->>'confidence','')::numeric,null,
          jsonb_build_array(jsonb_build_object(
            'sourceType','client_journey_ai_review','concernType',coalesce(v_result->>'concernType','unspecified'),
            'supportingSignals',coalesce(v_result->'supportingSignals','[]'::jsonb)
          ))
        );
        v_finding_id := nullif(v_upsert_result->>'findingId','')::uuid;
        if v_finding_id is null then raise exception 'Client Journey AI new concern upsert did not return a finding id.'; end if;
        update public.ai_operations_findings set related_existing_exception_id=null,updated_at=now()
        where id=v_finding_id and tenant_id=p_tenant_id;
        delete from private.ai_ops_client_journey_finding_exception_links where finding_id=v_finding_id;
        v_findings_upserted := v_findings_upserted + 1;
      end if;
    end loop;
  end loop;

  for v_stale in
    select f.id,f.status,f.fingerprint,f.entity_id,f.related_existing_exception_id
    from public.ai_operations_findings f
    where f.tenant_id=p_tenant_id and f.module='client_journey'
      and f.status in ('open','snoozed') and f.fingerprint like 'client_journey:exception_escalation:%'
  loop
    select exists(select 1 from public.client_journey_exceptions e
      where e.id=v_stale.related_existing_exception_id and e.tenant_id=p_tenant_id and e.resolution_state in ('open','in_progress'))
      into v_source_active;
    select exists(select 1 from unnest(v_reviewed_clients) c where c::text=v_stale.entity_id) into v_client_reviewed;
    v_exception_escalated := v_stale.related_existing_exception_id is not null and v_stale.related_existing_exception_id=any(v_escalated_exception_ids);

    if not v_source_active then
      v_event_type := 'deterministically_resolved';
      v_reason := 'The exact source Client Journey exception is no longer active.';
    elsif v_client_reviewed and not v_exception_escalated then
      v_event_type := 'reassessment_resolved';
      v_reason := 'A complete current Client Journey review explicitly assessed the exact active exception as no longer escalating.';
    else
      continue;
    end if;

    update public.ai_operations_findings
    set status='resolved',resolved_at=now(),snoozed_until=null,last_run_id=p_run_id,updated_at=now()
    where id=v_stale.id;
    insert into public.ai_operations_finding_events(finding_id,tenant_id,event_type,actor_kind,previous_value,new_value,reason)
    values(v_stale.id,p_tenant_id,v_event_type,'system',jsonb_build_object('status',v_stale.status),jsonb_build_object('status','resolved','runId',p_run_id),v_reason);
    v_stale_resolved := v_stale_resolved + 1;
  end loop;

  for v_stale in
    select f.id,f.status,f.fingerprint,f.entity_id
    from public.ai_operations_findings f
    where f.tenant_id=p_tenant_id and f.module='client_journey'
      and f.status in ('open','snoozed') and f.fingerprint like 'client_journey:new:%'
  loop
    if exists(select 1 from unnest(v_explicit_no_concern_clients) c where c::text=v_stale.entity_id) then
      update public.ai_operations_findings
      set status='resolved',resolved_at=now(),snoozed_until=null,last_run_id=p_run_id,updated_at=now()
      where id=v_stale.id;
      insert into public.ai_operations_finding_events(finding_id,tenant_id,event_type,actor_kind,previous_value,new_value,reason)
      values(v_stale.id,p_tenant_id,'reassessment_resolved','system',jsonb_build_object('status',v_stale.status),jsonb_build_object('status','resolved','runId',p_run_id),'A complete current Client Journey review explicitly returned no concern for this client.');
      v_stale_resolved := v_stale_resolved + 1;
    end if;
  end loop;

  update public.ai_operations_module_runs m
  set coverage=coalesce(m.coverage,'{}'::jsonb)||jsonb_build_object(
    'geminiReviewed',v_clients_reviewed,
    'exceptionAssessments',v_exception_assessments,
    'aiEscalatedExceptions',cardinality(v_escalated_exception_ids),
    'stableExistingClients',v_stable_existing_clients,
    'escalatingExistingClients',v_escalating_existing_clients,
    'appearsResolvedExistingClients',v_appears_resolved_clients,
    'newAiConcernClients',v_new_concern_clients,
    'explicitNoConcernClients',v_no_concern_clients_count,
    'clientJourneyFindingsUpserted',v_findings_upserted,
    'staleClientJourneyFindingsResolved',v_stale_resolved
  ),updated_at=now()
  where m.run_id=p_run_id and m.tenant_id=p_tenant_id and m.module='client_journey';

  return jsonb_build_object(
    'clientsReviewed',v_clients_reviewed,
    'exceptionAssessments',v_exception_assessments,
    'aiEscalatedExceptions',cardinality(v_escalated_exception_ids),
    'stableExistingClients',v_stable_existing_clients,
    'escalatingExistingClients',v_escalating_existing_clients,
    'appearsResolvedExistingClients',v_appears_resolved_clients,
    'newAiConcernClients',v_new_concern_clients,
    'explicitNoConcernClients',v_no_concern_clients_count,
    'findingsUpserted',v_findings_upserted,
    'staleFindingsResolved',v_stale_resolved,
    'unmatchedResults',v_unmatched
  );
end;
$function$;

create or replace function public.ai_ops_finalize_module_status(
  p_tenant_id uuid,
  p_run_id uuid,
  p_module public.ai_ops_module_enum
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
  v_reused integer := 0;
  v_percent numeric := 100;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  select count(*),
         count(*) filter (where status='completed'),
         count(*) filter (where status='failed'),
         count(*) filter (where status in ('queued','processing','retry_wait'))
  into v_total,v_completed,v_failed,v_pending
  from private.ai_ops_work_items
  where tenant_id=p_tenant_id and run_id=p_run_id and module=p_module;

  if v_total=0 then v_status:='success';
  elsif v_pending>0 then v_status:='running';
  elsif v_completed=v_total then v_status:='success';
  elsif v_completed>0 then v_status:='partial';
  else v_status:='failed';
  end if;

  if p_module='client_journey' then
    select
      coalesce(sum(jsonb_array_length(coalesce(w.input_payload->'entities','[]'::jsonb))),0)::int,
      coalesce(sum(case when w.status='completed' then jsonb_array_length(coalesce(w.structured_result->'results','[]'::jsonb)) else 0 end),0)::int,
      coalesce(sum(case when w.status='failed' then jsonb_array_length(coalesce(w.input_payload->'entities','[]'::jsonb)) else 0 end),0)::int,
      coalesce(sum(case when w.status in ('queued','processing','retry_wait') then jsonb_array_length(coalesce(w.input_payload->'entities','[]'::jsonb)) else 0 end),0)::int
    into v_expected_entities,v_completed_entities,v_failed_entities,v_pending_entities
    from private.ai_ops_work_items w
    where w.tenant_id=p_tenant_id and w.run_id=p_run_id and w.module='client_journey';

    select coalesce(m.coverage,'{}'::jsonb) into v_coverage
    from public.ai_operations_module_runs m
    where m.run_id=p_run_id and m.tenant_id=p_tenant_id and m.module='client_journey'
    limit 1;

    v_clients_checked:=coalesce((v_coverage->>'clientsChecked')::int,0);
    v_reused:=coalesce((v_coverage->>'reusedWithoutModel')::int,0);
    v_percent:=case when v_expected_entities=0 then 100 else round((100.0*v_completed_entities/v_expected_entities)::numeric,1) end;
    v_coverage:=v_coverage||jsonb_build_object(
      'geminiCandidates',v_expected_entities,
      'geminiReviewed',v_completed_entities,
      'geminiFailed',v_failed_entities,
      'geminiPending',v_pending_entities,
      'geminiWorkItems',v_total,
      'geminiCompletedWorkItems',v_completed,
      'geminiFailedWorkItems',v_failed,
      'modelCoveragePercent',v_percent,
      'modelCoverageComplete',(v_status='success' and v_completed_entities=v_expected_entities)
    );

    update public.ai_operations_module_runs
    set status=v_status,
        source_items_total=greatest(coalesce(source_items_total,0),v_clients_checked),
        items_reused=greatest(coalesce(items_reused,0),v_reused),
        items_analyzed=v_completed_entities,
        items_failed=v_failed_entities,
        coverage=v_coverage,
        completed_at=case when v_status='running' then null else now() end,
        error_code=case when v_status='failed' then coalesce(error_code,'work_items_failed') when v_status='partial' then coalesce(error_code,'work_items_incomplete') else null end,
        updated_at=now()
    where run_id=p_run_id and tenant_id=p_tenant_id and module='client_journey';
  else
    update public.ai_operations_module_runs
    set status=v_status,
        items_analyzed=greatest(coalesce(items_analyzed,0),v_completed),
        items_failed=greatest(coalesce(items_failed,0),v_failed),
        completed_at=case when v_status='running' then null else now() end,
        error_code=case when v_status='failed' then coalesce(error_code,'work_items_failed') when v_status='partial' then coalesce(error_code,'work_items_incomplete') else null end,
        updated_at=now()
    where run_id=p_run_id and module=p_module;
  end if;

  return jsonb_build_object(
    'module',p_module,'status',v_status,'workItems',v_total,
    'completed',v_completed,'failed',v_failed,'pending',v_pending,
    'entitiesExpected',case when p_module='client_journey' then v_expected_entities else null end,
    'entitiesReviewed',case when p_module='client_journey' then v_completed_entities else null end,
    'entitiesFailed',case when p_module='client_journey' then v_failed_entities else null end,
    'entitiesPending',case when p_module='client_journey' then v_pending_entities else null end
  );
end;
$function$;

create or replace function public.ai_ops_build_executive_brief_input(
  p_tenant_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_prompt_version text := '3';
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

  select r.business_date into v_business_date from public.ai_operations_runs r where r.id=p_run_id;
  select max(r.business_date) into v_prior_date
  from public.ai_operations_runs r
  where r.tenant_id=p_tenant_id and r.business_date<coalesce(v_business_date,current_date);

  select coalesce(jsonb_agg(jsonb_build_object(
    'module',m.module,'status',m.status,'coverage',m.coverage,
    'sourceItemsTotal',m.source_items_total,'itemsAnalyzed',m.items_analyzed,
    'itemsReused',m.items_reused,'itemsFailed',m.items_failed,'errorCode',m.error_code
  ) order by m.module),'[]'::jsonb) into v_modules
  from public.ai_operations_module_runs m where m.run_id=p_run_id;

  select coalesce(jsonb_agg(jsonb_build_object('module',f.module,'severity',f.severity,'count',f.count)),'[]'::jsonb)
  into v_counts
  from (
    select f.module::text as module,f.severity::text as severity,count(*)::int as count
    from public.ai_operations_findings f
    where f.tenant_id=p_tenant_id and f.status='open'
    group by f.module,f.severity
  ) f;

  select coalesce(jsonb_agg(t.item order by t.rank_severity,t.is_new desc,t.first_detected_at),'[]'::jsonb)
  into v_top
  from (
    select case f.severity::text when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end as rank_severity,
           (v_prior_date is null or f.first_detected_at::date>=coalesce(v_prior_date,current_date)) as is_new,
           f.first_detected_at,
           jsonb_build_object(
             'title',f.title,'module',f.module,'severity',f.severity,
             'summary',left(coalesce(f.summary,''),400),
             'recommendedAction',left(coalesce(f.recommended_action,''),300),
             'state',case when v_prior_date is not null and f.first_detected_at::date>=v_prior_date then 'new' else 'ongoing' end,
             'firstDetectedAt',f.first_detected_at,'lastSeenAt',f.last_seen_at
           ) as item
    from public.ai_operations_findings f
    where f.tenant_id=p_tenant_id and f.status='open' and f.severity::text in ('critical','high')
    order by case f.severity::text when 'critical' then 1 else 2 end,f.first_detected_at desc
    limit 25
  ) t;

  select count(*)::int into v_current_critical_high
  from public.ai_operations_findings f
  where f.tenant_id=p_tenant_id and f.status='open' and f.severity::text in ('critical','high');

  if v_prior_date is not null then
    select count(*)::int into v_prior_critical_high
    from public.ai_operations_findings f
    where f.tenant_id=p_tenant_id and f.severity::text in ('critical','high')
      and f.first_detected_at::date<=v_prior_date
      and (f.resolved_at is null or f.resolved_at::date>v_prior_date);
    select coalesce(jsonb_agg(jsonb_build_object('title',f.title,'module',f.module,'severity',f.severity)),'[]'::jsonb)
    into v_new from public.ai_operations_findings f
    where f.tenant_id=p_tenant_id and f.status='open' and f.first_detected_at::date>v_prior_date;
    select coalesce(jsonb_agg(jsonb_build_object('title',f.title,'module',f.module,'severity',f.severity)),'[]'::jsonb)
    into v_resolved from public.ai_operations_findings f
    where f.tenant_id=p_tenant_id and f.resolved_at is not null and f.resolved_at::date>v_prior_date;
  else
    v_new:='[]'::jsonb;
    v_resolved:='[]'::jsonb;
  end if;

  select coalesce(jsonb_build_object('status',m.status,'coverage',m.coverage,'errorCode',m.error_code),'{}'::jsonb)
  into v_integrity
  from public.ai_operations_module_runs m where m.run_id=p_run_id and m.module='system_integrity';

  select coalesce(jsonb_build_object(
    'status',m.status,
    'clientsChecked',coalesce((m.coverage->>'clientsChecked')::int,m.source_items_total,0),
    'deterministicNoModel',coalesce((m.coverage->>'deterministicNoModel')::int,0),
    'reusedWithoutModel',coalesce((m.coverage->>'reusedWithoutModel')::int,m.items_reused,0),
    'noModelThisRun',coalesce((m.coverage->>'noModelThisRun')::int,m.items_reused,0),
    'geminiCandidates',coalesce((m.coverage->>'geminiCandidates')::int,0),
    'geminiBatches',coalesce((m.coverage->>'geminiBatches')::int,0),
    'geminiReviewed',coalesce((m.coverage->>'geminiReviewed')::int,m.items_analyzed,0),
    'geminiFailed',coalesce((m.coverage->>'geminiFailed')::int,m.items_failed,0),
    'geminiPending',coalesce((m.coverage->>'geminiPending')::int,0),
    'activeExceptions',coalesce((m.coverage->>'activeExceptions')::int,0),
    'activeExceptionClients',coalesce((m.coverage->>'activeExceptionClients')::int,0),
    'newExceptionsToday',coalesce((m.coverage->>'newExceptionsToday')::int,0),
    'overdueExceptions',coalesce((m.coverage->>'overdueExceptions')::int,0),
    'aiEscalatedExceptions',coalesce((m.coverage->>'aiEscalatedExceptions')::int,0),
    'modelCoveragePercent',coalesce((m.coverage->>'modelCoveragePercent')::numeric,case when coalesce((m.coverage->>'geminiCandidates')::int,0)=0 then 100 else 0 end),
    'modelCoverageComplete',coalesce((m.coverage->>'modelCoverageComplete')::boolean,false),
    'errorCode',m.error_code
  ),jsonb_build_object('status','not_run')) into v_client_journey
  from public.ai_operations_module_runs m
  where m.run_id=p_run_id and m.module='client_journey';

  v_payload:=jsonb_build_object(
    'businessDate',v_business_date,
    'priorBusinessDate',v_prior_date,
    'modules',v_modules,
    'openFindings',v_counts,
    'topFindings',coalesce(v_top,'[]'::jsonb),
    'newSincePriorBusinessDay',coalesce(v_new,'[]'::jsonb),
    'resolvedSincePriorBusinessDay',coalesce(v_resolved,'[]'::jsonb),
    'criticalHighCount',v_current_critical_high,
    'priorCriticalHighCount',v_prior_critical_high,
    'criticalHighChange',v_current_critical_high-v_prior_critical_high,
    'systemIntegrity',coalesce(v_integrity,'{}'::jsonb),
    'clientJourney',coalesce(v_client_journey,jsonb_build_object('status','not_run')),
    'verifiedHealthyModules',coalesce((
      select jsonb_agg(m.module order by m.module)
      from public.ai_operations_module_runs m
      where m.run_id=p_run_id and m.status='success'
        and not exists(select 1 from public.ai_operations_findings f where f.tenant_id=p_tenant_id and f.status='open' and f.module=m.module)
    ),'[]'::jsonb),
    'unavailableOrPartialModules',coalesce((
      select jsonb_agg(jsonb_build_object('module',m.module,'status',m.status,'errorCode',m.error_code) order by m.module)
      from public.ai_operations_module_runs m
      where m.run_id=p_run_id and m.status<>'success'
    ),'[]'::jsonb)
  );

  perform public.ai_ops_enqueue_work(
    p_tenant_id,p_run_id,'executive_brief','executive_brief:'||p_run_id::text,
    'executive_brief_synthesis',v_payload,v_prompt_version,'1',10,null,'{}'::uuid[]
  );
  return v_payload;
end;
$function$;
