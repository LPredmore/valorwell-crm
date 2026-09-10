CREATE OR REPLACE FUNCTION private.add_bty_nominee_from_research(p_run_id uuid, p_candidate jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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

  org_payload := p_candidate -> 'organization';
  contact_payload := coalesce(p_candidate -> 'contact', '{}'::jsonb);
  social_payload := coalesce(p_candidate -> 'socialProfiles', '[]'::jsonb);

  if jsonb_typeof(org_payload) <> 'object' then
    raise exception 'candidate must contain an organization object';
  end if;
  if jsonb_typeof(contact_payload) <> 'object' then
    raise exception 'contact must be a JSON object when supplied';
  end if;
  if jsonb_typeof(social_payload) <> 'array' then
    raise exception 'socialProfiles must be an array when supplied';
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
  if website is not null and website !~* '^https?://' then
    raise exception 'organization website must be http(s) when supplied';
  end if;
  if hq_evidence_url is not null and hq_evidence_url !~* '^https?://' then
    raise exception 'headquarters evidence URL must be http(s) when supplied';
  end if;
  if impact_evidence_url is not null and impact_evidence_url !~* '^https?://' then
    raise exception 'impact evidence URL must be http(s) when supplied';
  end if;
  if contact_evidence_url is not null and contact_evidence_url !~* '^https?://' then
    raise exception 'contact evidence URL must be http(s) when supplied';
  end if;
  if email_address is not null and email_address !~* '^[A-Z0-9._%+''-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$' then
    raise exception 'contact email format is invalid';
  end if;

  for social_item in select value from jsonb_array_elements(social_payload)
  loop
    if jsonb_typeof(social_item) <> 'object' then
      raise exception 'every social profile must be a JSON object';
    end if;

    platform_name := lower(nullif(btrim(social_item ->> 'platformName'), ''));
    profile_url := nullif(btrim(social_item ->> 'profileUrl'), '');

    if platform_name is null or profile_url is null or profile_url !~* '^https?://' then
      raise exception 'every supplied social profile requires a platform name and http(s) profile URL';
    end if;

    if social_item ? 'followerCount' then
      if coalesce(social_item ->> 'followerCount', '') !~ '^[0-9]+$' then
        raise exception 'social followerCount must be a nonnegative integer';
      end if;
    end if;
  end loop;

  select o.id, o.name
    into duplicate_org_id, duplicate_org_name
  from public.relationship_organizations o
  where o.tenant_id = run_row.tenant_id
    and (
      public.bty_normalize_org_name(o.name) = normalized_name
      or (
        normalized_domain is not null
        and public.bty_normalize_domain(o.website) = normalized_domain
      )
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

  if email_address is not null then
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
  end if;

  if jsonb_array_length(social_payload) > 0 then
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
  end if;

  insert into public.relationship_organizations (
    tenant_id, name, website, organization_kind, veteran_affiliated,
    outreach_status, source, source_record_key, metadata,
    relationship_stage, headquarters_state
  )
  values (
    run_row.tenant_id,
    org_name,
    website,
    organization_kind,
    veteran_affiliated,
    'new',
    'daily_bty_research',
    'bty-daily-org:' || md5(coalesce(normalized_domain, normalized_name)),
    jsonb_strip_nulls(jsonb_build_object(
      'btyResearchRunId', run_row.id,
      'btyResearchCycle', run_row.cycle_number,
      'headquartersEvidenceUrl', hq_evidence_url,
      'impactEvidenceUrl', impact_evidence_url,
      'qualificationSummary', qualification_summary
    )),
    'qualified_outreach',
    hq_state
  )
  returning id into new_organization_id;

  new_contact_id := null;
  if first_name is not null or last_name is not null or email_address is not null or role_title is not null then
    insert into public.relationship_contacts (
      tenant_id, first_name, last_name, email, state, outreach_status,
      source, source_record_key, metadata, relationship_stage
    )
    values (
      run_row.tenant_id,
      first_name,
      last_name,
      email_address,
      hq_state,
      'new',
      'daily_bty_research',
      'bty-daily-contact:' || md5(coalesce(email_address, coalesce(first_name,'') || ':' || coalesce(last_name,'') || ':' || new_organization_id::text)),
      jsonb_strip_nulls(jsonb_build_object(
        'btyResearchRunId', run_row.id,
        'roleTitle', role_title,
        'contactEvidenceUrl', contact_evidence_url
      )),
      'qualified_outreach'
    )
    returning id into new_contact_id;

    insert into public.relationship_contact_organizations (
      tenant_id, contact_id, organization_id, role_title, is_primary, metadata
    )
    values (
      run_row.tenant_id,
      new_contact_id,
      new_organization_id,
      role_title,
      true,
      jsonb_build_object('btyResearchRunId', run_row.id)
    );
  end if;

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
      tenant_id, organization_id, platform_name, handle, profile_url,
      follower_count, source, source_record_key, metadata
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

  insert into public.relationship_organization_roles (
    tenant_id, organization_id, role_code, source, metadata
  )
  values (
    run_row.tenant_id,
    new_organization_id,
    'bty_nominee',
    'research',
    jsonb_strip_nulls(jsonb_build_object(
      'btyResearchRunId', run_row.id,
      'headquartersState', hq_state,
      'qualificationSummary', qualification_summary
    ))
  );

  select e.id, e.status, e.enrollment_id
    into nomination_event_id, event_status, campaign_enrollment_id
  from private.relationship_bty_recommended_nomination_events e
  where e.tenant_id = run_row.tenant_id
    and e.organization_id = new_organization_id
  order by e.created_at desc
  limit 1;

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
    'campaignEventStatus', event_status,
    'stateCode', run_row.state_code,
    'runInsertedCount', run_row.inserted_count
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.complete_bty_nominee_research_run(
  p_run_id uuid,
  p_considered_count integer,
  p_qualified_count integer,
  p_search_summary jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  run_row private.bty_nominee_research_runs%rowtype;
  run_tenant_id uuid;
  state_inserted integer;
  rotation_result jsonb;
begin
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
  if p_qualified_count is null or p_qualified_count < 0 or p_qualified_count > p_considered_count then
    raise exception 'qualified_count must be nonnegative and cannot exceed considered_count';
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

  rotation_result := private.complete_research_state_rotation(
    run_row.tenant_id,
    'bty_nominees',
    (run_row.state_index + 1)::smallint
  );

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
    'nextStateCode', rotation_result ->> 'nextStateCode',
    'nextStateName', rotation_result ->> 'nextStateName',
    'replayed', false
  );
end;
$function$;
