create or replace function private.ai_ops_client_journey_exception_key(p_exception_id uuid)
returns text
language sql
immutable
strict
set search_path to ''
as $function$
  select 'x' || left(md5(p_exception_id::text || ':client_journey_exception:v1'), 16);
$function$;

revoke all on function private.ai_ops_client_journey_exception_key(uuid) from public;
revoke all on function private.ai_ops_client_journey_exception_key(uuid) from anon;
revoke all on function private.ai_ops_client_journey_exception_key(uuid) from authenticated;
grant execute on function private.ai_ops_client_journey_exception_key(uuid) to service_role;

create table if not exists private.ai_ops_client_journey_finding_exception_links (
  finding_id uuid not null references public.ai_operations_findings(id) on delete cascade,
  tenant_id uuid not null,
  client_id uuid not null,
  exception_id uuid not null references public.client_journey_exceptions(id) on delete restrict,
  exception_key text not null,
  assessment text null check (assessment is null or assessment in ('stable','escalating','appears_resolved')),
  rationale text null,
  first_seen_run_id uuid null,
  last_seen_run_id uuid null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (finding_id, exception_id),
  unique (finding_id, exception_key)
);

create index if not exists ai_ops_cj_finding_exception_links_tenant_client_idx
  on private.ai_ops_client_journey_finding_exception_links (tenant_id, client_id);
create index if not exists ai_ops_cj_finding_exception_links_exception_idx
  on private.ai_ops_client_journey_finding_exception_links (exception_id);

