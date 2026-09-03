create table private.bty_nominee_research_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  business_date date not null,
  cycle_number integer not null check (cycle_number >= 1),
  state_index smallint not null check (state_index between 0 and 49),
  state_code text not null check (
    state_code = any (array[
      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
      'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
      'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
      'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
      'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
    ]::text[])
  ),
  attempt_number smallint not null check (attempt_number >= 1),
  status text not null default 'in_progress'
    check (status in ('in_progress','completed','failed')),
  considered_count integer not null default 0 check (considered_count >= 0),
  qualified_count smallint not null default 0 check (qualified_count between 0 and 5),
  inserted_count smallint not null default 0 check (inserted_count between 0 and 5),
  organization_ids uuid[] not null default '{}'::uuid[],
  search_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(search_summary) = 'object'),
  error_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(error_summary) = 'object'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, cycle_number, state_index, attempt_number),
  check (qualified_count <= considered_count),
  check (status <> 'completed' or inserted_count <= qualified_count),
  check ((status = 'completed' and completed_at is not null) or status <> 'completed')
);

alter table private.bty_nominee_research_runs enable row level security;

create unique index bty_nominee_research_runs_one_active_idx
  on private.bty_nominee_research_runs (tenant_id)
  where status = 'in_progress';

create unique index bty_nominee_research_runs_one_completed_state_idx
  on private.bty_nominee_research_runs (tenant_id, cycle_number, state_index)
  where status = 'completed';

create index bty_nominee_research_runs_history_idx
  on private.bty_nominee_research_runs
  (tenant_id, cycle_number desc, state_index desc, attempt_number desc);

revoke all on table private.bty_nominee_research_runs from public, anon, authenticated;

comment on table private.bty_nominee_research_runs is
  'Manual BTY nominee research rotation ledger. This table must not be used to restore retired autonomous discovery jobs.';

