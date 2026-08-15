-- 1. Provider settings: Gemini Developer API only, no Vertex.
alter table public.ai_operations_settings
  drop column if exists vertex_project_id,
  drop column if exists vertex_location,
  add column if not exists provider text not null default 'gemini_developer_api';

alter table public.ai_operations_settings alter column model set default 'gemini-2.5-pro';
update public.ai_operations_settings set model = 'gemini-2.5-pro', provider = 'gemini_developer_api';

alter table public.ai_operations_module_runs
  add column if not exists provider text not null default 'gemini_developer_api';

-- 2. Finding upsert: absence is never proof of resolution; critical re-detection overrides a snooze.
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
      or (v_existing.status = 'snoozed' and coalesce(v_existing.snoozed_until, now()) <= now())
      or (v_existing.status = 'snoozed' and p_severity = 'critical');

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

    insert into public.ai_operations_finding_events (finding_id, tenant_id, event_type, actor_kind, previous_value, new_value, reason)
    values (v_finding_id, p_tenant_id,
            case when v_reopened then 'reopened' else 'reobserved' end, 'system',
            jsonb_build_object('status', v_existing.status, 'severity', v_existing.severity),
            jsonb_build_object('status', case when v_reopened then 'open' else v_existing.status end,
                              'severity', p_severity, 'runId', p_run_id),
            case
              when v_existing.status = 'snoozed' and p_severity = 'critical'
                then 'Severity escalated to critical while snoozed.'
              else null
            end);
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

-- 3. Reconciliation: only deterministic modules may self-resolve.
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
  v_deterministic boolean := (p_module = 'system_integrity');
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
    if v_deterministic then
      update public.ai_operations_findings
         set status = 'resolved', resolved_at = now(), snoozed_until = null,
             last_run_id = p_run_id, updated_at = now()
       where id = v_row.id;

      insert into public.ai_operations_finding_events (finding_id, tenant_id, event_type, actor_kind, previous_value, new_value, reason)
      values (v_row.id, p_tenant_id, 'deterministically_resolved', 'system',
              jsonb_build_object('status', v_row.status),
              jsonb_build_object('status', 'resolved', 'runId', p_run_id),
              'Deterministic evidence shows the underlying condition no longer exists.');
      v_count := v_count + 1;
    else
      insert into public.ai_operations_finding_events (finding_id, tenant_id, event_type, actor_kind, previous_value, new_value, reason)
      values (v_row.id, p_tenant_id, 'not_observed', 'system',
              jsonb_build_object('status', v_row.status),
              jsonb_build_object('status', v_row.status, 'runId', p_run_id),
              'Not returned by this analysis. Absence is not proof of resolution, so the finding stays open.');
    end if;
  end loop;

  return v_count;
end;
$$;

-- 4. Snooze expiry returns findings to the active queue.
create or replace function public.ai_ops_expire_snoozes(p_tenant_id uuid)
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
    select id from public.ai_operations_findings
    where tenant_id = p_tenant_id
      and status = 'snoozed'
      and snoozed_until is not null
      and snoozed_until <= now()
  loop
    update public.ai_operations_findings
       set status = 'open', snoozed_until = null, updated_at = now()
     where id = v_row.id;

    insert into public.ai_operations_finding_events (finding_id, tenant_id, event_type, actor_kind, previous_value, new_value, reason)
    values (v_row.id, p_tenant_id, 'snooze_expired', 'system',
            jsonb_build_object('status', 'snoozed'),
            jsonb_build_object('status', 'open'),
            'The snooze period ended.');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.ai_ops_expire_snoozes(uuid) from public;
grant execute on function public.ai_ops_expire_snoozes(uuid) to service_role;