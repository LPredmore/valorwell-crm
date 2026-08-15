alter table private.bty_discovery_runs
  add column if not exists passes_completed integer not null default 0;

create or replace function public.bty_claim_discovery_pass(
  p_tenant_id uuid,
  p_business_date date,
  p_pass integer,
  p_model text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_state private.bty_discovery_state;
  v_run private.bty_discovery_runs;
  v_pass int := greatest(coalesce(p_pass, 1), 1);
begin
  insert into private.bty_discovery_state (tenant_id, current_state, next_state)
  values (p_tenant_id, 'AL', public.bty_next_rotation_state('AL'))
  on conflict (tenant_id) do nothing;

  select * into v_state from private.bty_discovery_state where tenant_id = p_tenant_id for update;

  insert into private.bty_discovery_runs (tenant_id, business_date, target_state, model, status, current_attempt)
  values (p_tenant_id, p_business_date, v_state.current_state, p_model, 'running', v_pass)
  on conflict (tenant_id, business_date) do nothing;

  select * into v_run
    from private.bty_discovery_runs
   where tenant_id = p_tenant_id and business_date = p_business_date
     for update;

  if v_run.passes_completed >= v_pass then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'pass_already_completed',
      'runId', v_run.id,
      'status', v_run.status,
      'targetState', v_run.target_state,
      'passesCompleted', v_run.passes_completed
    );
  end if;

  update private.bty_discovery_runs
     set status = 'running',
         current_attempt = greatest(current_attempt, v_pass),
         model = p_model,
         updated_at = now(),
         attempt_log = attempt_log || jsonb_build_array(jsonb_build_object(
           'attempt', v_pass,
           'pass', v_pass,
           'startedAt', now()
         ))
   where id = v_run.id
   returning * into v_run;

  return jsonb_build_object(
    'claimed', true,
    'runId', v_run.id,
    'status', v_run.status,
    'pass', v_pass,
    'passesCompleted', v_run.passes_completed,
    'businessDate', v_run.business_date,
    'targetState', v_run.target_state
  );
end;
$function$;

