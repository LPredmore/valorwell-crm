-- Keep the AI Operations operation registry aligned with current scheduler state.
-- Auto-discovered pg_cron rows are derived inventory and are removed when their
-- active source job no longer exists. Manually curated rows remain durable policy.

create or replace function public.ai_ops_sync_operation_registry(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_discovered integer := 0;
  v_total integer := 0;
  v_removed integer := 0;
  v_row record;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  for v_row in
    select j.jobname, j.schedule, j.active
    from cron.job j
    where j.active
  loop
    v_total := v_total + 1;

    insert into private.ai_ops_operation_registry as registry (
      tenant_id, operation_key, display_name, domain, source_type,
      expected_cadence, expected_cadence_seconds, evidence_source, auto_discovered
    ) values (
      p_tenant_id,
      'pg_cron:' || v_row.jobname,
      v_row.jobname,
      'scheduled_job',
      'pg_cron',
      v_row.schedule,
      private.ai_ops_cron_cadence_seconds(v_row.schedule),
      jsonb_build_object('type', 'pg_cron', 'jobname', v_row.jobname),
      true
    )
    on conflict (tenant_id, operation_key) do update
      set expected_cadence = excluded.expected_cadence,
          expected_cadence_seconds = excluded.expected_cadence_seconds,
          display_name = excluded.display_name,
          evidence_source = excluded.evidence_source,
          enabled = true,
          updated_at = now()
      where registry.auto_discovered = true;

    if found then
      v_discovered := v_discovered + 1;
    end if;
  end loop;

  delete from private.ai_ops_operation_registry as registry
  where registry.tenant_id = p_tenant_id
    and registry.source_type = 'pg_cron'
    and registry.auto_discovered = true
    and not exists (
      select 1
      from cron.job j
      where j.active
        and registry.operation_key = 'pg_cron:' || j.jobname
    );
  get diagnostics v_removed = row_count;

  return jsonb_build_object(
    'cronJobs', v_total,
    'registryRows', v_discovered,
    'removedStale', v_removed
  );
end;
$function$;

comment on function public.ai_ops_sync_operation_registry(uuid) is
  'Reconciles active pg_cron jobs into AI Ops. Auto-discovered rows are derived current inventory and are removed when their active cron source disappears; manually curated rows are preserved.';

create or replace function public.ai_ops_evaluate_system_integrity(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamp with time zone default now()
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row record;
  v_last record;
  v_window interval;
  v_status text;
  v_severity public.ai_ops_severity_enum;
  v_title text;
  v_summary text;
  v_fingerprint text;
  v_observed text[] := '{}'::text[];
  v_observations jsonb := '[]'::jsonb;
  v_healthy integer := 0;
  v_unknown integer := 0;
  v_failing integer := 0;
  v_evidence jsonb;
  v_registry_sync jsonb;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  -- Integrity evaluation owns inventory reconciliation so every caller evaluates
  -- current scheduler state without relying on dispatcher call ordering.
  v_registry_sync := public.ai_ops_sync_operation_registry(p_tenant_id);

  for v_row in
    select * from private.ai_ops_operation_registry
    where tenant_id = p_tenant_id and enabled
    order by operation_key
  loop
    v_window := make_interval(secs => greatest(
      coalesce(v_row.expected_cadence_seconds, 86400) * 2 + coalesce(v_row.allowed_delay_seconds, 900),
      600
    ));

    select d.status, d.start_time, d.end_time, d.return_message
      into v_last
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
    where j.jobname = coalesce(v_row.evidence_source->>'jobname', v_row.display_name)
      and d.start_time <= p_cutoff_at
    order by d.start_time desc
    limit 1;

    if v_row.expected_cadence_seconds is null then
      v_status := 'unknown';
    elsif v_last.start_time is null then
      v_status := 'never_ran';
    elsif v_last.start_time < p_cutoff_at - v_window then
      v_status := 'overdue';
    elsif coalesce(v_last.status, '') in ('failed', 'error') then
      v_status := 'failed';
    elsif coalesce(v_last.status, '') = 'succeeded' then
      v_status := 'healthy';
    else
      v_status := 'unknown';
    end if;

    v_observations := v_observations || jsonb_build_object(
      'operationKey', v_row.operation_key,
      'displayName', v_row.display_name,
      'expectedCadence', v_row.expected_cadence,
      'criticality', v_row.criticality,
      'status', v_status,
      'lastRunStatus', v_last.status,
      'lastRunAt', v_last.start_time
    );

    if v_status = 'healthy' then
      v_healthy := v_healthy + 1;
      continue;
    end if;

    if v_status = 'unknown' then
      v_unknown := v_unknown + 1;
    else
      v_failing := v_failing + 1;
    end if;

    v_severity := case v_status
      when 'failed' then v_row.criticality
      when 'never_ran' then 'high'
      when 'overdue' then v_row.criticality
      else 'low'
    end::public.ai_ops_severity_enum;

    v_title := case v_status
      when 'failed' then format('%s last run failed', v_row.display_name)
      when 'never_ran' then format('%s has no recorded execution', v_row.display_name)
      when 'overdue' then format('%s has not run on schedule', v_row.display_name)
      else format('%s cannot be verified', v_row.display_name)
    end;

    v_summary := case v_status
      when 'unknown' then 'UNKNOWN: monitoring evidence for this operation is insufficient to determine success.'
      else format('Expected cadence %s. Last run %s at %s.',
                  coalesce(v_row.expected_cadence, 'unknown'),
                  coalesce(v_last.status, 'never'),
                  coalesce(v_last.start_time::text, 'n/a'))
    end;

    v_fingerprint := 'operation:' || v_row.operation_key || ':' || v_status;
    v_observed := v_observed || v_fingerprint;

    v_evidence := jsonb_build_array(jsonb_build_object(
      'sourceType', 'pg_cron_run',
      'sourceRecordId', v_row.operation_key,
      'sourceTimestamp', v_last.start_time,
      'excerpt', left(coalesce(v_last.return_message, v_status), 800),
      'evidenceHash', md5(v_fingerprint || coalesce(v_last.start_time::text, ''))
    ));

    perform public.ai_ops_upsert_finding(
      p_tenant_id, p_run_id, 'system_integrity', v_fingerprint, v_title, v_severity,
      v_summary,
      case v_status
        when 'unknown' then 'Add an execution or downstream-invariant evidence source for this operation.'
        else 'Review the operation logs and confirm whether downstream work completed.'
      end,
      'operation', v_row.operation_key, null, null, v_evidence
    );
  end loop;

  for v_row in
    select * from private.ai_ops_operation_registry
    where tenant_id = p_tenant_id and enabled and auto_discovered
      and expected_cadence_seconds is null
  loop
    v_fingerprint := 'unreviewed_operation:' || v_row.operation_key;
    v_observed := v_observed || v_fingerprint;
    perform public.ai_ops_upsert_finding(
      p_tenant_id, p_run_id, 'system_integrity', v_fingerprint,
      format('%s is scheduled but not classified', v_row.display_name), 'low',
      'This scheduled job was auto-discovered and has no confirmed cadence or success rule, so its health is UNKNOWN.',
      'Classify the operation: confirm its cadence, criticality, and success evidence.',
      'operation', v_row.operation_key, null, null, '[]'::jsonb
    );
  end loop;

  perform public.ai_ops_autoresolve_findings(p_tenant_id, 'system_integrity', p_run_id, v_observed);

  return jsonb_build_object(
    'observations', v_observations,
    'healthy', v_healthy,
    'failing', v_failing,
    'unknown', v_unknown,
    'total', v_healthy + v_failing + v_unknown,
    'cutoffAt', p_cutoff_at,
    'registrySync', v_registry_sync
  );
end;
$function$;

comment on function public.ai_ops_evaluate_system_integrity(uuid, uuid, timestamp with time zone) is
  'Evaluates AI Ops system integrity against reconciled current operation inventory. The evaluator owns registry synchronization and deterministic finding autoresolution.';
