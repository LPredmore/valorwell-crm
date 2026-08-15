-- AI Operations: Flash optimization pass.
create or replace function public.ai_ops_enqueue_work(
  p_tenant_id uuid, p_run_id uuid, p_module public.ai_ops_module_enum, p_work_key text,
  p_work_type text, p_input_payload jsonb, p_prompt_version text, p_schema_version text,
  p_priority integer default 100, p_model text default null, p_input_snapshot_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_id uuid;
  v_inserted boolean := false;
  v_model text;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  select s.model into v_model from public.ai_operations_settings s where s.tenant_id = p_tenant_id;
  v_model := coalesce(v_model, p_model, 'gemini-flash-latest');

  insert into private.ai_ops_work_items (
    tenant_id, run_id, module, work_key, work_type, priority,
    input_snapshot_ids, input_payload, requested_model, prompt_version, schema_version
  ) values (
    p_tenant_id, p_run_id, p_module, p_work_key, p_work_type, coalesce(p_priority, 100),
    coalesce(p_input_snapshot_ids, '{}'::uuid[]), p_input_payload, v_model,
    p_prompt_version, p_schema_version
  )
  on conflict (tenant_id, work_key) do nothing
  returning id into v_id;

  if v_id is not null then
    v_inserted := true;
  else
    select id into v_id from private.ai_ops_work_items
    where tenant_id = p_tenant_id and work_key = p_work_key;
  end if;

  return jsonb_build_object('workItemId', v_id, 'inserted', v_inserted, 'model', v_model);
end;
$function$;

alter table private.ai_ops_work_items alter column requested_model set default 'gemini-flash-latest';

create or replace function public.ai_ops_build_client_journey_batches(
  p_tenant_id uuid, p_run_id uuid, p_cutoff_at timestamptz default now(), p_batch_size integer default 6
) returns jsonb
language plpgsql security definer set search_path to ''
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
      case when c.status_changed_at is null then null
           else floor(extract(epoch from (p_cutoff_at - c.status_changed_at)) / 86400)::int end as days_in_stage,
      (select m.state::text from public.client_therapist_matches m
        where m.client_id = c.id and m.resolved_at is null
        order by m.created_at desc limit 1) as therapist_match_state,
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
        and not exists (
          select 1 from public.appointments a
          where a.client_id = c.id and a.created_at >= c.lifecycle_stage_changed_at
        )
      ) as match_no_movement_24h,
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

    if v_row.lifecycle_stage in ('scheduled','early_care','established_care')
       and v_row.upcoming_appointments = 0 then
      v_signals := v_signals || 'activeWithoutFutureAppointment';
    end if;

    if v_row.recent_cancellations > 0 and v_row.upcoming_appointments = 0 then
      v_signals := v_signals || 'cancelledWithoutReschedule';
    end if;

    if v_row.recent_cancellations >= 2 then
      v_signals := v_signals || 'recentRepeatedCancellationOrNoShow';
    end if;

    if v_row.lifecycle_stage in ('matched','scheduled','early_care','established_care')
       and not v_row.has_clinician then
      v_signals := v_signals || 'unassignedClinician';
    end if;

    if v_row.therapist_match_state is not null then
      v_signals := v_signals || 'therapistMatchPending';
    end if;

    if v_row.match_no_movement_24h then
      v_signals := v_signals || 'therapistMatchStalled';
    end if;

    if v_row.engagement_state in ('unresponsive_warm','unresponsive_cold','went_dark') then
      v_signals := v_signals || 'engagementStateIndicatesUnresponsive';
      if v_row.upcoming_appointments = 0 then
        v_signals := v_signals || 'noRecentContactAndNoFutureAppointment';
      end if;
    end if;

    if v_row.open_support_requests > 0 then
      v_signals := v_signals || 'openSupportRequest';
    end if;

    if v_row.open_exceptions > 0 then
      v_signals := v_signals || 'hasOpenJourneyException';
    end if;

    if v_row.at_risk and v_row.at_risk_since is not null
       and v_row.appointments_since_at_risk = 0
       and (v_row.last_contact_at is null or v_row.last_contact_at < v_row.at_risk_since) then
      v_signals := v_signals || 'atRiskWithoutRecentProgress';
    end if;

    if v_row.lifecycle_stage = 'closed'
       and (v_row.open_exceptions > 0 or v_row.open_support_requests > 0) then
      v_signals := v_signals || 'closedWithUnresolvedOperationalItems';
    end if;

    if (v_row.lifecycle_stage in ('registration','intake','matching') and v_row.upcoming_appointments > 0)
       or (v_row.lifecycle_stage = 'closed' and v_row.upcoming_appointments > 0) then
      v_signals := v_signals || 'lifecycleAppointmentConflict';
    end if;

    if v_row.eligibility_state in ('coverage_issue','manual_review')
       and v_row.lifecycle_stage <> 'closed' then
      v_signals := v_signals || 'eligibilityBlockingProgress';
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
        else floor(extract(epoch from (p_cutoff_at - v_row.at_risk_since)) / 86400)::int end,
      'hasAssignedClinician', v_row.has_clinician,
      'therapistMatchState', v_row.therapist_match_state,
      'daysSinceLastContact', v_row.days_since_contact,
      'lastContactDirection', v_row.last_contact_direction,
      'lastContactChannel', v_row.last_contact_channel,
      'daysInCurrentStage', v_row.days_in_stage,
      'upcomingAppointments', v_row.upcoming_appointments,
      'daysUntilNextAppointment', case when v_row.next_appointment_at is null then null
        else floor(extract(epoch from (v_row.next_appointment_at - p_cutoff_at)) / 86400)::int end,
      'daysSinceLastAppointment', case when v_row.last_appointment_at is null then null
        else floor(extract(epoch from (p_cutoff_at - v_row.last_appointment_at)) / 86400)::int end,
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