create or replace function private.start_bty_nominee_research_run(
  p_tenant_id uuid,
  p_business_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  state_codes constant text[] := array[
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
    'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
    'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
    'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
  ];
  state_names constant text[] := array[
    'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia',
    'Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland',
    'Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey',
    'New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina',
    'South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'
  ];
  run_row private.bty_nominee_research_runs%rowtype;
  last_cycle integer;
  last_state_index smallint;
  next_cycle integer := 1;
  next_state_index smallint := 0;
  next_attempt smallint;
  state_inserted integer := 0;
begin
  if p_tenant_id is null or p_business_date is null then
    raise exception 'tenant_id and business_date are required';
  end if;

  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'tenant not found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bty_nominee_research:' || p_tenant_id::text, 0)
  );

  select r.*
    into run_row
  from private.bty_nominee_research_runs r
  where r.tenant_id = p_tenant_id
    and r.business_date = p_business_date
    and r.status in ('in_progress', 'completed')
  order by r.created_at desc
  limit 1;

  if found then
    select coalesce(sum(r.inserted_count), 0)::integer
      into state_inserted
    from private.bty_nominee_research_runs r
    where r.tenant_id = run_row.tenant_id
      and r.cycle_number = run_row.cycle_number
      and r.state_index = run_row.state_index;

    return jsonb_build_object(
      'runId', run_row.id,
      'businessDate', run_row.business_date,
      'cycleNumber', run_row.cycle_number,
      'stateIndex', run_row.state_index,
      'stateCode', run_row.state_code,
      'stateName', state_names[run_row.state_index + 1],
      'attemptNumber', run_row.attempt_number,
      'status', run_row.status,
      'stateInsertedCount', state_inserted,
      'remainingCapacity', greatest(0, 5 - state_inserted),
      'replayed', true
    );
  end if;

  select r.*
    into run_row
  from private.bty_nominee_research_runs r
  where r.tenant_id = p_tenant_id
    and r.status = 'in_progress'
  order by r.started_at
  limit 1;

  if found then
    select coalesce(sum(r.inserted_count), 0)::integer
      into state_inserted
    from private.bty_nominee_research_runs r
    where r.tenant_id = run_row.tenant_id
      and r.cycle_number = run_row.cycle_number
      and r.state_index = run_row.state_index;

    return jsonb_build_object(
      'runId', run_row.id,
      'businessDate', run_row.business_date,
      'cycleNumber', run_row.cycle_number,
      'stateIndex', run_row.state_index,
      'stateCode', run_row.state_code,
      'stateName', state_names[run_row.state_index + 1],
      'attemptNumber', run_row.attempt_number,
      'status', run_row.status,
      'stateInsertedCount', state_inserted,
      'remainingCapacity', greatest(0, 5 - state_inserted),
      'replayed', true
    );
  end if;

  select r.cycle_number, r.state_index
    into last_cycle, last_state_index
  from private.bty_nominee_research_runs r
  where r.tenant_id = p_tenant_id
    and r.status = 'completed'
  order by r.cycle_number desc, r.state_index desc
  limit 1;

  if found then
    if last_state_index = 49 then
      next_cycle := last_cycle + 1;
      next_state_index := 0;
    else
      next_cycle := last_cycle;
      next_state_index := last_state_index + 1;
    end if;
  end if;

  select (coalesce(max(r.attempt_number), 0) + 1)::smallint
    into next_attempt
  from private.bty_nominee_research_runs r
  where r.tenant_id = p_tenant_id
    and r.cycle_number = next_cycle
    and r.state_index = next_state_index;

  insert into private.bty_nominee_research_runs (
    tenant_id,
    business_date,
    cycle_number,
    state_index,
    state_code,
    attempt_number
  )
  values (
    p_tenant_id,
    p_business_date,
    next_cycle,
    next_state_index,
    state_codes[next_state_index + 1],
    next_attempt
  )
  returning * into run_row;

  return jsonb_build_object(
    'runId', run_row.id,
    'businessDate', run_row.business_date,
    'cycleNumber', run_row.cycle_number,
    'stateIndex', run_row.state_index,
    'stateCode', run_row.state_code,
    'stateName', state_names[run_row.state_index + 1],
    'attemptNumber', run_row.attempt_number,
    'status', run_row.status,
    'stateInsertedCount', 0,
    'remainingCapacity', 5,
    'replayed', false
  );
end;
$function$;

create or replace function private.complete_bty_nominee_research_run(
  p_run_id uuid,
  p_considered_count integer,
  p_qualified_count integer,
  p_search_summary jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  run_row private.bty_nominee_research_runs%rowtype;
  run_tenant_id uuid;
  state_inserted integer;
begin
  if p_run_id is null then
    raise exception 'run_id is required';
  end if;

  select r.tenant_id into run_tenant_id
  from private.bty_nominee_research_runs r
  where r.id = p_run_id;

  if not found then
    raise exception 'research run not found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bty_nominee_research:' || run_tenant_id::text, 0)
  );

  select r.* into run_row
  from private.bty_nominee_research_runs r
  where r.id = p_run_id
  for update;

  if not found then
    raise exception 'research run not found';
  end if;

  if run_row.status = 'completed' then
    return jsonb_build_object(
      'runId', run_row.id,
      'status', run_row.status,
      'replayed', true,
      'insertedCount', run_row.inserted_count
    );
  end if;

  if run_row.status <> 'in_progress' then
    raise exception 'only an in-progress research run can be completed';
  end if;

  if p_considered_count is null or p_considered_count < 0 then
    raise exception 'considered_count must be nonnegative';
  end if;

  if p_qualified_count is null
     or p_qualified_count < run_row.inserted_count
     or p_qualified_count > 5
     or p_qualified_count > p_considered_count then
    raise exception 'qualified_count must be between inserted_count and the lesser of five and considered_count';
  end if;

  if p_search_summary is null or jsonb_typeof(p_search_summary) <> 'object' then
    raise exception 'search_summary must be a JSON object';
  end if;

  update private.bty_nominee_research_runs
  set status = 'completed',
      considered_count = p_considered_count,
      qualified_count = p_qualified_count,
      search_summary = p_search_summary,
      completed_at = now(),
      updated_at = now()
  where id = p_run_id
  returning * into run_row;

  select coalesce(sum(r.inserted_count), 0)::integer
    into state_inserted
  from private.bty_nominee_research_runs r
  where r.tenant_id = run_row.tenant_id
    and r.cycle_number = run_row.cycle_number
    and r.state_index = run_row.state_index;

  return jsonb_build_object(
    'runId', run_row.id,
    'status', run_row.status,
    'stateCode', run_row.state_code,
    'insertedCount', run_row.inserted_count,
    'stateInsertedCount', state_inserted,
    'replayed', false
  );
