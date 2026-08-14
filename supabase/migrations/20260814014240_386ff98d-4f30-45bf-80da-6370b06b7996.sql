-- Beyond The Yellow automated prospect discovery: foundation
set local search_path = '';

-- 1. Canonical headquarters state on organizations -------------------------
alter table public.relationship_organizations
  add column if not exists headquarters_state text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'relationship_organizations_headquarters_state_check'
  ) then
    alter table public.relationship_organizations
      add constraint relationship_organizations_headquarters_state_check
      check (headquarters_state is null or headquarters_state = any (array[
        'AL','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
        'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI',
        'SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','AK'
      ]));
  end if;
end $$;

create index if not exists relationship_organizations_headquarters_state_idx
  on public.relationship_organizations (tenant_id, headquarters_state)
  where headquarters_state is not null;

comment on column public.relationship_organizations.headquarters_state
  is 'Two-letter US postal abbreviation for the organization headquarters state. Never inferred from partial metadata.';

-- 2. Independent donor potential role -------------------------------------
insert into public.relationship_role_catalog (code, label, applies_to, outreach_lane, description, is_active)
values (
  'donor_potential',
  'Donor potential',
  'organization',
  'partnership_support',
  'Organization identified as a potential ValorWell donor or funding relationship.',
  true
)
on conflict (code) do update
  set label = excluded.label,
      applies_to = excluded.applies_to,
      outreach_lane = excluded.outreach_lane,
      description = excluded.description,
      is_active = true;

-- 3. Normalization helpers ------------------------------------------------
create or replace function public.bty_normalize_domain(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(trim(p_value), '')), '^https?://', ''),
        '^www\.', ''
      ),
      '(/.*)?$', ''
    ),
    ''
  );
$$;

create or replace function public.bty_normalize_youtube_url(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  with cleaned as (
    select regexp_replace(
             regexp_replace(
               regexp_replace(lower(coalesce(trim(p_value), '')), '^https?://', ''),
               '^(www\.|m\.)', ''
             ),
             '/+$', ''
           ) as value
  )
  select nullif(
    case
      when value ~ '^youtube\.com/channel/' then 'channel:' || regexp_replace(split_part(value, '/', 3), '\?.*$', '')
      when value ~ '^youtube\.com/@' then 'handle:' || regexp_replace(replace(split_part(value, '/', 2), '@', ''), '\?.*$', '')
      when value ~ '^youtube\.com/(c|user)/' then 'handle:' || regexp_replace(split_part(value, '/', 3), '\?.*$', '')
      when value = '' then ''
      else 'url:' || regexp_replace(value, '\?.*$', '')
    end,
    ''
  )
  from cleaned;
$$;

create or replace function public.bty_normalize_org_name(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(coalesce(trim(p_value), '')), '[^a-z0-9]+', ' ', 'g'),
      '^(the)\s+|\s+(inc|llc|incorporated|corp|corporation|foundation|org)$', '', 'g'
    ),
    ''
  );
$$;

create index if not exists relationship_organizations_normalized_domain_idx
  on public.relationship_organizations (tenant_id, public.bty_normalize_domain(website))
  where website is not null;

create index if not exists relationship_organizations_normalized_name_idx
  on public.relationship_organizations (tenant_id, public.bty_normalize_org_name(name));

create index if not exists relationship_social_profiles_normalized_youtube_idx
  on public.relationship_social_profiles (tenant_id, public.bty_normalize_youtube_url(profile_url))
  where platform_name = 'youtube';

-- 4. Rotation -------------------------------------------------------------
create or replace function public.bty_rotation_states()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'AL','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
    'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI',
    'SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
  ]::text[];
$$;

