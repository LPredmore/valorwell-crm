-- ============================================================
-- AI Operations: production configuration + correctness pass
-- ============================================================

-- 1. Configuration rows (configuration only, never operational data)
insert into public.ai_operations_settings (
  tenant_id, timezone, provider, model, max_model_concurrency,
  client_journey_batch_size, brief_recipients
) values (
  '00000000-0000-0000-0000-000000000001', 'America/Chicago', 'gemini_developer_api',
  'gemini-2.5-pro', 4, 6, '{}'::text[]
)
on conflict (tenant_id) do update
  set timezone = 'America/Chicago',
      provider = 'gemini_developer_api',
      model = 'gemini-2.5-pro',
      max_model_concurrency = 4,
      client_journey_batch_size = 6,
      updated_at = now();

insert into private.ai_ops_flags (tenant_id, flag_name, enabled)
select '00000000-0000-0000-0000-000000000001', f.flag_name, f.enabled
from (values
  ('ai_operations_enabled', true),
  ('system_integrity_enabled', true),
  ('client_journey_ai_enabled', true),
  ('communications_ai_enabled', true),
  ('youtube_ai_enabled', true),
  ('executive_brief_enabled', true),
  ('shadow_mode', true),
  ('executive_brief_email_enabled', false)
) as f(flag_name, enabled)
on conflict (tenant_id, flag_name) do update set enabled = excluded.enabled, updated_at = now();

-- 2. Module lifecycle: derive terminal status from real work-item outcomes
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

  if v_total = 0 then
    -- Nothing needed the model: the deterministic collection is the whole result.
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

  return jsonb_build_object(
    'module', p_module, 'status', v_status, 'workItems', v_total,
    'completed', v_completed, 'failed', v_failed, 'pending', v_pending
  );
end;
$function$;

revoke all on function public.ai_ops_finalize_module_status(uuid, uuid, public.ai_ops_module_enum) from public;
grant execute on function public.ai_ops_finalize_module_status(uuid, uuid, public.ai_ops_module_enum) to service_role;

-- 3. Channel-aware Communications QA collection
create or replace function public.ai_ops_build_communications_batches(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamp with time zone default now(),
  p_lookback_days integer default 7,
  p_batch_size integer default 6
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_batch_size integer := least(greatest(coalesce(p_batch_size, 6), 5), 8);
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
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  for v_row in
    select * from (
      -- EMAIL: reply evidence requires authoritative threading, never "some later email".
      select
        'email'::text as channel,
        m.id::text as source_id,
        m.client_id,
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
                (m.provider_thread_id is not null and o.provider_thread_id = m.provider_thread_id)
                or (m.provider_message_id is not null and o.in_reply_to_message_id = m.provider_message_id)
              )
          ) then 'answered'
          when m.provider_thread_id is null and m.provider_message_id is null then 'unknown'
          else 'unanswered'
        end as response_state
      from public.crm_email_messages m
      where m.tenant_id = p_tenant_id
        and m.direction = 'inbound'
        and coalesce(m.received_at, m.occurred_at, m.created_at) between v_since and p_cutoff_at

      union all

      -- PORTAL: answered by a later staff message in the same client conversation.
      select
        'portal'::text as channel,
        pm.id::text as source_id,
        pm.client_id,
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
              and (pm.staff_id is null or r.staff_id is not distinct from pm.staff_id)
          ) then 'answered'
          when pm.client_id is null then 'unknown'
          else 'unanswered'
        end as response_state
      from public.messages pm
      where pm.tenant_id = p_tenant_id
        and pm.sender_type = 'client'
        and pm.created_at between v_since and p_cutoff_at

      union all

      -- SMS: answered only by recorded outbound SMS activity, never by email.
      select
        'sms'::text as channel,
        s.id::text as source_id,
        s.client_id,
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
      'message', v_row.excerpt
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
        '1', '1', 80, 'gemini-2.5-pro', '{}'::uuid[]
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
      '1', '1', 80, 'gemini-2.5-pro', '{}'::uuid[]
    );
    v_batches := v_batches + 1;
  end if;

  return jsonb_build_object(
    'sourceItemsTotal', v_seen,
    'answered', v_answered,
    'responseStateUnknown', v_unknown,
    'itemsQueued', v_queued_items,
    'batchesQueued', v_batches,
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

-- 4. Client Journey: richer operational snapshot + honest coverage accounting
create or replace function public.ai_ops_build_client_journey_batches(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamp with time zone default now(),
  p_batch_size integer default 6
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_batch_size integer := least(greatest(coalesce(p_batch_size, 6), 5), 8);
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
      c.last_contact_direction,
      c.last_contact_channel,
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
        where r.client_id = c.id and coalesce(r.status,'open') not in ('resolved','closed'))::int as open_support_requests
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

    -- Operational context only. No psychotherapy or session-note narrative is ever included.
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
      'closureReason', v_row.closure_reason
    );

    -- Evaluation hash excludes the per-run entity key so an unchanged client is reusable.
    v_eval_hash := md5((v_payload - 'entityKey')::text);

    insert into private.ai_ops_snapshots (
      tenant_id, entity_type, entity_id, snapshot_type, snapshot_hash, evaluation_hash,
      cutoff_at, payload, expires_at
    ) values (
      p_tenant_id, 'client', v_row.id::text, 'client_journey:' || p_run_id::text,
      v_entity_key, v_eval_hash, p_cutoff_at, v_payload, now() + interval '14 days'
    );

    -- Reuse: an identical evaluation hash already produced a completed result.
    -- A reused client still counts as covered today and its findings stay open.
    if exists (
      select 1
      from private.ai_ops_snapshots s
      join private.ai_ops_work_items w
        on w.tenant_id = s.tenant_id
       and w.module = 'client_journey'
       and w.status = 'completed'
       and w.structured_result is not null
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
        '1', '1', 100, 'gemini-2.5-pro', '{}'::uuid[]
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
      '1', '1', 100, 'gemini-2.5-pro', '{}'::uuid[]
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
    'cutoffAt', p_cutoff_at
  );
