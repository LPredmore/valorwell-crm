-- Worker-facing AI Operations functions. service_role only.

create or replace function public.ai_ops_begin_run(
  p_tenant_id uuid,
  p_business_date date,
  p_source_cutoff_at timestamptz default now(),
  p_timezone text default 'America/Chicago'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  insert into public.ai_operations_runs (tenant_id, business_date, timezone, started_at, source_cutoff_at, overall_status)
  values (p_tenant_id, p_business_date, coalesce(p_timezone, 'America/Chicago'), now(), p_source_cutoff_at, 'running')
  on conflict (tenant_id, business_date) do update
    set started_at = coalesce(public.ai_operations_runs.started_at, now()),
        source_cutoff_at = coalesce(public.ai_operations_runs.source_cutoff_at, excluded.source_cutoff_at),
        overall_status = case when public.ai_operations_runs.overall_status = 'pending' then 'running'
                              else public.ai_operations_runs.overall_status end,
        updated_at = now()
  returning id into v_run_id;

  return v_run_id;
end;
$$;

create or replace function public.ai_ops_begin_module(
  p_run_id uuid,
  p_module public.ai_ops_module_enum,
  p_source_cutoff_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_id uuid;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant from public.ai_operations_runs where id = p_run_id;
  if v_tenant is null then
    raise exception 'Unknown AI Operations run.' using errcode = 'P0002';
  end if;

  insert into public.ai_operations_module_runs (run_id, tenant_id, module, status, started_at, source_cutoff_at)
  values (p_run_id, v_tenant, p_module, 'running', now(), p_source_cutoff_at)
  on conflict (run_id, module) do update
    set status = 'running',
        started_at = coalesce(public.ai_operations_module_runs.started_at, now()),
        error_code = null,
        error_summary = null,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.ai_ops_complete_module(
  p_module_run_id uuid,
  p_status public.ai_ops_run_status_enum,
  p_counts jsonb default '{}'::jsonb,
  p_coverage jsonb default '{}'::jsonb,
  p_model text default null,
  p_prompt_version text default null,
  p_error_code text default null,
  p_error_summary text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  update public.ai_operations_module_runs
     set status = p_status,
         completed_at = now(),
         source_items_total = coalesce((p_counts->>'sourceItemsTotal')::int, source_items_total),
         items_reused = coalesce((p_counts->>'itemsReused')::int, items_reused),
         items_analyzed = coalesce((p_counts->>'itemsAnalyzed')::int, items_analyzed),
         items_failed = coalesce((p_counts->>'itemsFailed')::int, items_failed),
         coverage = coalesce(p_coverage, coverage),
         model = coalesce(p_model, model),
         prompt_version = coalesce(p_prompt_version, prompt_version),
         error_code = p_error_code,
         error_summary = p_error_summary,
         updated_at = now()
   where id = p_module_run_id;
end;
$$;

create or replace function public.ai_ops_complete_run(
  p_run_id uuid,
  p_status public.ai_ops_run_status_enum default null,
  p_coverage_summary jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.ai_ops_run_status_enum := p_status;
  v_failed integer;
  v_total integer;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  select count(*) filter (where status in ('failed','partial')), count(*)
    into v_failed, v_total
  from public.ai_operations_module_runs where run_id = p_run_id;

  if v_status is null then
    v_status := case
      when v_total = 0 then 'failed'
      when v_failed = 0 then 'success'
      when v_failed = v_total then 'failed'
      else 'partial'
    end::public.ai_ops_run_status_enum;
  end if;

  update public.ai_operations_runs
     set overall_status = v_status,
         completed_at = now(),
         coverage_summary = coalesce(p_coverage_summary, coverage_summary),
         updated_at = now()
   where id = p_run_id;

  return jsonb_build_object('runId', p_run_id, 'status', v_status, 'modules', v_total, 'degraded', v_failed);
end;
$$;

create or replace function public.ai_ops_enqueue_work(
  p_tenant_id uuid,
  p_run_id uuid,
  p_module public.ai_ops_module_enum,
  p_work_key text,
  p_work_type text,
  p_input_payload jsonb,
  p_prompt_version text,
  p_schema_version text,
  p_priority integer default 100,
  p_model text default 'gemini-2.5-pro',
  p_input_snapshot_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_inserted boolean := false;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  insert into private.ai_ops_work_items (
    tenant_id, run_id, module, work_key, work_type, priority,
    input_snapshot_ids, input_payload, requested_model, prompt_version, schema_version
  ) values (
    p_tenant_id, p_run_id, p_module, p_work_key, p_work_type, coalesce(p_priority, 100),
    coalesce(p_input_snapshot_ids, '{}'::uuid[]), p_input_payload, coalesce(p_model, 'gemini-2.5-pro'),
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

  return jsonb_build_object('workItemId', v_id, 'inserted', v_inserted);
end;
$$;

create or replace function public.ai_ops_claim_work_items(p_limit integer default 4)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 4), 1), 20);
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  return coalesce((
    with claimed as (
      update private.ai_ops_work_items w
         set status = 'processing',
             attempt_count = w.attempt_count + 1,
             claimed_at = now(),
             updated_at = now()
       where w.id in (
         select id from private.ai_ops_work_items
          where status in ('queued','retry_wait')
            and next_attempt_at <= now()
          order by priority asc, next_attempt_at asc
          limit v_limit
          for update skip locked
       )
      returning w.*
    )
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'tenantId', c.tenant_id,
      'runId', c.run_id,
      'module', c.module,
      'workKey', c.work_key,
      'workType', c.work_type,
      'inputPayload', c.input_payload,
      'requestedModel', c.requested_model,
      'promptVersion', c.prompt_version,
      'schemaVersion', c.schema_version,
      'attemptCount', c.attempt_count
    ) order by c.priority, c.created_at)
    from claimed c
  ), '[]'::jsonb);
end;
$$;

create or replace function public.ai_ops_complete_work_item(
  p_work_item_id uuid,
  p_structured_result jsonb,
  p_token_usage jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  update private.ai_ops_work_items
     set status = 'completed',
         structured_result = p_structured_result,
         token_usage = coalesce(p_token_usage, '{}'::jsonb),
         completed_at = now(),
         error_code = null,
         error_summary = null,
         updated_at = now()
   where id = p_work_item_id;
end;
$$;

create or replace function public.ai_ops_fail_work_item(
  p_work_item_id uuid,
  p_error_code text,
  p_error_summary text,
  p_retryable boolean default true,
  p_max_attempts integer default 4
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
  v_status public.ai_ops_work_status_enum;
  v_next timestamptz;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  select attempt_count into v_attempts from private.ai_ops_work_items where id = p_work_item_id;
  if v_attempts is null then
    raise exception 'Unknown AI Operations work item.' using errcode = 'P0002';
  end if;

  if p_retryable and v_attempts < greatest(coalesce(p_max_attempts, 4), 1) then
    v_status := 'retry_wait';
    v_next := now() + make_interval(secs => least(power(2, v_attempts)::int * 30, 1800));
  else
    v_status := 'failed';
    v_next := now();
  end if;

  update private.ai_ops_work_items
     set status = v_status,
         next_attempt_at = v_next,
         error_code = p_error_code,
         error_summary = left(coalesce(p_error_summary, ''), 2000),
         completed_at = case when v_status = 'failed' then now() else null end,
         updated_at = now()
   where id = p_work_item_id;

  return jsonb_build_object('workItemId', p_work_item_id, 'status', v_status, 'nextAttemptAt', v_next);
end;
$$;

create or replace function public.ai_ops_upsert_finding(
  p_tenant_id uuid,
  p_run_id uuid,
  p_module public.ai_ops_module_enum,
  p_fingerprint text,
  p_title text,
  p_severity public.ai_ops_severity_enum,
  p_summary text default null,
  p_recommended_action text default null,
  p_entity_type text default null,
  p_entity_id text default null,
  p_confidence numeric default null,
  p_related_existing_exception_id uuid default null,
  p_evidence jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.ai_operations_findings;
  v_finding_id uuid;
  v_reopened boolean := false;
  v_evidence jsonb;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  select * into v_existing from public.ai_operations_findings
  where tenant_id = p_tenant_id and module = p_module and fingerprint = p_fingerprint
  for update;

  if v_existing.id is null then
    insert into public.ai_operations_findings (
      tenant_id, module, fingerprint, entity_type, entity_id, title, summary, severity,
      confidence, recommended_action, status, last_run_id, related_existing_exception_id
    ) values (
      p_tenant_id, p_module, p_fingerprint, p_entity_type, p_entity_id, p_title, p_summary, p_severity,
      p_confidence, p_recommended_action, 'open', p_run_id, p_related_existing_exception_id
    )
    returning id into v_finding_id;

    insert into public.ai_operations_finding_events (finding_id, tenant_id, event_type, actor_kind, new_value)
    values (v_finding_id, p_tenant_id, 'detected', 'system',
            jsonb_build_object('severity', p_severity, 'runId', p_run_id));
  else
    v_finding_id := v_existing.id;
    v_reopened := v_existing.status in ('resolved','dismissed')
      or (v_existing.status = 'snoozed' and coalesce(v_existing.snoozed_until, now()) <= now());

    update public.ai_operations_findings
       set title = p_title,
           summary = coalesce(p_summary, summary),
           severity = p_severity,
           confidence = coalesce(p_confidence, confidence),
           recommended_action = coalesce(p_recommended_action, recommended_action),
           entity_type = coalesce(p_entity_type, entity_type),
           entity_id = coalesce(p_entity_id, entity_id),
           related_existing_exception_id = coalesce(p_related_existing_exception_id, related_existing_exception_id),
           last_seen_at = now(),
           last_run_id = p_run_id,
           status = case when v_reopened then 'open'::public.ai_ops_finding_status_enum else status end,
           resolved_at = case when v_reopened then null else resolved_at end,
           dismissed_at = case when v_reopened then null else dismissed_at end,
           snoozed_until = case when v_reopened then null else snoozed_until end,
           reopen_count = reopen_count + case when v_reopened then 1 else 0 end,
           updated_at = now()
     where id = v_finding_id;

    insert into public.ai_operations_finding_events (finding_id, tenant_id, event_type, actor_kind, previous_value, new_value)
    values (v_finding_id, p_tenant_id,
            case when v_reopened then 'reopened' else 'reobserved' end, 'system',
            jsonb_build_object('status', v_existing.status, 'severity', v_existing.severity),
            jsonb_build_object('status', 'open', 'severity', p_severity, 'runId', p_run_id));
  end if;

  if p_evidence is not null and jsonb_typeof(p_evidence) = 'array' then
    for v_evidence in select value from jsonb_array_elements(p_evidence) loop
      insert into private.ai_ops_finding_evidence (
        finding_id, tenant_id, source_type, source_record_id, source_timestamp, excerpt, evidence_hash
      ) values (
        v_finding_id, p_tenant_id,
        coalesce(v_evidence->>'sourceType', 'unspecified'),
        v_evidence->>'sourceRecordId',
        nullif(v_evidence->>'sourceTimestamp','')::timestamptz,
        left(coalesce(v_evidence->>'excerpt',''), 1000),
        coalesce(v_evidence->>'evidenceHash', md5(coalesce(v_evidence::text,'')))
      );
    end loop;
  end if;

  return jsonb_build_object('findingId', v_finding_id, 'reopened', v_reopened);
end;
$$;

create or replace function public.ai_ops_autoresolve_findings(
  p_tenant_id uuid,
  p_module public.ai_ops_module_enum,
  p_run_id uuid,
  p_observed_fingerprints text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_row record;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  for v_row in
    select id, status from public.ai_operations_findings
    where tenant_id = p_tenant_id and module = p_module
      and status in ('open','snoozed')
      and not (fingerprint = any (coalesce(p_observed_fingerprints, '{}'::text[])))
  loop
    update public.ai_operations_findings
       set status = 'resolved', resolved_at = now(), snoozed_until = null,
           last_run_id = p_run_id, updated_at = now()
     where id = v_row.id;

    insert into public.ai_operations_finding_events (finding_id, tenant_id, event_type, actor_kind, previous_value, new_value, reason)
    values (v_row.id, p_tenant_id, 'auto_resolved', 'system',
            jsonb_build_object('status', v_row.status),
            jsonb_build_object('status', 'resolved', 'runId', p_run_id),
            'No longer detected by the module.');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Worker-only execution
revoke all on function public.ai_ops_begin_run(uuid, date, timestamptz, text) from public;
revoke all on function public.ai_ops_begin_module(uuid, public.ai_ops_module_enum, timestamptz) from public;
revoke all on function public.ai_ops_complete_module(uuid, public.ai_ops_run_status_enum, jsonb, jsonb, text, text, text, text) from public;
revoke all on function public.ai_ops_complete_run(uuid, public.ai_ops_run_status_enum, jsonb) from public;
revoke all on function public.ai_ops_enqueue_work(uuid, uuid, public.ai_ops_module_enum, text, text, jsonb, text, text, integer, text, uuid[]) from public;
revoke all on function public.ai_ops_claim_work_items(integer) from public;
revoke all on function public.ai_ops_complete_work_item(uuid, jsonb, jsonb) from public;
revoke all on function public.ai_ops_fail_work_item(uuid, text, text, boolean, integer) from public;
revoke all on function public.ai_ops_upsert_finding(uuid, uuid, public.ai_ops_module_enum, text, text, public.ai_ops_severity_enum, text, text, text, text, numeric, uuid, jsonb) from public;
revoke all on function public.ai_ops_autoresolve_findings(uuid, public.ai_ops_module_enum, uuid, text[]) from public;

grant execute on function public.ai_ops_begin_run(uuid, date, timestamptz, text) to service_role;
grant execute on function public.ai_ops_begin_module(uuid, public.ai_ops_module_enum, timestamptz) to service_role;
grant execute on function public.ai_ops_complete_module(uuid, public.ai_ops_run_status_enum, jsonb, jsonb, text, text, text, text) to service_role;
grant execute on function public.ai_ops_complete_run(uuid, public.ai_ops_run_status_enum, jsonb) to service_role;
grant execute on function public.ai_ops_enqueue_work(uuid, uuid, public.ai_ops_module_enum, text, text, jsonb, text, text, integer, text, uuid[]) to service_role;
grant execute on function public.ai_ops_claim_work_items(integer) to service_role;
grant execute on function public.ai_ops_complete_work_item(uuid, jsonb, jsonb) to service_role;
grant execute on function public.ai_ops_fail_work_item(uuid, text, text, boolean, integer) to service_role;
grant execute on function public.ai_ops_upsert_finding(uuid, uuid, public.ai_ops_module_enum, text, text, public.ai_ops_severity_enum, text, text, text, text, numeric, uuid, jsonb) to service_role;
grant execute on function public.ai_ops_autoresolve_findings(uuid, public.ai_ops_module_enum, uuid, text[]) to service_role;
