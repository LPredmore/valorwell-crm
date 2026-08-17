-- 1. Discard the unfinished setup/test model backlog (unfinished states only).
delete from private.ai_ops_work_items
where status in ('queued','processing','retry_wait','failed')
  and run_id in ('5de4ae76-fcdb-4ed7-8956-9321edbfcfbd','e25347d0-737a-43be-afc9-cacbd434f4b6');

-- 2. Close out the stale module steps and runs using existing statuses only.
update public.ai_operations_module_runs
   set status = 'failed',
       error_code = coalesce(error_code, 'abandoned'),
       error_summary = coalesce(error_summary, 'Setup/test cycle abandoned; queued model work discarded during cleanup.'),
       completed_at = coalesce(completed_at, now()),
       updated_at = now()
 where run_id in ('5de4ae76-fcdb-4ed7-8956-9321edbfcfbd','e25347d0-737a-43be-afc9-cacbd434f4b6')
   and status in ('pending','running');

update public.ai_operations_runs r
   set overall_status = case
         when exists (select 1 from public.ai_operations_module_runs m where m.run_id = r.id and m.status = 'success')
           then 'partial'::public.ai_ops_run_status_enum
         else 'failed'::public.ai_ops_run_status_enum
       end,
       completed_at = coalesce(r.completed_at, now()),
       coverage_summary = coalesce(r.coverage_summary, '{}'::jsonb)
         || jsonb_build_object('abandoned', true, 'abandonedReason', 'Setup/test cycle; unfinished model work discarded during cleanup.'),
       updated_at = now()
 where r.id in ('5de4ae76-fcdb-4ed7-8956-9321edbfcfbd','e25347d0-737a-43be-afc9-cacbd434f4b6')
   and r.overall_status in ('pending','running');

-- 3. Make publication_status reflect the existing brief publication step, idempotently.
create or replace function public.ai_ops_ingest_executive_brief(p_tenant_id uuid, p_run_id uuid, p_force_partial boolean default false)
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
  v_model text;
  v_prompt_version text;
  v_settings_model text;
  v_brief_status text;
  v_publication text;
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
  v_prompt_version := coalesce(v_prompt_version, '2');

  select count(*) filter (where status in ('failed','partial','running','pending')) into v_degraded
  from public.ai_operations_module_runs
  where run_id = p_run_id and module <> 'executive_brief';

  select coalesce(jsonb_agg(jsonb_build_object('module', module, 'status', status, 'errorCode', error_code)), '[]'::jsonb)
    into v_gaps
  from public.ai_operations_module_runs
  where run_id = p_run_id and module <> 'executive_brief'
    and status in ('failed','partial','running','pending');

  v_is_partial := coalesce(v_degraded, 0) > 0 or v_result is null;
  v_brief_status := case when v_result is null then 'partial' else 'published' end;

  insert into public.ai_operations_briefs (
    run_id, tenant_id, business_date, is_partial, status, sections, coverage_manifest,
    everything_normal, generated_at, model, prompt_version
  ) values (
    p_run_id, p_tenant_id, v_business_date, v_is_partial, v_brief_status,
    coalesce(v_result->'sections', '[]'::jsonb),
    jsonb_build_object('gaps', v_gaps, 'modelResultAvailable', v_result is not null),
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

  -- Publication state belongs to the run: the daily output for this cycle has now been
  -- published (fully, or as a truthful partial when modules degraded). Idempotent: the
  -- same terminal value is rewritten on repeat calls.
  v_publication := case when v_is_partial then 'published_partial' else 'published' end;

  update public.ai_operations_runs
     set publication_status = v_publication,
         updated_at = now()
   where id = p_run_id
     and coalesce(publication_status, '') <> v_publication;

  return jsonb_build_object(
    'status', v_brief_status,
    'briefId', v_brief_id,
    'isPartial', v_is_partial,
    'publicationStatus', v_publication,
    'model', v_model,
    'promptVersion', v_prompt_version,
    'gaps', v_gaps
  );
end;
$function$;