end;
$function$;

-- 5. Executive Brief: never publish before the model result exists (unless a hard cutoff forces a partial)
drop function if exists public.ai_ops_ingest_executive_brief(uuid, uuid);

create or replace function public.ai_ops_ingest_executive_brief(
  p_tenant_id uuid,
  p_run_id uuid,
  p_force_partial boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_result jsonb;
  v_business_date date;
  v_degraded integer;
  v_gaps jsonb;
  v_pending integer;
  v_brief_id uuid;
  v_is_partial boolean;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  select business_date into v_business_date from public.ai_operations_runs where id = p_run_id;

  select w.structured_result into v_result
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

  select count(*) filter (where status in ('failed','partial','running','pending')) into v_degraded
  from public.ai_operations_module_runs
  where run_id = p_run_id and module <> 'executive_brief';

  select coalesce(jsonb_agg(jsonb_build_object('module', module, 'status', status, 'errorCode', error_code)), '[]'::jsonb)
    into v_gaps
  from public.ai_operations_module_runs
  where run_id = p_run_id and module <> 'executive_brief'
    and status in ('failed','partial','running','pending');

  v_is_partial := coalesce(v_degraded, 0) > 0 or v_result is null;

  insert into public.ai_operations_briefs (
    run_id, tenant_id, business_date, is_partial, status, sections, coverage_manifest,
    everything_normal, generated_at, model, prompt_version
  ) values (
    p_run_id, p_tenant_id, v_business_date, v_is_partial,
    case when v_result is null then 'partial' else 'published' end,
    coalesce(v_result->'sections', '[]'::jsonb),
    jsonb_build_object('gaps', v_gaps, 'modelResultAvailable', v_result is not null),
    case when v_is_partial then '[]'::jsonb else coalesce(v_result->'everythingNormal', '[]'::jsonb) end,
    now(), 'gemini-2.5-pro', '1'
  )
  on conflict (tenant_id, business_date) do update
    set run_id = excluded.run_id,
        is_partial = excluded.is_partial,
        status = excluded.status,
        sections = excluded.sections,
        coverage_manifest = excluded.coverage_manifest,
        everything_normal = excluded.everything_normal,
        generated_at = now(),
        updated_at = now()
  returning id into v_brief_id;

  return jsonb_build_object(
    'status', case when v_result is null then 'partial' else 'published' end,
    'briefId', v_brief_id,
    'isPartial', v_is_partial,
    'gaps', v_gaps
  );
end;
$function$;

revoke all on function public.ai_ops_ingest_executive_brief(uuid, uuid, boolean) from public;
grant execute on function public.ai_ops_ingest_executive_brief(uuid, uuid, boolean) to service_role;

-- 6. Model worker cadence: every minute inside the existing morning UTC window
do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'ai-operations-model-worker-every-5-min';
  if v_jobid is not null then
    perform cron.alter_job(v_jobid, schedule => '* 7-12 * * 1-5');
  end if;
end $$;