alter table private.ai_ops_client_journey_finding_exception_links enable row level security;
revoke all on private.ai_ops_client_journey_finding_exception_links from public;
revoke all on private.ai_ops_client_journey_finding_exception_links from anon;
revoke all on private.ai_ops_client_journey_finding_exception_links from authenticated;
grant select, insert, update, delete on private.ai_ops_client_journey_finding_exception_links to service_role;

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

    if v_row.lifecycle_stage in ('matched','scheduled','early_care','established_care')
       and not v_row.has_clinician then
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

    if v_row.lifecycle_stage = 'closed'
       and (v_active_exception_count > 0 or v_row.open_support_requests > 0) then
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
  v_observed text[] := '{}'::text[];
  v_findings integer := 0;
  v_skipped integer := 0;
  v_fingerprint text;
  v_primary_exception_id uuid;
  v_related_exception_ids uuid[];
  v_related_exception_keys text[];
  v_expected_exception_keys text[];
  v_assessment_keys text[];
  v_key text;
  v_exception_id uuid;
  v_finding_id uuid;
  v_upsert_result jsonb;
  v_assessment text;
  v_rationale text;
  v_evidence jsonb;
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
      select s.entity_id::uuid, s.payload
        into v_client, v_snapshot_payload
      from private.ai_ops_snapshots s
      where s.tenant_id = p_tenant_id
        and s.snapshot_type = 'client_journey:' || p_run_id::text
        and s.snapshot_hash = v_result->>'entityKey'
      limit 1;

      if v_client is null then
        v_skipped := v_skipped + 1;
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
         or exists (
           select 1 from unnest(v_assessment_keys) k
           where not (k = any(v_expected_exception_keys))
         )
         or exists (
           select 1 from unnest(v_expected_exception_keys) k
           where not (k = any(v_assessment_keys))
         ) then
        raise exception 'Client Journey AI result exception assessments do not exactly cover supplied active exceptions for entity %.', v_result->>'entityKey';
      end if;

      if exists (
        select 1 from unnest(v_related_exception_keys) k
        where not (k = any(v_expected_exception_keys))
      ) then
        raise exception 'Client Journey AI result references an exception key that was not supplied for entity %.', v_result->>'entityKey';
      end if;

      if coalesce(v_result->>'concernDisposition','none') in ('stable_existing','escalating_existing','appears_resolved_existing')
         and cardinality(v_related_exception_keys) = 0 then
        raise exception 'Client Journey AI result marked an existing concern without an exact related exception key for entity %.', v_result->>'entityKey';
      end if;

      if coalesce(v_result->>'concernDisposition','none') in ('none','new_concern')
         and cardinality(v_related_exception_keys) > 0 then
        raise exception 'Client Journey AI result returned related exception keys for a non-existing concern disposition for entity %.', v_result->>'entityKey';
      end if;

      v_related_exception_ids := '{}'::uuid[];
      v_evidence := '[]'::jsonb;
      foreach v_key in array v_related_exception_keys loop
        v_exception_id := null;
        select e.id into v_exception_id
        from public.client_journey_exceptions e
        where e.tenant_id = p_tenant_id
          and e.client_id = v_client
          and private.ai_ops_client_journey_exception_key(e.id) = v_key
        limit 1;

        if v_exception_id is null then
          raise exception 'Client Journey AI result exception key could not be mapped to its exact source record for entity %.', v_result->>'entityKey';
        end if;

        v_related_exception_ids := array_append(v_related_exception_ids, v_exception_id);
        v_evidence := v_evidence || jsonb_build_array(jsonb_build_object(
          'sourceType', 'client_journey_exception',
          'exceptionKey', v_key
        ));
      end loop;

      if coalesce((v_result->>'noConcern')::boolean, false)
         or coalesce(v_result->>'severity', 'low') = 'low' then
        continue;
      end if;

      v_fingerprint := 'client_journey:' || v_client::text || ':' || coalesce(v_result->>'concernType', 'unspecified');
      v_observed := v_observed || v_fingerprint;
      v_primary_exception_id := case when cardinality(v_related_exception_ids) > 0 then v_related_exception_ids[1] else null end;

      v_upsert_result := public.ai_ops_upsert_finding(
        p_tenant_id, p_run_id, 'client_journey', v_fingerprint,
        left(coalesce(v_result->>'title', 'Client journey concern'), 300),
        coalesce(nullif(v_result->>'severity',''), 'medium')::public.ai_ops_severity_enum,
        left(coalesce(v_result->>'summary', ''), 2000),
        left(coalesce(v_result->>'recommendedAction', ''), 1000),
        'client', v_client::text,
        nullif(v_result->>'confidence','')::numeric,
        v_primary_exception_id,
        v_evidence
      );
      v_finding_id := nullif(v_upsert_result->>'findingId','')::uuid;

      if v_finding_id is null then
        raise exception 'Client Journey AI finding upsert did not return a finding id.';
      end if;

      update public.ai_operations_findings
         set related_existing_exception_id = v_primary_exception_id,
             updated_at = now()
       where id = v_finding_id and tenant_id = p_tenant_id;

      delete from private.ai_ops_client_journey_finding_exception_links l
      where l.finding_id = v_finding_id
        and not (l.exception_id = any(v_related_exception_ids));

      foreach v_key in array v_related_exception_keys loop
        select e.id into v_exception_id
        from public.client_journey_exceptions e
        where e.tenant_id = p_tenant_id
          and e.client_id = v_client
          and private.ai_ops_client_journey_exception_key(e.id) = v_key
        limit 1;

        select a->>'assessment', left(coalesce(a->>'rationale',''), 1000)
          into v_assessment, v_rationale
        from jsonb_array_elements(coalesce(v_result->'exceptionAssessments', '[]'::jsonb)) a
        where a->>'exceptionKey' = v_key
        limit 1;

        insert into private.ai_ops_client_journey_finding_exception_links (
          finding_id, tenant_id, client_id, exception_id, exception_key,
          assessment, rationale, first_seen_run_id, last_seen_run_id, last_seen_at
        ) values (
          v_finding_id, p_tenant_id, v_client, v_exception_id, v_key,
          v_assessment, v_rationale, p_run_id, p_run_id, now()
        )
        on conflict (finding_id, exception_id) do update
          set exception_key = excluded.exception_key,
              assessment = excluded.assessment,
              rationale = excluded.rationale,
              last_seen_run_id = excluded.last_seen_run_id,
              last_seen_at = now();
      end loop;

      v_findings := v_findings + 1;
    end loop;
  end loop;

  perform public.ai_ops_autoresolve_findings(p_tenant_id, 'client_journey', p_run_id, v_observed);

  return jsonb_build_object('findings', v_findings, 'unmatchedResults', v_skipped);
end;
$function$;

revoke all on function public.ai_ops_build_client_journey_batches(uuid,uuid,timestamptz,integer) from public;
revoke all on function public.ai_ops_build_client_journey_batches(uuid,uuid,timestamptz,integer) from anon;
revoke all on function public.ai_ops_build_client_journey_batches(uuid,uuid,timestamptz,integer) from authenticated;
grant execute on function public.ai_ops_build_client_journey_batches(uuid,uuid,timestamptz,integer) to service_role;

revoke all on function public.ai_ops_ingest_client_journey_results(uuid,uuid) from public;
revoke all on function public.ai_ops_ingest_client_journey_results(uuid,uuid) from anon;
revoke all on function public.ai_ops_ingest_client_journey_results(uuid,uuid) from authenticated;
grant execute on function public.ai_ops_ingest_client_journey_results(uuid,uuid) to service_role;