end;
$function$;

create or replace function private.fail_bty_nominee_research_run(
  p_run_id uuid,
  p_error_summary jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  run_row private.bty_nominee_research_runs%rowtype;
  run_tenant_id uuid;
begin
  if p_error_summary is null or jsonb_typeof(p_error_summary) <> 'object' then
    raise exception 'error_summary must be a JSON object';
  end if;

  select r.tenant_id into run_tenant_id
  from private.bty_nominee_research_runs r
  where r.id = p_run_id;

  if not found then
    raise exception 'research run not found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bty_nominee_research:' || run_tenant_id::text, 0)
  );

  select r.* into run_row
  from private.bty_nominee_research_runs r
  where r.id = p_run_id
  for update;

  if not found then
    raise exception 'research run not found';
  end if;

  if run_row.status = 'completed' then
    raise exception 'a completed research run cannot be failed';
  end if;

  if run_row.status = 'failed' then
    return jsonb_build_object('runId', run_row.id, 'status', run_row.status, 'replayed', true);
  end if;

  update private.bty_nominee_research_runs
  set status = 'failed',
      error_summary = p_error_summary,
      completed_at = now(),
      updated_at = now()
  where id = p_run_id
  returning * into run_row;

  return jsonb_build_object(
    'runId', run_row.id,
    'status', run_row.status,
    'stateCode', run_row.state_code,
    'replayed', false
  );
end;
$function$;