create or replace function public.ai_ops_build_communications_batches(
  p_tenant_id uuid, p_run_id uuid, p_cutoff_at timestamptz default now(),
  p_lookback_days integer default 7, p_batch_size integer default 6
) returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_batch_size integer := least(greatest(coalesce(p_batch_size, 6), 5), 8);
  v_prompt_version text := '2';
  v_since timestamptz := p_cutoff_at - make_interval(days => greatest(coalesce(p_lookback_days, 7), 1));
  v_row record;
  v_entities jsonb := '[]'::jsonb;
  v_batch_index integer := 0;
  v_seen integer := 0;
  v_answered integer := 0;
  v_unknown integer := 0;
  v_queued_items integer := 0;
  v_batches integer := 0;
  v_email integer := 0;
  v_portal integer := 0;
  v_sms integer := 0;
  v_entity_key text;
  v_payload jsonb;
  v_deadline timestamptz;
  v_signals text[];
  v_prior jsonb;
  v_client_messages integer;
  v_staff_responses integer;
  v_distinct_staff integer;
  v_repeated_question boolean;
  v_open_finding boolean;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  for v_row in
    select * from (
      select
        'email'::text as channel,
        m.id::text as source_id,
        m.client_id,
        m.provider_thread_id,
        coalesce(m.received_at, m.occurred_at, m.created_at) as received_at,
        left(coalesce(m.body_text, m.subject, ''), 1500) as excerpt,
        m.subject,
        case
          when exists (
            select 1 from public.crm_email_messages o
            where o.tenant_id = m.tenant_id
              and o.direction = 'outbound'
              and coalesce(o.sent_at, o.occurred_at) > coalesce(m.received_at, m.occurred_at, m.created_at)
              and (
                o.in_reply_to_message_id = m.id
                or (m.provider_thread_id is not null and o.provider_thread_id = m.provider_thread_id)
              )
          ) then 'answered'
          when m.provider_thread_id is null then 'unknown'
          else 'unanswered'
        end as response_state
      from public.crm_email_messages m
      where m.tenant_id = p_tenant_id
        and m.direction = 'inbound'
        and coalesce(m.received_at, m.occurred_at, m.created_at) between v_since and p_cutoff_at

      union all

      select
        'portal'::text as channel,
        pm.id::text as source_id,
        pm.client_id,
        null::text as provider_thread_id,
        pm.created_at as received_at,
        left(coalesce(pm.body, ''), 1500) as excerpt,
        null::text as subject,
        case
          when exists (
            select 1 from public.messages r
            where r.tenant_id = pm.tenant_id
              and r.client_id = pm.client_id
              and r.sender_type = 'staff'
              and r.created_at > pm.created_at
          ) then 'answered'
          when pm.client_id is null then 'unknown'
          else 'unanswered'
        end as response_state
      from public.messages pm
      where pm.tenant_id = p_tenant_id
        and pm.sender_type = 'client'
        and pm.created_at between v_since and p_cutoff_at

      union all

      select
        'sms'::text as channel,
        s.id::text as source_id,
        s.client_id,
        null::text as provider_thread_id,
        s.received_at,
        left(coalesce(s.message_body, ''), 1500) as excerpt,
        null::text as subject,
        case
          when s.client_id is null then 'unknown'
          when exists (
            select 1 from public.crm_activity_events a
            where a.tenant_id = s.tenant_id
              and a.client_id = s.client_id
              and a.event_type = 'sms_sent'
              and a.created_at > s.received_at
          ) then 'answered'
          else 'unanswered'
        end as response_state
      from public.crm_inbound_sms_logs s
      where s.tenant_id = p_tenant_id
        and s.received_at between v_since and p_cutoff_at
    ) inbound
    order by inbound.received_at
  loop
    v_seen := v_seen + 1;
    if v_row.channel = 'email' then v_email := v_email + 1;
    elsif v_row.channel = 'portal' then v_portal := v_portal + 1;
    else v_sms := v_sms + 1;
    end if;

    if v_row.response_state = 'answered' then
      v_answered := v_answered + 1;
      continue;
    end if;
    if v_row.response_state = 'unknown' then
      v_unknown := v_unknown + 1;
    end if;

    v_entity_key := 't' || left(md5(v_row.channel || v_row.source_id || p_run_id::text), 12);
    v_deadline := private.ai_ops_business_day_deadline(p_tenant_id, v_row.received_at, 1);

    v_client_messages := 0;
    v_staff_responses := 0;
    v_distinct_staff := 0;
    v_repeated_question := false;
    v_prior := '[]'::jsonb;

    if v_row.channel = 'email' and v_row.provider_thread_id is not null then
      select
        count(*) filter (where t.direction = 'inbound')::int,
        count(*) filter (where t.direction = 'outbound')::int,
        count(distinct t.sender_email) filter (where t.direction = 'outbound')::int,
        count(*) filter (where t.direction = 'inbound' and t.body_text like '%?%')::int > 1
      into v_client_messages, v_staff_responses, v_distinct_staff, v_repeated_question
      from public.crm_email_messages t
      where t.tenant_id = p_tenant_id
        and t.provider_thread_id = v_row.provider_thread_id
        and coalesce(t.received_at, t.sent_at, t.occurred_at, t.created_at) <= p_cutoff_at;

      select coalesce(jsonb_agg(p order by p->>'at'), '[]'::jsonb) into v_prior
      from (
        select jsonb_build_object(
                 'direction', t.direction,
                 'at', coalesce(t.received_at, t.sent_at, t.occurred_at, t.created_at),
                 'excerpt', left(coalesce(t.body_text, t.subject, ''), 300)
               ) as p
        from public.crm_email_messages t
        where t.tenant_id = p_tenant_id
          and t.provider_thread_id = v_row.provider_thread_id
          and t.id::text <> v_row.source_id
          and coalesce(t.received_at, t.sent_at, t.occurred_at, t.created_at) < v_row.received_at
        order by coalesce(t.received_at, t.sent_at, t.occurred_at, t.created_at) desc
        limit 2
      ) recent;

    elsif v_row.channel = 'portal' and v_row.client_id is not null then
      select
        count(*) filter (where t.sender_type = 'client')::int,
        count(*) filter (where t.sender_type = 'staff')::int,
        count(distinct t.sender_id) filter (where t.sender_type = 'staff')::int,
        count(*) filter (where t.sender_type = 'client' and t.body like '%?%')::int > 1
      into v_client_messages, v_staff_responses, v_distinct_staff, v_repeated_question
      from public.messages t
      where t.tenant_id = p_tenant_id
        and t.client_id = v_row.client_id
        and t.created_at between v_since and p_cutoff_at;

      select coalesce(jsonb_agg(p order by p->>'at'), '[]'::jsonb) into v_prior
      from (
        select jsonb_build_object(
                 'direction', case when t.sender_type = 'client' then 'inbound' else 'outbound' end,
                 'at', t.created_at,
                 'excerpt', left(coalesce(t.body, ''), 300)
               ) as p
        from public.messages t
        where t.tenant_id = p_tenant_id
          and t.client_id = v_row.client_id
          and t.id::text <> v_row.source_id
          and t.created_at < v_row.received_at
        order by t.created_at desc
        limit 2
      ) recent;

    elsif v_row.channel = 'sms' and v_row.client_id is not null then
      select count(*)::int, count(*) filter (where s.message_body like '%?%')::int > 1
      into v_client_messages, v_repeated_question
      from public.crm_inbound_sms_logs s
      where s.tenant_id = p_tenant_id
        and s.client_id = v_row.client_id
        and s.received_at between v_since and p_cutoff_at;

      select count(*)::int into v_staff_responses
      from public.crm_activity_events a
      where a.tenant_id = p_tenant_id
        and a.client_id = v_row.client_id
        and a.event_type = 'sms_sent'
        and a.created_at between v_since and p_cutoff_at;
    end if;

    v_open_finding := false;
    if v_row.client_id is not null then
      select exists (
        select 1 from public.ai_operations_findings f
        where f.tenant_id = p_tenant_id
          and f.module = 'communications'
          and f.status = 'open'
          and f.entity_id = v_row.client_id::text
      ) into v_open_finding;
    end if;

    v_signals := '{}'::text[];
    if v_row.response_state = 'unanswered' then v_signals := v_signals || 'noResponseRecorded'; end if;
    if v_row.response_state = 'unknown' then v_signals := v_signals || 'responseStateUnknown'; end if;
    if v_deadline < p_cutoff_at then v_signals := v_signals || 'deadlinePassed'; end if;
    if coalesce(v_client_messages, 0) > 1 then v_signals := v_signals || 'repeatedClientContact'; end if;
    if coalesce(v_repeated_question, false) then v_signals := v_signals || 'repeatedQuestion'; end if;
    if coalesce(v_distinct_staff, 0) > 1 then v_signals := v_signals || 'multipleStaffHandoffs'; end if;
    if v_open_finding then v_signals := v_signals || 'recentRelatedOpenCommunicationFinding'; end if;

    v_payload := jsonb_build_object(
      'entityKey', v_entity_key,
      'channel', v_row.channel,
      'receivedAt', v_row.received_at,
      'ageHours', floor(extract(epoch from (p_cutoff_at - v_row.received_at)) / 3600)::int,
      'responseDeadlineAt', v_deadline,
      'deadlinePassed', v_deadline < p_cutoff_at,
      'responseEvidence', v_row.response_state,
      'hasLinkedClient', v_row.client_id is not null,
      'subject', left(coalesce(v_row.subject, ''), 300),
      'message', v_row.excerpt,
      'recentClientMessagesInThread', coalesce(v_client_messages, 0),
      'staffResponsesInThread', coalesce(v_staff_responses, 0),
      'distinctStaffParticipants', coalesce(v_distinct_staff, 0),
      'precedingMessages', coalesce(v_prior, '[]'::jsonb),
      'derivedSignals', to_jsonb(v_signals)
    );

    insert into private.ai_ops_snapshots (
      tenant_id, entity_type, entity_id, snapshot_type, snapshot_hash, evaluation_hash,
      cutoff_at, payload, expires_at
    ) values (
      p_tenant_id, v_row.channel || '_message', v_row.source_id,
      'communications:' || p_run_id::text, v_entity_key,
      md5((v_payload - 'entityKey')::text), p_cutoff_at,
      v_payload || jsonb_build_object('clientId', v_row.client_id),
      now() + interval '14 days'
    );

    v_entities := v_entities || v_payload;
    v_queued_items := v_queued_items + 1;

    if jsonb_array_length(v_entities) >= v_batch_size then
      v_batch_index := v_batch_index + 1;
      perform public.ai_ops_enqueue_work(
        p_tenant_id, p_run_id, 'communications',
        'communications:' || p_run_id::text || ':' || v_batch_index::text,
        'communications_qa_review',
        jsonb_build_object('entities', v_entities),
        v_prompt_version, '1', 80, null, '{}'::uuid[]
      );
      v_batches := v_batches + 1;
      v_entities := '[]'::jsonb;
    end if;
  end loop;

  if jsonb_array_length(v_entities) > 0 then
    v_batch_index := v_batch_index + 1;
    perform public.ai_ops_enqueue_work(
      p_tenant_id, p_run_id, 'communications',
      'communications:' || p_run_id::text || ':' || v_batch_index::text,
      'communications_qa_review',
      jsonb_build_object('entities', v_entities),
      v_prompt_version, '1', 80, null, '{}'::uuid[]
    );
    v_batches := v_batches + 1;
  end if;

  return jsonb_build_object(
    'sourceItemsTotal', v_seen,
    'answered', v_answered,
    'responseStateUnknown', v_unknown,
    'itemsQueued', v_queued_items,
    'batchesQueued', v_batches,
    'promptVersion', v_prompt_version,
    'sources', jsonb_build_object(
      'email', v_email,
      'portal', v_portal,
      'sms', v_sms,
      'ringcentralCalls', 'unavailable: no reliable client-linked call or voicemail records are persisted'
    ),
    'cutoffAt', p_cutoff_at
  );
