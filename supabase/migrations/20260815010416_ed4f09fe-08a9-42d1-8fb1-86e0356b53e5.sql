-- ============================================================
-- CLIENT JOURNEY
-- ============================================================

create or replace function public.ai_ops_build_client_journey_batches(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamptz default now(),
  p_batch_size integer default 6
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_size integer := least(greatest(coalesce(p_batch_size, 6), 5), 8);
  v_row record;
  v_entities jsonb := '[]'::jsonb;
  v_keys text[] := '{}'::text[];
  v_batch_index integer := 0;
  v_total integer := 0;
  v_reused integer := 0;
  v_queued integer := 0;
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
      c.primary_staff_id is not null as has_clinician,
      c.closed_at,
      case when c.last_contact_at is null then null
           else floor(extract(epoch from (p_cutoff_at - c.last_contact_at)) / 86400)::int end as days_since_contact,
      case when c.status_changed_at is null then null
           else floor(extract(epoch from (p_cutoff_at - c.status_changed_at)) / 86400)::int end as days_in_stage,
      (select count(*) from public.appointments a
        where a.client_id = c.id and a.start_at > p_cutoff_at
          and a.status::text not in ('cancelled','no_show'))::int as upcoming_appointments,
      (select max(a.start_at) from public.appointments a
        where a.client_id = c.id and a.start_at <= p_cutoff_at
          and a.status::text not in ('cancelled','no_show')) as last_appointment_at,
      (select count(*) from public.client_journey_exceptions e
        where e.client_id = c.id and e.resolution_state = 'open')::int as open_exceptions
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

    v_payload := jsonb_build_object(
      'entityKey', v_entity_key,
      'lifecycleStage', v_row.lifecycle_stage,
      'engagementState', v_row.engagement_state,
      'eligibilityState', v_row.eligibility_state,
      'contactPolicy', v_row.contact_policy,
      'servicePolicy', v_row.service_policy,
      'careCadence', v_row.care_cadence,
      'atRisk', v_row.at_risk,
      'hasAssignedClinician', v_row.has_clinician,
      'daysSinceLastContact', v_row.days_since_contact,
      'daysInCurrentStage', v_row.days_in_stage,
      'upcomingAppointments', v_row.upcoming_appointments,
      'daysSinceLastAppointment', case when v_row.last_appointment_at is null then null
        else floor(extract(epoch from (p_cutoff_at - v_row.last_appointment_at)) / 86400)::int end,
      'openOperationalExceptions', v_row.open_exceptions,
      'closedInLastDay', v_row.closed_at is not null
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
    if exists (
      select 1
      from private.ai_ops_snapshots s
      join private.ai_ops_work_items w
        on w.tenant_id = s.tenant_id
       and w.module = 'client_journey'
       and w.status = 'completed'
       and w.work_key like 'client_journey:%'
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

    v_entities := v_entities || v_payload;
    v_keys := v_keys || v_entity_key;

    if jsonb_array_length(v_entities) >= v_batch_size then
      v_batch_index := v_batch_index + 1;
      perform public.ai_ops_enqueue_work(
        p_tenant_id, p_run_id, 'client_journey',
        'client_journey:' || p_run_id::text || ':' || v_batch_index::text,
        'client_journey_review',
        jsonb_build_object('entities', v_entities),
        '1', '1', 100, 'gemini-2.5-pro', '{}'::uuid[]
      );
      v_queued := v_queued + 1;
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
    v_queued := v_queued + 1;
  end if;

  return jsonb_build_object(
    'clientsAccounted', v_total,
    'reused', v_reused,
    'batchesQueued', v_queued,
    'cutoffAt', p_cutoff_at
  );
end;
$$;

create or replace function public.ai_ops_ingest_client_journey_results(
  p_tenant_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_result jsonb;
  v_client uuid;
  v_observed text[] := '{}'::text[];
  v_findings integer := 0;
  v_skipped integer := 0;
  v_fingerprint text;
  v_exception_id uuid;
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
      select s.entity_id::uuid into v_client
      from private.ai_ops_snapshots s
      where s.tenant_id = p_tenant_id
        and s.snapshot_type = 'client_journey:' || p_run_id::text
        and s.snapshot_hash = v_result->>'entityKey'
      limit 1;

      if v_client is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if coalesce((v_result->>'noConcern')::boolean, false)
         or coalesce(v_result->>'severity', 'low') = 'low' then
        continue;
      end if;

      v_fingerprint := 'client_journey:' || v_client::text || ':' || coalesce(v_result->>'concernType', 'unspecified');
      v_observed := v_observed || v_fingerprint;

      select e.id into v_exception_id
      from public.client_journey_exceptions e
      where e.client_id = v_client and e.resolution_state = 'open'
      order by e.created_at desc limit 1;

      perform public.ai_ops_upsert_finding(
        p_tenant_id, p_run_id, 'client_journey', v_fingerprint,
        left(coalesce(v_result->>'title', 'Client journey concern'), 300),
        coalesce(nullif(v_result->>'severity',''), 'medium')::public.ai_ops_severity_enum,
        left(coalesce(v_result->>'summary', ''), 2000),
        left(coalesce(v_result->>'recommendedAction', ''), 1000),
        'client', v_client::text,
        nullif(v_result->>'confidence','')::numeric,
        v_exception_id,
        '[]'::jsonb
      );
      v_findings := v_findings + 1;
    end loop;
  end loop;

  perform public.ai_ops_autoresolve_findings(p_tenant_id, 'client_journey', p_run_id, v_observed);

  return jsonb_build_object('findings', v_findings, 'unmatchedResults', v_skipped);
end;
$$;

-- ============================================================
-- COMMUNICATIONS QA
-- ============================================================

create or replace function public.ai_ops_build_communications_batches(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamptz default now(),
  p_lookback_days integer default 7,
  p_batch_size integer default 6
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_size integer := least(greatest(coalesce(p_batch_size, 6), 5), 8);
  v_since timestamptz := p_cutoff_at - make_interval(days => greatest(coalesce(p_lookback_days, 7), 1));
  v_row record;
  v_entities jsonb := '[]'::jsonb;
  v_batch_index integer := 0;
  v_total integer := 0;
  v_queued integer := 0;
  v_entity_key text;
  v_payload jsonb;
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
        coalesce(m.received_at, m.occurred_at, m.created_at) as received_at,
        left(coalesce(m.body_text, m.subject, ''), 1500) as excerpt,
        m.subject,
        (select max(coalesce(o.sent_at, o.occurred_at))
           from public.crm_email_messages o
          where o.tenant_id = m.tenant_id
            and o.client_id is not distinct from m.client_id
            and o.direction = 'outbound'
            and coalesce(o.sent_at, o.occurred_at) > coalesce(m.received_at, m.occurred_at, m.created_at)
        ) as replied_at
      from public.crm_email_messages m
      where m.tenant_id = p_tenant_id
        and m.direction = 'inbound'
        and coalesce(m.received_at, m.occurred_at, m.created_at) between v_since and p_cutoff_at
      union all
      select
        'sms'::text as channel,
        s.id::text as source_id,
        s.client_id,
        s.received_at,
        left(coalesce(s.message_body, ''), 1500) as excerpt,
        null::text as subject,
        (select max(coalesce(o.sent_at, o.occurred_at))
           from public.crm_email_messages o
          where o.tenant_id = s.tenant_id
            and o.client_id is not distinct from s.client_id
            and o.direction = 'outbound'
            and coalesce(o.sent_at, o.occurred_at) > s.received_at
        ) as replied_at
      from public.crm_inbound_sms_logs s
      where s.tenant_id = p_tenant_id
        and s.received_at between v_since and p_cutoff_at
    ) inbound
    where inbound.replied_at is null
    order by inbound.received_at
  loop
    v_total := v_total + 1;
    v_entity_key := 't' || left(md5(v_row.channel || v_row.source_id || p_run_id::text), 12);

    v_payload := jsonb_build_object(
      'entityKey', v_entity_key,
      'channel', v_row.channel,
      'receivedAt', v_row.received_at,
      'ageHours', floor(extract(epoch from (p_cutoff_at - v_row.received_at)) / 3600)::int,
      'responseDeadlineAt', private.ai_ops_business_day_deadline(p_tenant_id, v_row.received_at, 1),
      'deadlinePassed', private.ai_ops_business_day_deadline(p_tenant_id, v_row.received_at, 1) < p_cutoff_at,
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

    if jsonb_array_length(v_entities) >= v_batch_size then
      v_batch_index := v_batch_index + 1;
      perform public.ai_ops_enqueue_work(
        p_tenant_id, p_run_id, 'communications',
        'communications:' || p_run_id::text || ':' || v_batch_index::text,
        'communications_qa_review',
        jsonb_build_object('entities', v_entities),
        '1', '1', 80, 'gemini-2.5-pro', '{}'::uuid[]
      );
      v_queued := v_queued + 1;
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
    v_queued := v_queued + 1;
  end if;

  return jsonb_build_object('unansweredInbound', v_total, 'batchesQueued', v_queued, 'cutoffAt', p_cutoff_at);
end;
$$;

create or replace function public.ai_ops_ingest_communications_results(
  p_tenant_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_result jsonb;
  v_snapshot record;
  v_observed text[] := '{}'::text[];
  v_findings integer := 0;
  v_skipped integer := 0;
  v_fingerprint text;
  v_severity public.ai_ops_severity_enum;
  v_deadline_passed boolean;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  for v_item in
    select w.id, w.structured_result
    from private.ai_ops_work_items w
    where w.tenant_id = p_tenant_id and w.run_id = p_run_id
      and w.module = 'communications' and w.status = 'completed'
  loop
    for v_result in select value from jsonb_array_elements(coalesce(v_item.structured_result->'results', '[]'::jsonb)) loop
      select s.entity_type, s.entity_id, s.payload into v_snapshot
      from private.ai_ops_snapshots s
      where s.tenant_id = p_tenant_id
        and s.snapshot_type = 'communications:' || p_run_id::text
        and s.snapshot_hash = v_result->>'entityKey'
      limit 1;

      if v_snapshot.entity_id is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if not coalesce((v_result->>'responseRequired')::boolean, false) then
        continue;
      end if;

      -- Deadline breach is deterministic, not a model judgement.
      v_deadline_passed := coalesce((v_snapshot.payload->>'deadlinePassed')::boolean, false);

      v_severity := case
        when coalesce((v_result->>'safetyRisk')::boolean, false) then 'critical'
        when v_deadline_passed then 'high'
        else 'medium'
      end::public.ai_ops_severity_enum;

      v_fingerprint := 'communications:' || v_snapshot.entity_type || ':' || v_snapshot.entity_id;
      v_observed := v_observed || v_fingerprint;

      perform public.ai_ops_upsert_finding(
        p_tenant_id, p_run_id, 'communications', v_fingerprint,
        left(coalesce(v_result->>'title', 'Inbound message awaiting a response'), 300),
        v_severity,
        left(coalesce(v_result->>'summary', ''), 2000)
          || case when v_deadline_passed then ' The one-business-day response deadline has passed.' else '' end,
        left(coalesce(v_result->>'recommendedAction', 'Respond to the client.'), 1000),
        v_snapshot.entity_type, v_snapshot.entity_id,
        nullif(v_result->>'confidence','')::numeric,
        null,
        jsonb_build_array(jsonb_build_object(
          'sourceType', v_snapshot.entity_type,
          'sourceRecordId', v_snapshot.entity_id,
          'sourceTimestamp', v_snapshot.payload->>'receivedAt',
          'excerpt', left(coalesce(v_snapshot.payload->>'message',''), 500),
          'evidenceHash', md5(v_fingerprint)
        ))
      );
      v_findings := v_findings + 1;
    end loop;
  end loop;

  perform public.ai_ops_autoresolve_findings(p_tenant_id, 'communications', p_run_id, v_observed);

  return jsonb_build_object('findings', v_findings, 'unmatchedResults', v_skipped);
end;
$$;

-- ============================================================
-- YOUTUBE
-- ============================================================

create or replace function public.ai_ops_upsert_youtube_comment(
  p_tenant_id uuid,
  p_channel_id text,
  p_video_id text,
  p_video_title text,
  p_comment_id text,
  p_parent_comment_id text,
  p_author_display_name text,
  p_comment_text text,
  p_published_at timestamptz,
  p_comment_updated_at timestamptz,
  p_initiative text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := md5(coalesce(p_comment_text, ''));
  v_id uuid;
  v_needs_analysis boolean;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  insert into public.ai_operations_youtube_comments (
    tenant_id, channel_id, video_id, video_title, initiative, comment_id, parent_comment_id,
    author_display_name, comment_text, published_at, comment_updated_at, content_hash
  ) values (
    p_tenant_id, p_channel_id, p_video_id, p_video_title, p_initiative, p_comment_id, p_parent_comment_id,
    p_author_display_name, p_comment_text, p_published_at, p_comment_updated_at, v_hash
  )
  on conflict (tenant_id, comment_id) do update
    set video_title = excluded.video_title,
        comment_text = excluded.comment_text,
        comment_updated_at = excluded.comment_updated_at,
        content_hash = excluded.content_hash,
        initiative = coalesce(excluded.initiative, public.ai_operations_youtube_comments.initiative),
        updated_at = now()
  returning id, (analyzed_content_hash is distinct from v_hash) into v_id, v_needs_analysis;

  return jsonb_build_object('id', v_id, 'needsAnalysis', coalesce(v_needs_analysis, true));
end;
$$;

create or replace function public.ai_ops_build_youtube_batches(
  p_tenant_id uuid,
  p_run_id uuid,
  p_batch_size integer default 8,
  p_max_comments integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_entities jsonb := '[]'::jsonb;
  v_batch_index integer := 0;
  v_total integer := 0;
  v_queued integer := 0;
  v_entity_key text;
  v_payload jsonb;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  for v_row in
    select c.id, c.comment_id, c.video_title, c.initiative, c.comment_text, c.published_at
    from public.ai_operations_youtube_comments c
    where c.tenant_id = p_tenant_id
      and (c.analyzed_content_hash is null or c.analyzed_content_hash <> c.content_hash)
    order by c.published_at desc nulls last
    limit greatest(coalesce(p_max_comments, 200), 1)
  loop
    v_total := v_total + 1;
    v_entity_key := 'y' || left(md5(v_row.comment_id || p_run_id::text), 12);
    v_payload := jsonb_build_object(
      'entityKey', v_entity_key,
      'videoTitle', left(coalesce(v_row.video_title, ''), 200),
      'initiative', v_row.initiative,
      'publishedAt', v_row.published_at,
      'comment', left(coalesce(v_row.comment_text, ''), 1500)
    );

    insert into private.ai_ops_snapshots (
      tenant_id, entity_type, entity_id, snapshot_type, snapshot_hash, evaluation_hash,
      cutoff_at, payload, expires_at
    ) values (
      p_tenant_id, 'youtube_comment', v_row.id::text, 'youtube:' || p_run_id::text,
      v_entity_key, md5((v_payload - 'entityKey')::text), now(), v_payload, now() + interval '14 days'
    );

    v_entities := v_entities || v_payload;
    if jsonb_array_length(v_entities) >= greatest(coalesce(p_batch_size, 8), 1) then
      v_batch_index := v_batch_index + 1;
      perform public.ai_ops_enqueue_work(
        p_tenant_id, p_run_id, 'youtube',
        'youtube:' || p_run_id::text || ':' || v_batch_index::text,
        'youtube_comment_review', jsonb_build_object('entities', v_entities),
        '1', '1', 120, 'gemini-2.5-pro', '{}'::uuid[]
      );
      v_queued := v_queued + 1;
      v_entities := '[]'::jsonb;
    end if;
  end loop;

  if jsonb_array_length(v_entities) > 0 then
    v_batch_index := v_batch_index + 1;
    perform public.ai_ops_enqueue_work(
      p_tenant_id, p_run_id, 'youtube',
      'youtube:' || p_run_id::text || ':' || v_batch_index::text,
      'youtube_comment_review', jsonb_build_object('entities', v_entities),
      '1', '1', 120, 'gemini-2.5-pro', '{}'::uuid[]
    );
    v_queued := v_queued + 1;
  end if;

  return jsonb_build_object('commentsQueued', v_total, 'batchesQueued', v_queued);
end;
$$;

create or replace function public.ai_ops_ingest_youtube_results(
  p_tenant_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_result jsonb;
  v_comment_id uuid;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_findings integer := 0;
  v_observed text[] := '{}'::text[];
  v_fingerprint text;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  for v_item in
    select w.structured_result
    from private.ai_ops_work_items w
    where w.tenant_id = p_tenant_id and w.run_id = p_run_id
      and w.module = 'youtube' and w.status = 'completed'
  loop
    for v_result in select value from jsonb_array_elements(coalesce(v_item.structured_result->'results', '[]'::jsonb)) loop
      select s.entity_id::uuid into v_comment_id
      from private.ai_ops_snapshots s
      where s.tenant_id = p_tenant_id
        and s.snapshot_type = 'youtube:' || p_run_id::text
        and s.snapshot_hash = v_result->>'entityKey'
      limit 1;

      if v_comment_id is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      update public.ai_operations_youtube_comments
         set classification = v_result->>'classification',
             priority = nullif(v_result->>'severity','')::public.ai_ops_severity_enum,
             suggested_reply = left(coalesce(v_result->>'suggestedReply',''), 2000),
             analyzed_content_hash = content_hash,
             analyzed_at = now(),
             review_state = case when review_state = 'new' then 'awaiting_review' else review_state end,
             updated_at = now()
       where id = v_comment_id and tenant_id = p_tenant_id;
      v_updated := v_updated + 1;

      if coalesce(v_result->>'classification','') = 'crisis'
         or coalesce(v_result->>'severity','') in ('critical','high') then
        v_fingerprint := 'youtube:' || v_comment_id::text;
        v_observed := v_observed || v_fingerprint;
        perform public.ai_ops_upsert_finding(
          p_tenant_id, p_run_id, 'youtube', v_fingerprint,
          left(coalesce(v_result->>'title', 'YouTube comment needs attention'), 300),
          coalesce(nullif(v_result->>'severity',''), 'high')::public.ai_ops_severity_enum,
          left(coalesce(v_result->>'summary', ''), 2000),
          'Review the comment and the drafted reply before responding.',
          'youtube_comment', v_comment_id::text,
          nullif(v_result->>'confidence','')::numeric, null, '[]'::jsonb
        );
        v_findings := v_findings + 1;
      end if;
    end loop;
  end loop;

  perform public.ai_ops_autoresolve_findings(p_tenant_id, 'youtube', p_run_id, v_observed);
  return jsonb_build_object('commentsUpdated', v_updated, 'findings', v_findings, 'unmatchedResults', v_skipped);
end;
$$;

-- ============================================================
-- EXECUTIVE BRIEF
-- ============================================================

create or replace function public.ai_ops_build_executive_brief_input(
  p_tenant_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modules jsonb;
  v_findings jsonb;
  v_payload jsonb;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

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
  )), '[]'::jsonb) into v_findings
  from (
    select f.module, f.severity, count(*)::int as count
    from public.ai_operations_findings f
    where f.tenant_id = p_tenant_id and f.status = 'open'
    group by f.module, f.severity
  ) f;

  v_payload := jsonb_build_object('modules', v_modules, 'openFindings', v_findings);

  perform public.ai_ops_enqueue_work(
    p_tenant_id, p_run_id, 'executive_brief',
    'executive_brief:' || p_run_id::text,
    'executive_brief_synthesis', v_payload,
    '1', '1', 10, 'gemini-2.5-pro', '{}'::uuid[]
  );

  return v_payload;
end;
$$;

create or replace function public.ai_ops_ingest_executive_brief(
  p_tenant_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_business_date date;
  v_degraded integer;
  v_gaps jsonb;
  v_brief_id uuid;
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

  select count(*) filter (where status in ('failed','partial')) into v_degraded
  from public.ai_operations_module_runs where run_id = p_run_id;

  select coalesce(jsonb_agg(jsonb_build_object('module', module, 'status', status, 'errorCode', error_code)), '[]'::jsonb)
    into v_gaps
  from public.ai_operations_module_runs
  where run_id = p_run_id and status in ('failed','partial');

  insert into public.ai_operations_briefs (
    run_id, tenant_id, business_date, is_partial, status, sections, coverage_manifest,
    everything_normal, generated_at, model, prompt_version
  ) values (
    p_run_id, p_tenant_id, v_business_date, coalesce(v_degraded, 0) > 0 or v_result is null,
    case when v_result is null then 'unavailable' else 'generated' end,
    coalesce(v_result->'sections', '[]'::jsonb),
    jsonb_build_object(
      'headline', v_result->>'headline',
      'gaps', coalesce(v_result->'gaps', v_gaps),
      'degradedModules', coalesce(v_degraded, 0)
    ),
    coalesce(v_result->'everythingNormal', '[]'::jsonb),
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

  return jsonb_build_object('briefId', v_brief_id, 'isPartial', coalesce(v_degraded, 0) > 0 or v_result is null);
end;
$$;

-- Worker-only execution for all collectors and ingesters
do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.ai_ops_build_client_journey_batches(uuid, uuid, timestamptz, integer)',
    'public.ai_ops_ingest_client_journey_results(uuid, uuid)',
    'public.ai_ops_build_communications_batches(uuid, uuid, timestamptz, integer, integer)',
    'public.ai_ops_ingest_communications_results(uuid, uuid)',
    'public.ai_ops_upsert_youtube_comment(uuid, text, text, text, text, text, text, text, timestamptz, timestamptz, text)',
    'public.ai_ops_build_youtube_batches(uuid, uuid, integer, integer)',
    'public.ai_ops_ingest_youtube_results(uuid, uuid)',
    'public.ai_ops_build_executive_brief_input(uuid, uuid)',
    'public.ai_ops_ingest_executive_brief(uuid, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end $$;