create or replace function public.bty_commit_discovery_pass(
  p_run_id uuid,
  p_candidates jsonb,
  p_pass integer,
  p_advance_state boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_run private.bty_discovery_runs;
  v_candidate jsonb;
  v_org_id uuid;
  v_org_ids uuid[] := array[]::uuid[];
  v_skipped jsonb := '[]'::jsonb;
  v_pass int := greatest(coalesce(p_pass, 1), 1);
  v_tier int := 1;
  v_next text;
  v_total int;
  v_norm text;
begin
  select * into v_run from private.bty_discovery_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'Unknown BTY discovery run %', p_run_id;
  end if;

  for v_candidate in select value from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) loop
    v_norm := public.bty_normalize_org_name(v_candidate->>'organization_name');

    if v_norm is null
       or upper(coalesce(v_candidate->>'headquarters_state','')) <> v_run.target_state then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'organizationName', v_candidate->>'organization_name', 'reason', 'invalid_candidate'));
      continue;
    end if;

    -- Silent code-level/database-level duplicate discard.
    if exists (
      select 1 from public.relationship_organizations o
      where o.tenant_id = v_run.tenant_id
        and (
          public.bty_normalize_org_name(o.name) = v_norm
          or (
            public.bty_normalize_domain(o.website) is not null
            and public.bty_normalize_domain(o.website) = public.bty_normalize_domain(v_candidate->>'website_url')
          )
        )
    ) or exists (
      select 1 from public.relationship_social_profiles s
      where s.tenant_id = v_run.tenant_id
        and s.platform_name = 'youtube'
        and s.organization_id is not null
        and public.bty_normalize_youtube_url(s.profile_url) is not null
        and public.bty_normalize_youtube_url(s.profile_url)
            = public.bty_normalize_youtube_url(v_candidate->>'youtube_channel_url')
    ) then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'organizationName', v_candidate->>'organization_name', 'reason', 'duplicate_organization'));
      insert into private.bty_discovery_candidates (
        run_id, tenant_id, attempt, normalized_name, organization_name, verdict,
        subscriber_range_tier, payload
      )
      values (
        v_run.id, v_run.tenant_id, v_pass, v_norm,
        trim(v_candidate->>'organization_name'), 'rejected',
        nullif(v_candidate->>'subscriber_range_tier', '')::int, v_candidate
      )
      on conflict (run_id, normalized_name) do nothing;
      continue;
    end if;

    insert into public.relationship_organizations (
      tenant_id, name, website, organization_kind, veteran_affiliated,
      relationship_stage, outreach_status, headquarters_state, source, source_record_key, metadata
    )
    values (
      v_run.tenant_id,
      trim(v_candidate->>'organization_name'),
      nullif(trim(v_candidate->>'website_url'), ''),
      nullif(trim(v_candidate->>'organization_kind'), ''),
      true,
      'identified',
      'new',
      v_run.target_state,
      'bty_automated_research',
      'bty_discovery:' || v_run.id::text || ':' || v_pass::text || ':' || v_norm,
      jsonb_strip_nulls(jsonb_build_object(
        'initiative', 'Beyond The Yellow',
        'discovery_run_id', v_run.id,
        'discovery_pass', v_pass,
        'model', v_run.model,
        'research_timestamp', now(),
        'target_state', v_run.target_state,
        'headquarters_city', v_candidate->>'headquarters_city',
        'direct_services_summary', v_candidate->>'direct_services_summary',
        'bty_fit_summary', v_candidate->>'why_bty_candidate',
        'evidence_urls', v_candidate->'evidence_urls',
        'youtube_subscriber_count', v_candidate->'youtube_subscriber_count',
        'subscriber_count_source', v_candidate->>'subscriber_count_source',
        'subscriber_count_observed_at', v_candidate->>'subscriber_count_observed_at',
        'subscriber_range_tier', v_candidate->'subscriber_range_tier',
        'research_confidence', v_candidate->'confidence',
        'contact_research_status', 'pending'
      ))
    )
    returning id into v_org_id;

    v_org_ids := v_org_ids || v_org_id;
    v_tier := greatest(v_tier, coalesce((v_candidate->>'subscriber_range_tier')::int, 1));

    insert into public.relationship_organization_roles (tenant_id, organization_id, role_code, source, metadata)
    values (
      v_run.tenant_id, v_org_id, 'bty_nominee', 'bty_automated_research',
      jsonb_build_object('discovery_run_id', v_run.id, 'discovery_pass', v_pass, 'model', v_run.model)
    )
    on conflict (organization_id, role_code) do nothing;

    if nullif(trim(v_candidate->>'youtube_channel_url'), '') is not null then
      insert into public.relationship_social_profiles (
        tenant_id, organization_id, platform_name, handle, profile_url,
        follower_count, approved, source, source_record_key, metadata
      )
      values (
        v_run.tenant_id, v_org_id, 'youtube',
        nullif(trim(v_candidate->>'youtube_handle'), ''),
        trim(v_candidate->>'youtube_channel_url'),
        nullif(v_candidate->>'youtube_subscriber_count', '')::bigint,
        true,
        'bty_automated_research',
        'bty_discovery:' || v_run.id::text || ':' || v_pass::text || ':'
          || public.bty_normalize_youtube_url(v_candidate->>'youtube_channel_url'),
        jsonb_strip_nulls(jsonb_build_object(
          'discovery_run_id', v_run.id,
          'discovery_pass', v_pass,
          'model', v_run.model,
          'verified_at', v_candidate->>'subscriber_count_observed_at',
          'evidence_url', v_candidate->>'subscriber_count_source',
          'subscriber_range_tier', v_candidate->'subscriber_range_tier'
        ))
      );
    end if;

    insert into private.bty_discovery_candidates (
      run_id, tenant_id, attempt, normalized_name, organization_name, verdict,
      subscriber_range_tier, payload
    )
    values (
      v_run.id, v_run.tenant_id, v_pass, v_norm,
      trim(v_candidate->>'organization_name'), 'accepted',
      nullif(v_candidate->>'subscriber_range_tier', '')::int, v_candidate
    )
    on conflict (run_id, normalized_name) do update
      set verdict = 'accepted', payload = excluded.payload;
  end loop;

  update private.bty_discovery_runs
     set organization_ids = coalesce(organization_ids, array[]::uuid[]) || v_org_ids,
         organizations_created_count = coalesce(organizations_created_count, 0) + coalesce(array_length(v_org_ids, 1), 0),
         passes_completed = greatest(passes_completed, v_pass),
         subscriber_range_tier_used = greatest(coalesce(subscriber_range_tier_used, 1), v_tier),
         updated_at = now(),
         attempt_log = attempt_log || jsonb_build_array(jsonb_build_object(
           'attempt', v_pass,
           'pass', v_pass,
           'completedAt', now(),
           'created', coalesce(array_length(v_org_ids, 1), 0),
           'skipped', jsonb_array_length(v_skipped)
         ))
   where id = v_run.id
   returning * into v_run;

  v_total := coalesce(v_run.organizations_created_count, 0);

  if coalesce(p_advance_state, false) then
    if v_total > 0 then
      v_next := public.bty_next_rotation_state(v_run.target_state);
      update private.bty_discovery_runs
         set status = 'success', completed_at = now(), updated_at = now(), error_summary = '{}'::jsonb
       where id = v_run.id;
      update private.bty_discovery_state
         set current_state = v_next,
             last_successful_state = v_run.target_state,
             next_state = public.bty_next_rotation_state(v_next),
             last_successful_business_date = v_run.business_date,
             updated_at = now()
       where tenant_id = v_run.tenant_id;
    else
      update private.bty_discovery_runs
         set status = 'failed', completed_at = now(), updated_at = now(),
             error_summary = jsonb_build_object(
               'message', 'No qualifying organizations were validated for ' || v_run.target_state,
               'kind', 'no_qualifying_candidates',
               'candidatesValidated', 0)
       where id = v_run.id;
    end if;
  end if;

  return jsonb_build_object(
    'committed', true,
    'runId', v_run.id,
    'pass', v_pass,
    'createdThisPass', coalesce(array_length(v_org_ids, 1), 0),
    'organizationIds', to_jsonb(v_org_ids),
    'skipped', v_skipped,
    'totalCreated', v_total,
    'advancedState', v_next
  );
end;
$function$;

revoke all on function public.bty_claim_discovery_pass(uuid, date, integer, text) from public, anon, authenticated;
revoke all on function public.bty_commit_discovery_pass(uuid, jsonb, integer, boolean) from public, anon, authenticated;
grant execute on function public.bty_claim_discovery_pass(uuid, date, integer, text) to service_role;
grant execute on function public.bty_commit_discovery_pass(uuid, jsonb, integer, boolean) to service_role;