create or replace function public.bty_next_rotation_state(p_state text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_states text[] := public.bty_rotation_states();
  v_index int;
begin
  v_index := array_position(v_states, upper(coalesce(trim(p_state), '')));
  if v_index is null then
    return v_states[1];
  end if;
  if v_index >= array_length(v_states, 1) then
    return v_states[1];
  end if;
  return v_states[v_index + 1];
end;
$$;

revoke all on function public.bty_rotation_states() from public;
revoke all on function public.bty_next_rotation_state(text) from public;
grant execute on function public.bty_rotation_states() to authenticated, service_role;
grant execute on function public.bty_next_rotation_state(text) to authenticated, service_role;

-- 5. Internal automation tables -------------------------------------------
create table if not exists private.bty_discovery_state (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  current_state text not null default 'AL',
  last_successful_state text,
  next_state text not null default 'AZ',
  last_successful_business_date date,
  updated_at timestamptz not null default now()
);

create table if not exists private.bty_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  business_date date not null,
  target_state text not null,
  model text not null,
  status text not null default 'pending'
    check (status = any (array['pending','running','success','failed'])),
  current_attempt int not null default 1,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  organizations_created_count int not null default 0,
  organization_ids uuid[] not null default array[]::uuid[],
  subscriber_range_tier_used int,
  error_summary jsonb not null default '{}'::jsonb,
  attempt_log jsonb not null default '[]'::jsonb,
  notification_sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (tenant_id, business_date)
);

create unique index if not exists bty_discovery_runs_single_success_idx
  on private.bty_discovery_runs (tenant_id, business_date)
  where status = 'success';

create table if not exists private.bty_discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references private.bty_discovery_runs(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  attempt int not null default 1,
  normalized_name text not null,
  organization_name text not null,
  verdict text not null check (verdict = any (array['accepted','rejected'])),
  rejection_reason text,
  subscriber_range_tier int,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, normalized_name)
);

create index if not exists bty_discovery_candidates_run_idx
  on private.bty_discovery_candidates (run_id, verdict);