create or replace function private.add_bty_nominee_from_research(
  p_run_id uuid,
  p_candidate jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  run_row private.bty_nominee_research_runs%rowtype;
  run_tenant_id uuid;
  org_payload jsonb;
  contact_payload jsonb;
  social_payload jsonb;
  social_item jsonb;
  org_name text;
  website text;
  normalized_name text;
  normalized_domain text;
  organization_kind text;
  hq_state text;
  hq_evidence_url text;
  impact_evidence_url text;
  qualification_summary text;
  veteran_affiliated boolean;
  first_name text;
  last_name text;
  email_address text;
  role_title text;
  contact_evidence_url text;
  platform_name text;
  profile_url text;
  profile_handle text;
  follower_count bigint;
  follower_evidence_url text;
  has_audience_benchmark boolean := false;
  state_inserted integer;
  duplicate_org_id uuid;
  duplicate_org_name text;
  duplicate_contact_id uuid;
  duplicate_social_org_id uuid;
  duplicate_social_url text;
  new_organization_id uuid;
  new_contact_id uuid;
  nomination_event_id uuid;
  event_status text;
  campaign_enrollment_id uuid;
begin
  if p_run_id is null or p_candidate is null or jsonb_typeof(p_candidate) <> 'object' then
    raise exception 'run_id and a candidate JSON object are required';
  end if;

  select r.tenant_id into run_tenant_id
  from private.bty_nominee_research_runs r
  where r.id = p_run_id;

  if not found then
    raise exception 'research run not found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bty_nominee_research:' || run_tenant_id::text, 0)
  );

  select r.* into run_row
  from private.bty_nominee_research_runs r
  where r.id = p_run_id
  for update;

  if not found then
    raise exception 'research run not found';
  end if;

  if run_row.status <> 'in_progress' then
    raise exception 'nominees may only be added to an in-progress research run';
  end if;

  select coalesce(sum(r.inserted_count), 0)::integer
    into state_inserted
  from private.bty_nominee_research_runs r
  where r.tenant_id = run_row.tenant_id
    and r.cycle_number = run_row.cycle_number
    and r.state_index = run_row.state_index;

  if state_inserted >= 5 then
    return jsonb_build_object(
      'inserted', false,
      'reason', 'state_capacity_reached',
      'stateCode', run_row.state_code,
      'stateInsertedCount', state_inserted
    );
  end if;

  org_payload := p_candidate -> 'organization';
  contact_payload := p_candidate -> 'contact';
  social_payload := p_candidate -> 'socialProfiles';

  if jsonb_typeof(org_payload) <> 'object'
     or jsonb_typeof(contact_payload) <> 'object'
     or jsonb_typeof(social_payload) <> 'array' then
    raise exception 'candidate must contain organization and contact objects plus a socialProfiles array';
  end if;

  org_name := nullif(btrim(org_payload ->> 'name'), '');
  website := nullif(btrim(org_payload ->> 'website'), '');
  organization_kind := nullif(btrim(org_payload ->> 'organizationKind'), '');
  hq_state := upper(nullif(btrim(org_payload ->> 'headquartersState'), ''));
  hq_evidence_url := nullif(btrim(org_payload ->> 'headquartersEvidenceUrl'), '');
  impact_evidence_url := nullif(btrim(org_payload ->> 'impactEvidenceUrl'), '');
  qualification_summary := nullif(btrim(org_payload ->> 'qualificationSummary'), '');
  normalized_name := public.bty_normalize_org_name(org_name);
  normalized_domain := public.bty_normalize_domain(website);

  if jsonb_typeof(org_payload -> 'veteranAffiliated') = 'boolean' then
    veteran_affiliated := (org_payload ->> 'veteranAffiliated')::boolean;
  else
    veteran_affiliated := null;
  end if;

  first_name := nullif(btrim(contact_payload ->> 'firstName'), '');
  last_name := nullif(btrim(contact_payload ->> 'lastName'), '');
  email_address := lower(nullif(btrim(contact_payload ->> 'email'), ''));
  role_title := nullif(btrim(contact_payload ->> 'roleTitle'), '');
  contact_evidence_url := nullif(btrim(contact_payload ->> 'evidenceUrl'), '');

  if org_name is null or normalized_name is null then
    raise exception 'organization name is required';
  end if;
  if website is null or normalized_domain is null or website !~* '^https?://' then
    raise exception 'a verified http(s) organization website is required';
  end if;
  if hq_state is distinct from run_row.state_code then
    raise exception 'candidate headquarters state must equal the research run state %', run_row.state_code;
  end if;
  if hq_evidence_url is null or hq_evidence_url !~* '^https?://' then
    raise exception 'a headquarters evidence URL is required';
  end if;
  if impact_evidence_url is null or impact_evidence_url !~* '^https?://'
     or qualification_summary is null then
    raise exception 'impact evidence and a qualification summary are required';
  end if;
  if first_name is null or email_address is null or role_title is null then
    raise exception 'a named contact with role title and email is required';
  end if;
  if email_address !~* '^[A-Z0-9._%+''-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'contact email format is invalid';
  end if;
  if contact_evidence_url is null or contact_evidence_url !~* '^https?://' then
    raise exception 'a contact evidence URL is required';
  end if;

  for social_item in select value from jsonb_array_elements(social_payload)
  loop
    if jsonb_typeof(social_item) <> 'object' then
      raise exception 'every social profile must be a JSON object';
    end if;

    platform_name := lower(nullif(btrim(social_item ->> 'platformName'), ''));
    profile_url := nullif(btrim(social_item ->> 'profileUrl'), '');
    follower_evidence_url := nullif(btrim(social_item ->> 'followerCountEvidenceUrl'), '');

    if platform_name is null or profile_url is null or profile_url !~* '^https?://' then
      raise exception 'every social profile requires a platform name and http(s) profile URL';
    end if;

    if social_item ? 'followerCount' then
      if coalesce(social_item ->> 'followerCount', '') !~ '^[0-9]+$' then
        raise exception 'social followerCount must be a nonnegative integer';
      end if;
      follower_count := (social_item ->> 'followerCount')::bigint;
      if follower_count >= 1000
         and follower_evidence_url is not null
         and follower_evidence_url ~* '^https?://' then
        has_audience_benchmark := true;
      end if;
    end if;
  end loop;

  if not has_audience_benchmark then
    raise exception 'at least one verified social profile must meet the internal audience benchmark';
  end if;

  select o.id, o.name
    into duplicate_org_id, duplicate_org_name
  from public.relationship_organizations o
  where o.tenant_id = run_row.tenant_id
    and (
      public.bty_normalize_org_name(o.name) = normalized_name
      or public.bty_normalize_domain(o.website) = normalized_domain
    )
  order by o.created_at
  limit 1;

  if found then
    return jsonb_build_object(
      'inserted', false,
      'reason', 'duplicate_organization',
      'matchedOrganizationId', duplicate_org_id,
      'matchedOrganizationName', duplicate_org_name
    );
  end if;

  select c.id
    into duplicate_contact_id
  from public.relationship_contacts c
  where c.tenant_id = run_row.tenant_id
    and lower(btrim(c.email)) = email_address
  limit 1;

  if found then
    return jsonb_build_object(
      'inserted', false,
      'reason', 'duplicate_contact_email',
      'matchedContactId', duplicate_contact_id
    );
  end if;

  select sp.organization_id, sp.profile_url
    into duplicate_social_org_id, duplicate_social_url
  from public.relationship_social_profiles sp
  join jsonb_array_elements(social_payload) candidate_social on true
  where sp.tenant_id = run_row.tenant_id
    and sp.organization_id is not null
    and (
      lower(btrim(sp.profile_url)) = lower(btrim(candidate_social ->> 'profileUrl'))
      or (
        lower(sp.platform_name) = 'youtube'
        and lower(candidate_social ->> 'platformName') = 'youtube'
        and public.bty_normalize_youtube_url(sp.profile_url)
            = public.bty_normalize_youtube_url(candidate_social ->> 'profileUrl')
      )
    )
  limit 1;

  if found then
    return jsonb_build_object(
      'inserted', false,
      'reason', 'duplicate_social_profile',
      'matchedOrganizationId', duplicate_social_org_id,
      'matchedProfileUrl', duplicate_social_url
    );
  end if;

  insert into public.relationship_organizations (
    tenant_id,
    name,
    website,
    organization_kind,
    veteran_affiliated,
    outreach_status,
    source,
    source_record_key,
    metadata,
    relationship_stage,
    headquarters_state
  )
  values (
    run_row.tenant_id,
    org_name,
    website,
    organization_kind,
    veteran_affiliated,
    'new',
    'daily_bty_research',
    'bty-daily-org:' || md5(normalized_domain),
    jsonb_build_object(
      'btyResearchRunId', run_row.id,
      'btyResearchCycle', run_row.cycle_number,
      'headquartersEvidenceUrl', hq_evidence_url,
      'impactEvidenceUrl', impact_evidence_url,
      'qualificationSummary', qualification_summary
    ),
    'qualified_outreach',
    run_row.state_code
  )
  returning id into new_organization_id;

  insert into public.relationship_contacts (
    tenant_id,
    first_name,
    last_name,
    email,
    state,
    outreach_status,
    source,
    source_record_key,
    metadata,
    relationship_stage
  )
  values (
    run_row.tenant_id,
    first_name,
    last_name,
    email_address,
    run_row.state_code,
    'new',
    'daily_bty_research',
    'bty-daily-contact:' || md5(email_address),
    jsonb_build_object(
      'btyResearchRunId', run_row.id,
      'roleTitle', role_title,
      'contactEvidenceUrl', contact_evidence_url
    ),
    'qualified_outreach'
  )
  returning id into new_contact_id;

  insert into public.relationship_contact_organizations (
    tenant_id,
    contact_id,
    organization_id,
    role_title,
    is_primary,
    metadata
  )
  values (
    run_row.tenant_id,
    new_contact_id,
    new_organization_id,
    role_title,
    true,
    jsonb_build_object('btyResearchRunId', run_row.id)
  );

  for social_item in select value from jsonb_array_elements(social_payload)
  loop
    platform_name := lower(nullif(btrim(social_item ->> 'platformName'), ''));
    profile_handle := nullif(btrim(social_item ->> 'handle'), '');
    profile_url := nullif(btrim(social_item ->> 'profileUrl'), '');
    follower_evidence_url := nullif(btrim(social_item ->> 'followerCountEvidenceUrl'), '');
    follower_count := null;
    if social_item ? 'followerCount' then
      follower_count := (social_item ->> 'followerCount')::bigint;
    end if;

    insert into public.relationship_social_profiles (
      tenant_id,
      organization_id,
      platform_name,
      handle,
      profile_url,
      follower_count,
      source,
      source_record_key,
      metadata
    )
    values (
      run_row.tenant_id,
      new_organization_id,
      platform_name,
      profile_handle,
      profile_url,
      follower_count,
      'daily_bty_research',
      'bty-daily-social:' || md5(platform_name || ':' || lower(profile_url)),
      jsonb_strip_nulls(jsonb_build_object(
        'btyResearchRunId', run_row.id,
        'followerCountEvidenceUrl', follower_evidence_url
      ))
    );
  end loop;

  -- This role is deliberately inserted last. Its existing trigger synchronously
  -- enrolls the complete organization/contact pair in the live BTY campaign.
  insert into public.relationship_organization_roles (
    tenant_id,
    organization_id,
    role_code,
    source,
    metadata
  )
  values (
    run_row.tenant_id,
    new_organization_id,
    'bty_nominee',
    'research',
    jsonb_build_object(
      'btyResearchRunId', run_row.id,
      'headquartersState', run_row.state_code,
      'qualificationSummary', qualification_summary
    )
  );

  select e.id, e.status, e.enrollment_id
    into nomination_event_id, event_status, campaign_enrollment_id
  from private.relationship_bty_recommended_nomination_events e
  where e.tenant_id = run_row.tenant_id
    and e.organization_id = new_organization_id
  order by e.created_at desc
  limit 1;

  if nomination_event_id is null
     or event_status is distinct from 'enrolled'
     or campaign_enrollment_id is null then
    raise exception 'BTY campaign enrollment did not complete (event status: %)', coalesce(event_status, 'missing');
  end if;

  update private.bty_nominee_research_runs
  set inserted_count = inserted_count + 1,
      organization_ids = array_append(organization_ids, new_organization_id),
      updated_at = now()
  where id = run_row.id
  returning * into run_row;

  return jsonb_build_object(
    'inserted', true,
    'organizationId', new_organization_id,
    'contactId', new_contact_id,
    'nominationEventId', nomination_event_id,
    'campaignEnrollmentId', campaign_enrollment_id,
    'stateCode', run_row.state_code,
    'runInsertedCount', run_row.inserted_count,
    'stateInsertedCount', state_inserted + 1
  );
end;
$function$;

revoke all on function private.start_bty_nominee_research_run(uuid, date) from public, anon, authenticated;
revoke all on function private.complete_bty_nominee_research_run(uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function private.fail_bty_nominee_research_run(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.add_bty_nominee_from_research(uuid, jsonb) from public, anon, authenticated;

comment on function private.start_bty_nominee_research_run(uuid, date) is
  'Starts or resumes the next manually invoked alphabetical state in the BTY research rotation.';

comment on function private.add_bty_nominee_from_research(uuid, jsonb) is
  'Atomically deduplicates, records, and enrolls one fully evidenced BTY nominee found by a manual research run.';
