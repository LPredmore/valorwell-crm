-- 1) YouTube batch builder: stop requesting a retired model; let the enqueue helper
--    resolve the authoritative model from ai_operations_settings.
CREATE OR REPLACE FUNCTION public.ai_ops_build_youtube_batches(p_tenant_id uuid, p_run_id uuid, p_batch_size integer DEFAULT 8, p_max_comments integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        '1', '1', 120, null, '{}'::uuid[]
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
      '1', '1', 120, null, '{}'::uuid[]
    );
    v_queued := v_queued + 1;
  end if;

  return jsonb_build_object('commentsQueued', v_total, 'batchesQueued', v_queued);
end;
$function$;

-- 2) Executive Brief ingestion: record real provenance from the completed work item,
--    falling back to the authoritative settings model. No hardcoded retired model.
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

  -- Partial briefs have no completed work item to inherit provenance from: describe the
  -- configuration that would have produced it.
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

  insert into public.ai_operations_briefs (
    run_id, tenant_id, business_date, is_partial, status, sections, coverage_manifest,
    everything_normal, generated_at, model, prompt_version
  ) values (
    p_run_id, p_tenant_id, v_business_date, v_is_partial,
    case when v_result is null then 'partial' else 'published' end,
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

  return jsonb_build_object(
    'status', case when v_result is null then 'partial' else 'published' end,
    'briefId', v_brief_id,
    'isPartial', v_is_partial,
    'model', v_model,
    'promptVersion', v_prompt_version,
    'gaps', v_gaps
  );
end;
$function$;

-- 3) Maintenance: drop ONLY unprocessed work items whose stored input payload predates the
--    current collector format, so they can be rebuilt from live production data.
--    Completed and failed history is never touched, and no source records are affected.
CREATE OR REPLACE FUNCTION public.ai_ops_purge_stale_work_items(p_tenant_id uuid, p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_deleted jsonb;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  with expected(work_type, prompt_version, requires_signals) as (
    values
      ('system_integrity_triage', '1', false),
      ('client_journey_review', '2', true),
      ('communications_qa_review', '2', true),
      ('youtube_comment_review', '1', false),
      ('executive_brief_synthesis', '2', false)
  ),
  stale as (
    select w.id, w.module, w.work_type
    from private.ai_ops_work_items w
    join expected e on e.work_type = w.work_type
    where w.tenant_id = p_tenant_id
      and w.run_id = p_run_id
      and w.status in ('queued','retry_wait','processing')
      and (
        w.prompt_version <> e.prompt_version
        or (e.requires_signals and not coalesce(w.input_payload->'entities'->0 ? 'derivedSignals', false))
      )
  ),
  removed as (
    delete from private.ai_ops_work_items w
    using stale s
    where w.id = s.id
    returning s.module, s.work_type
  )
  select coalesce(jsonb_object_agg(module, n), '{}'::jsonb)
    into v_deleted
  from (select module, count(*) as n from removed group by module) t;

  return jsonb_build_object('deletedByModule', v_deleted);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.ai_ops_purge_stale_work_items(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ai_ops_purge_stale_work_items(uuid, uuid) FROM anon, authenticated;