create table if not exists private.bty_contact_enrichment_runs (
  id uuid primary key default gen_random_uuid(),
  discovery_run_id uuid not null references private.bty_discovery_runs(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  organization_id uuid not null references public.relationship_organizations(id) on delete cascade,
  status text not null default 'pending'
    check (status = any (array['pending','running','success','no_verified_contact','failed'])),
  contact_id uuid references public.relationship_contacts(id) on delete set null,
  model text,
  confidence numeric,
  error_summary jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (discovery_run_id, organization_id)
);

create index if not exists bty_contact_enrichment_runs_org_idx
  on private.bty_contact_enrichment_runs (organization_id);
create index if not exists bty_contact_enrichment_runs_contact_idx
  on private.bty_contact_enrichment_runs (contact_id);
create index if not exists bty_discovery_runs_tenant_status_idx
  on private.bty_discovery_runs (tenant_id, business_date desc);

insert into private.bty_discovery_state (tenant_id, current_state, next_state)
select t.id, 'AL', 'AZ' from public.tenants t
on conflict (tenant_id) do nothing;

-- 6. Service-role automation RPCs ----------------------------------------
create or replace function public.bty_claim_discovery_run(
  p_tenant_id uuid,
  p_business_date date,
  p_attempt int,
  p_model text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state private.bty_discovery_state;
  v_run private.bty_discovery_runs;
begin
  insert into private.bty_discovery_state (tenant_id, current_state, next_state)
  values (p_tenant_id, 'AL', public.bty_next_rotation_state('AL'))
  on conflict (tenant_id) do nothing;

  select * into v_state from private.bty_discovery_state where tenant_id = p_tenant_id for update;

  insert into private.bty_discovery_runs (tenant_id, business_date, target_state, model, status, current_attempt)
  values (p_tenant_id, p_business_date, v_state.current_state, p_model, 'running', greatest(coalesce(p_attempt, 1), 1))
  on conflict (tenant_id, business_date) do nothing;

  select * into v_run
    from private.bty_discovery_runs
   where tenant_id = p_tenant_id and business_date = p_business_date
     for update;

  if v_run.status = 'success' then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'already_successful',
      'runId', v_run.id,
      'status', v_run.status,
      'targetState', v_run.target_state,
      'organizationIds', to_jsonb(v_run.organization_ids)
    );
  end if;

  update private.bty_discovery_runs
     set status = 'running',
         current_attempt = greatest(current_attempt, greatest(coalesce(p_attempt, 1), 1)),
         model = p_model,
         updated_at = now(),
         attempt_log = attempt_log || jsonb_build_array(jsonb_build_object(
           'attempt', greatest(coalesce(p_attempt, 1), 1),
           'startedAt', now()
         ))
   where id = v_run.id
   returning * into v_run;

  return jsonb_build_object(
    'claimed', true,
    'runId', v_run.id,
    'status', v_run.status,
    'attempt', v_run.current_attempt,
    'businessDate', v_run.business_date,
    'targetState', v_run.target_state
  );
end;
$$;

create or replace function public.bty_discovery_exclusions(
  p_tenant_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target text;
begin
  select target_state into v_target from private.bty_discovery_runs where id = p_run_id;

  return jsonb_build_object(
    'targetState', v_target,
    'stateOrganizations', coalesce((
      select jsonb_agg(o.name order by o.name)
      from public.relationship_organizations o
      where o.tenant_id = p_tenant_id
        and (o.headquarters_state = v_target or o.metadata->>'target_state' = v_target)
    ), '[]'::jsonb),
    'allOrganizationNames', coalesce((
      select jsonb_agg(o.name order by o.name)
      from public.relationship_organizations o
      where o.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'rejectedThisRun', coalesce((
      select jsonb_agg(c.organization_name order by c.organization_name)
      from private.bty_discovery_candidates c
      where c.run_id = p_run_id and c.verdict = 'rejected'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.bty_screen_organization_candidates(
  p_tenant_id uuid,
  p_run_id uuid,
  p_candidates jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_candidate jsonb;
  v_results jsonb := '[]'::jsonb;
  v_name text;
  v_norm_name text;
  v_domain text;
  v_youtube text;
  v_state text;
  v_match uuid;
  v_reason text;
begin
  for v_candidate in select value from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) loop
    v_name := nullif(trim(v_candidate->>'organization_name'), '');
    v_norm_name := public.bty_normalize_org_name(v_name);
    v_domain := public.bty_normalize_domain(v_candidate->>'website_url');
    v_youtube := public.bty_normalize_youtube_url(v_candidate->>'youtube_channel_url');
    v_state := upper(nullif(trim(v_candidate->>'headquarters_state'), ''));
    v_match := null;
    v_reason := null;

    if v_norm_name is null then
      v_reason := 'missing_name';
    end if;

    if v_reason is null and v_domain is not null then
      select o.id into v_match
        from public.relationship_organizations o
       where o.tenant_id = p_tenant_id
         and public.bty_normalize_domain(o.website) = v_domain
       limit 1;
      if v_match is not null then v_reason := 'duplicate_website_domain'; end if;
    end if;

    if v_reason is null and v_youtube is not null then
      select s.organization_id into v_match
        from public.relationship_social_profiles s
       where s.tenant_id = p_tenant_id
         and s.platform_name = 'youtube'
         and s.organization_id is not null
         and public.bty_normalize_youtube_url(s.profile_url) = v_youtube
       limit 1;
      if v_match is not null then v_reason := 'duplicate_youtube_channel'; end if;
    end if;

    if v_reason is null then
      select o.id into v_match
        from public.relationship_organizations o
       where o.tenant_id = p_tenant_id
         and public.bty_normalize_org_name(o.name) = v_norm_name
       limit 1;
      if v_match is not null then v_reason := 'duplicate_organization_name'; end if;
    end if;

    if v_reason is null and v_state is not null then
      select o.id into v_match
        from public.relationship_organizations o
       where o.tenant_id = p_tenant_id
         and o.headquarters_state = v_state
         and public.bty_normalize_org_name(o.name) = v_norm_name
       limit 1;
      if v_match is not null then v_reason := 'duplicate_name_and_state'; end if;
    end if;

    if v_reason is null and p_run_id is not null then
      if exists (
        select 1 from private.bty_discovery_candidates c
        where c.run_id = p_run_id and c.normalized_name = v_norm_name
      ) then
        v_reason := 'already_evaluated_this_run';
      end if;
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'organizationName', v_name,
      'normalizedName', v_norm_name,
      'normalizedDomain', v_domain,
      'normalizedYoutube', v_youtube,
      'duplicate', v_reason is not null,
      'reason', v_reason,
      'matchedOrganizationId', v_match
    ));
  end loop;

  return v_results;
end;
$$;

create or replace function public.bty_record_candidate_verdicts(
  p_run_id uuid,
  p_verdicts jsonb
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run private.bty_discovery_runs;
  v_row jsonb;
  v_count int := 0;
  v_norm text;
begin
  select * into v_run from private.bty_discovery_runs where id = p_run_id;
  if v_run.id is null then
    raise exception 'Unknown BTY discovery run %', p_run_id;
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_verdicts, '[]'::jsonb)) loop
    v_norm := public.bty_normalize_org_name(v_row->>'organization_name');
    if v_norm is null then continue; end if;
    insert into private.bty_discovery_candidates (
      run_id, tenant_id, attempt, normalized_name, organization_name,
      verdict, rejection_reason, subscriber_range_tier, payload
    )
    values (
      p_run_id, v_run.tenant_id, v_run.current_attempt, v_norm,
      coalesce(v_row->>'organization_name', v_norm),
      coalesce(v_row->>'verdict', 'rejected'),
      nullif(v_row->>'reason', ''),
      nullif(v_row->>'subscriber_range_tier', '')::int,
      coalesce(v_row->'payload', '{}'::jsonb)
    )
    on conflict (run_id, normalized_name) do nothing;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.bty_commit_discovery_batch(
  p_run_id uuid,
  p_candidates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run private.bty_discovery_runs;
  v_state private.bty_discovery_state;
  v_candidate jsonb;
  v_org_id uuid;
  v_org_ids uuid[] := array[]::uuid[];
  v_count int;
  v_tier int := 1;
  v_next text;
begin
  select * into v_run from private.bty_discovery_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'Unknown BTY discovery run %', p_run_id;
  end if;
  if v_run.status = 'success' then
    return jsonb_build_object('committed', false, 'reason', 'already_successful',
      'organizationIds', to_jsonb(v_run.organization_ids));
  end if;

  v_count := jsonb_array_length(coalesce(p_candidates, '[]'::jsonb));
  if v_count <> 5 then
    raise exception 'BTY discovery requires exactly five validated organizations, received %', v_count;
  end if;

  select * into v_state from private.bty_discovery_state where tenant_id = v_run.tenant_id for update;

  for v_candidate in select value from jsonb_array_elements(p_candidates) loop
    if upper(coalesce(v_candidate->>'headquarters_state','')) <> v_run.target_state then
      raise exception 'Candidate % is not headquartered in %', v_candidate->>'organization_name', v_run.target_state;
    end if;

    if exists (
      select 1 from public.relationship_organizations o
      where o.tenant_id = v_run.tenant_id
        and (
          public.bty_normalize_org_name(o.name) = public.bty_normalize_org_name(v_candidate->>'organization_name')
          or (
            public.bty_normalize_domain(o.website) is not null
            and public.bty_normalize_domain(o.website) = public.bty_normalize_domain(v_candidate->>'website_url')
          )
        )
    ) then
      raise exception 'Candidate % already exists in the CRM', v_candidate->>'organization_name';
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
      'bty_discovery:' || v_run.id::text || ':' || public.bty_normalize_org_name(v_candidate->>'organization_name'),
      jsonb_strip_nulls(jsonb_build_object(
        'initiative', 'Beyond The Yellow',
        'discovery_run_id', v_run.id,
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
      jsonb_build_object('discovery_run_id', v_run.id, 'model', v_run.model)
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
        'bty_discovery:' || v_run.id::text || ':' || public.bty_normalize_youtube_url(v_candidate->>'youtube_channel_url'),
        jsonb_strip_nulls(jsonb_build_object(
          'discovery_run_id', v_run.id,
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
      v_run.id, v_run.tenant_id, v_run.current_attempt,
      public.bty_normalize_org_name(v_candidate->>'organization_name'),
      trim(v_candidate->>'organization_name'), 'accepted',
      nullif(v_candidate->>'subscriber_range_tier', '')::int,
      v_candidate
    )
    on conflict (run_id, normalized_name) do update
      set verdict = 'accepted', payload = excluded.payload;
  end loop;

  v_next := public.bty_next_rotation_state(v_run.target_state);

  update private.bty_discovery_runs
     set status = 'success',
         completed_at = now(),
         updated_at = now(),
         organizations_created_count = 5,
         organization_ids = v_org_ids,
         subscriber_range_tier_used = v_tier,
         error_summary = '{}'::jsonb
   where id = v_run.id;

  update private.bty_discovery_state
     set current_state = v_next,
         last_successful_state = v_run.target_state,
         next_state = public.bty_next_rotation_state(v_next),
         last_successful_business_date = v_run.business_date,
         updated_at = now()
   where tenant_id = v_run.tenant_id;

  return jsonb_build_object(
    'committed', true,
    'runId', v_run.id,
    'organizationIds', to_jsonb(v_org_ids),
    'subscriberRangeTierUsed', v_tier,
    'advancedState', v_next
  );
end;
$$;

create or replace function public.bty_mark_run_failed(
  p_run_id uuid,
  p_attempt int,
  p_error jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run private.bty_discovery_runs;
begin
  select * into v_run from private.bty_discovery_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'Unknown BTY discovery run %', p_run_id;
  end if;
  if v_run.status = 'success' then
    return jsonb_build_object('updated', false, 'reason', 'already_successful');
  end if;

  update private.bty_discovery_runs
     set status = case when coalesce(p_attempt, v_run.current_attempt) >= 3 then 'failed' else 'pending' end,
         current_attempt = greatest(current_attempt, coalesce(p_attempt, current_attempt)),
         completed_at = case when coalesce(p_attempt, v_run.current_attempt) >= 3 then now() else null end,
         error_summary = coalesce(p_error, '{}'::jsonb),
         attempt_log = attempt_log || jsonb_build_array(jsonb_build_object(
           'attempt', coalesce(p_attempt, v_run.current_attempt),
           'failedAt', now(),
           'error', coalesce(p_error, '{}'::jsonb)
         )),
         updated_at = now()
   where id = v_run.id
   returning * into v_run;

  return jsonb_build_object('updated', true, 'status', v_run.status, 'attempt', v_run.current_attempt);
end;
$$;

create or replace function public.bty_claim_failure_notification(p_run_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed boolean := false;
begin
  update private.bty_discovery_runs
     set notification_sent_at = now(), updated_at = now()
   where id = p_run_id
     and status = 'failed'
     and notification_sent_at is null
   returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;

create or replace function public.bty_discovery_run_snapshot(
  p_tenant_id uuid,
  p_business_date date
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_build_object(
    'runId', r.id,
    'status', r.status,
    'attempt', r.current_attempt,
    'targetState', r.target_state,
    'businessDate', r.business_date,
    'organizationIds', to_jsonb(r.organization_ids),
    'notificationSentAt', r.notification_sent_at,
    'errorSummary', r.error_summary,
    'attemptLog', r.attempt_log,
    'model', r.model
  ), '{}'::jsonb)
  from private.bty_discovery_runs r
  where r.tenant_id = p_tenant_id and r.business_date = p_business_date;
$$;

-- 7. Staff-visible read model --------------------------------------------
create or replace function public.bty_automation_overview(p_limit int default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_orchestration_context(false);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_limit int := least(greatest(coalesce(p_limit, 10), 1), 60);
begin
  return jsonb_build_object(
    'state', coalesce((
      select jsonb_build_object(
        'currentState', s.current_state,
        'nextState', s.next_state,
        'lastSuccessfulState', s.last_successful_state,
        'lastSuccessfulBusinessDate', s.last_successful_business_date,
        'updatedAt', s.updated_at
      )
      from private.bty_discovery_state s where s.tenant_id = v_tenant
    ), '{}'::jsonb),
    'runs', coalesce((
      select jsonb_agg(run order by run->>'businessDate' desc)
      from (
        select jsonb_build_object(
          'runId', r.id,
          'businessDate', r.business_date,
          'targetState', r.target_state,
          'status', r.status,
          'attempt', r.current_attempt,
          'model', r.model,
          'organizationsCreatedCount', r.organizations_created_count,
          'subscriberRangeTierUsed', r.subscriber_range_tier_used,
          'startedAt', r.started_at,
          'completedAt', r.completed_at,
          'notificationSentAt', r.notification_sent_at,
          'errorSummary', r.error_summary,
          'organizations', coalesce((
            select jsonb_agg(jsonb_build_object(
              'organizationId', o.id,
              'name', o.name,
              'website', o.website,
              'headquartersState', o.headquarters_state,
              'subscriberCount', (
                select sp.follower_count from public.relationship_social_profiles sp
                where sp.organization_id = o.id and sp.platform_name = 'youtube' limit 1
              ),
              'youtubeUrl', (
                select sp.profile_url from public.relationship_social_profiles sp
                where sp.organization_id = o.id and sp.platform_name = 'youtube' limit 1
              ),
              'enrichmentStatus', (
                select e.status from private.bty_contact_enrichment_runs e
                where e.discovery_run_id = r.id and e.organization_id = o.id
              ),
              'enrichmentContactId', (
                select e.contact_id from private.bty_contact_enrichment_runs e
                where e.discovery_run_id = r.id and e.organization_id = o.id
              )
            ) order by o.name)
            from public.relationship_organizations o
            where o.id = any (r.organization_ids)
          ), '[]'::jsonb)
        ) as run
        from private.bty_discovery_runs r
        where r.tenant_id = v_tenant
        order by r.business_date desc
        limit v_limit
      ) ordered
    ), '[]'::jsonb)
  );
end;
$$;

-- 8. Grants --------------------------------------------------------------
revoke all on function public.bty_claim_discovery_run(uuid,date,int,text) from public, anon, authenticated;
revoke all on function public.bty_discovery_exclusions(uuid,uuid) from public, anon, authenticated;
revoke all on function public.bty_screen_organization_candidates(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.bty_record_candidate_verdicts(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.bty_commit_discovery_batch(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.bty_mark_run_failed(uuid,int,jsonb) from public, anon, authenticated;
revoke all on function public.bty_claim_failure_notification(uuid) from public, anon, authenticated;
revoke all on function public.bty_discovery_run_snapshot(uuid,date) from public, anon, authenticated;
revoke all on function public.bty_automation_overview(int) from public, anon;

grant execute on function public.bty_claim_discovery_run(uuid,date,int,text) to service_role;
grant execute on function public.bty_discovery_exclusions(uuid,uuid) to service_role;
grant execute on function public.bty_screen_organization_candidates(uuid,uuid,jsonb) to service_role;
grant execute on function public.bty_record_candidate_verdicts(uuid,jsonb) to service_role;
grant execute on function public.bty_commit_discovery_batch(uuid,jsonb) to service_role;
grant execute on function public.bty_mark_run_failed(uuid,int,jsonb) to service_role;
grant execute on function public.bty_claim_failure_notification(uuid) to service_role;
grant execute on function public.bty_discovery_run_snapshot(uuid,date) to service_role;
grant execute on function public.bty_automation_overview(int) to authenticated, service_role;

comment on function public.bty_commit_discovery_batch(uuid,jsonb)
  is 'Atomically persists exactly five validated BTY organizations, roles, YouTube profiles, provenance, and advances the state rotation.';
comment on function public.bty_automation_overview(int)
  is 'Read-only BTY automation projection for CRM staff dashboards.';
