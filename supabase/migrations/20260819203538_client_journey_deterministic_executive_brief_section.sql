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
  v_model text;
  v_prompt_version text;
  v_settings_model text;
  v_brief_status text;
  v_publication text;
  v_client_journey jsonb;
  v_client_journey_section jsonb;
  v_sections jsonb;
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
  v_prompt_version := coalesce(v_prompt_version, '3');

  select count(*) filter (where status in ('failed','partial','running','pending')) into v_degraded
  from public.ai_operations_module_runs
  where run_id = p_run_id and module <> 'executive_brief';

  select coalesce(jsonb_agg(jsonb_build_object('module', module, 'status', status, 'errorCode', error_code)), '[]'::jsonb)
    into v_gaps
  from public.ai_operations_module_runs
  where run_id = p_run_id and module <> 'executive_brief'
    and status in ('failed','partial','running','pending');

  select coalesce(m.coverage,'{}'::jsonb) into v_client_journey
  from public.ai_operations_module_runs m
  where m.run_id=p_run_id and m.module='client_journey'
  limit 1;

  if coalesce(v_client_journey,'{}'::jsonb) ? 'clientsChecked' then
    v_client_journey_section := jsonb_build_object(
      'key','client_journey',
      'heading','Client Journey',
      'body',format(
        '%s clients checked · %s no model this run · %s Gemini candidates · %s Gemini batches · %s AI reviewed · %s active exceptions · %s new today · %s overdue · %s AI escalated%s',
        coalesce(v_client_journey->>'clientsChecked','0'),
        coalesce(v_client_journey->>'noModelThisRun','0'),
        coalesce(v_client_journey->>'geminiCandidates','0'),
        coalesce(v_client_journey->>'geminiBatches','0'),
        coalesce(v_client_journey->>'geminiReviewed','0'),
        coalesce(v_client_journey->>'activeExceptions','0'),
        coalesce(v_client_journey->>'newExceptionsToday','0'),
        coalesce(v_client_journey->>'overdueExceptions','0'),
        coalesce(v_client_journey->>'aiEscalatedExceptions','0'),
        case
          when coalesce((v_client_journey->>'geminiFailed')::int,0) > 0
            or coalesce((v_client_journey->>'geminiPending')::int,0) > 0
          then format(
            ' · %s AI failed · %s AI pending',
            coalesce(v_client_journey->>'geminiFailed','0'),
            coalesce(v_client_journey->>'geminiPending','0')
          )
          else ''
        end
      ),
      'itemCount',coalesce((v_client_journey->>'activeExceptions')::int,0),
      'metrics',v_client_journey
    );
  else
    v_client_journey_section := null;
  end if;

  select coalesce(jsonb_agg(section), '[]'::jsonb) into v_sections
  from jsonb_array_elements(coalesce(v_result->'sections','[]'::jsonb)) section
  where section->>'key' is distinct from 'client_journey';

  if v_client_journey_section is not null then
    v_sections := jsonb_build_array(v_client_journey_section) || coalesce(v_sections,'[]'::jsonb);
  end if;

  v_is_partial := coalesce(v_degraded, 0) > 0 or v_result is null;
  v_brief_status := case when v_result is null then 'partial' else 'published' end;

  insert into public.ai_operations_briefs (
    run_id, tenant_id, business_date, is_partial, status, sections, coverage_manifest,
    everything_normal, generated_at, model, prompt_version
  ) values (
    p_run_id, p_tenant_id, v_business_date, v_is_partial, v_brief_status,
    coalesce(v_sections, '[]'::jsonb),
    jsonb_build_object(
      'gaps', v_gaps,
      'modelResultAvailable', v_result is not null,
      'clientJourney', coalesce(v_client_journey,'{}'::jsonb)
    ),
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

  v_publication := case when v_is_partial then 'published_partial' else 'published' end;
  update public.ai_operations_runs
     set publication_status = v_publication, updated_at = now()
   where id = p_run_id and coalesce(publication_status, '') <> v_publication;

  return jsonb_build_object(
    'status', v_brief_status,
    'briefId', v_brief_id,
    'isPartial', v_is_partial,
    'publicationStatus', v_publication,
    'model', v_model,
    'promptVersion', v_prompt_version,
    'gaps', v_gaps,
    'clientJourney', coalesce(v_client_journey,'{}'::jsonb)
  );
end;
$function$;