end;
$function$;

create or replace function public.ai_ops_build_executive_brief_input(p_tenant_id uuid, p_run_id uuid)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_prompt_version text := '2';
  v_modules jsonb;
  v_counts jsonb;
  v_top jsonb;
  v_new jsonb;
  v_resolved jsonb;
  v_integrity jsonb;
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
        'state', case
          when v_prior_date is not null and f.first_detected_at::date >= v_prior_date then 'new'
          else 'ongoing' end,
        'firstDetectedAt', f.first_detected_at,
        'lastSeenAt', f.last_seen_at
      ) as item
    from public.ai_operations_findings f
    where f.tenant_id = p_tenant_id
      and f.status = 'open'
      and f.severity::text in ('critical','high')
    order by
      case f.severity::text when 'critical' then 1 else 2 end,
      f.first_detected_at desc
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

    select coalesce(jsonb_agg(jsonb_build_object(
      'title', f.title, 'module', f.module, 'severity', f.severity)), '[]'::jsonb)
      into v_new
    from public.ai_operations_findings f
    where f.tenant_id = p_tenant_id
      and f.status = 'open'
      and f.first_detected_at::date > v_prior_date;

    select coalesce(jsonb_agg(jsonb_build_object(
      'title', f.title, 'module', f.module, 'severity', f.severity)), '[]'::jsonb)
      into v_resolved
    from public.ai_operations_findings f
    where f.tenant_id = p_tenant_id
      and f.resolved_at is not null
      and f.resolved_at::date > v_prior_date;
  else
    v_new := '[]'::jsonb;
    v_resolved := '[]'::jsonb;
  end if;

  select coalesce(jsonb_build_object(
    'status', m.status,
    'coverage', m.coverage,
    'errorCode', m.error_code
  ), '{}'::jsonb) into v_integrity
  from public.ai_operations_module_runs m
  where m.run_id = p_run_id and m.module = 'system_integrity';

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
      select jsonb_agg(jsonb_build_object('module', m.module, 'status', m.status, 'errorCode', m.error_code)
                       order by m.module)
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

update private.ai_ops_work_items w
   set requested_model = s.model,
       prompt_version = case
         when w.work_type = 'client_journey_review' then '2'
         when w.work_type = 'communications_qa_review' then '2'
         when w.work_type = 'executive_brief_synthesis' then '2'
         else w.prompt_version end,
       status = 'queued',
       next_attempt_at = now(),
       error_code = null,
       error_summary = null,
       updated_at = now()
  from public.ai_operations_settings s
 where s.tenant_id = w.tenant_id
   and w.status in ('queued','retry_wait')
   and (w.requested_model <> s.model or w.prompt_version <> '2');