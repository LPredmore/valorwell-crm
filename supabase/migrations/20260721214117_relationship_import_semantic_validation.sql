create or replace function private.evaluate_relationship_import_normalized(
  p_tenant_id uuid,
  p_normalized jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_normalized jsonb := coalesce(p_normalized, '{}'::jsonb);
  v_errors text[] := '{}'::text[];
  v_candidates jsonb := '[]'::jsonb;
  v_org_name text := nullif(btrim(v_normalized ->> 'organization_name'), '');
  v_website text := nullif(btrim(v_normalized ->> 'website'), '');
  v_domain text := private.relationship_import_domain(v_normalized ->> 'website');
  v_contact_name text := nullif(btrim(v_normalized ->> 'contact_name'), '');
  v_email text := nullif(lower(btrim(v_normalized ->> 'contact_email')), '');
  v_contact_phone text := nullif(btrim(v_normalized ->> 'contact_phone'), '');
  v_contact_title text := nullif(btrim(v_normalized ->> 'contact_title'), '');
  v_role_code text := nullif(lower(btrim(v_normalized ->> 'role_code')), '');
  v_role_applies_to text;
  v_contact_kind text := nullif(lower(btrim(v_normalized ->> 'contact_kind')), '');
  v_bty_status text := nullif(lower(btrim(v_normalized ->> 'bty_status')), '');
  v_veteran_text text := nullif(lower(btrim(v_normalized ->> 'veteran_affiliation')), '');
  v_source_category text := nullif(btrim(v_normalized ->> 'source_category'), '');
  v_source_summary text := nullif(btrim(v_normalized ->> 'source_summary'), '');
  v_social_platform text := nullif(btrim(v_normalized ->> 'social_platform'), '');
  v_social_handle text := nullif(btrim(v_normalized ->> 'social_handle'), '');
  v_social_url text := nullif(btrim(v_normalized ->> 'social_url'), '');
  v_has_contact_fields boolean;
  v_decision text;
begin
  if jsonb_typeof(v_normalized) <> 'object' then
    raise exception 'Normalized import row must be a JSON object.' using errcode = '22023';
  end if;

  if v_org_name is null then
    v_errors := array_append(v_errors, 'Organization name is required.');
  else
    v_normalized := jsonb_set(
      v_normalized,
      '{organization_name}',
      to_jsonb(regexp_replace(v_org_name, '\s+', ' ', 'g')),
      true
    );
  end if;

  if v_website is not null then
    if v_domain is null or v_domain !~ '^[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?$' then
      v_errors := array_append(v_errors, 'Website must contain a valid domain.');
    else
      v_normalized := v_normalized || jsonb_build_object('website_domain', v_domain);
    end if;
  end if;

  if v_email is not null then
    if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      v_errors := array_append(v_errors, 'Contact email is invalid.');
    else
      v_normalized := jsonb_set(v_normalized, '{contact_email}', to_jsonb(v_email), true);
    end if;
  end if;

  if v_contact_kind is not null and v_contact_kind <> all (array['person','role_inbox']::text[]) then
    v_errors := array_append(v_errors, 'Contact kind must be person or role_inbox.');
  end if;

  v_has_contact_fields := num_nonnulls(
    v_contact_name,
    v_email,
    v_contact_phone,
    v_contact_title,
    v_contact_kind
  ) > 0;

  if v_has_contact_fields and v_contact_name is null and v_email is null then
    v_errors := array_append(v_errors, 'Contact rows require a contact name or email.');
  end if;

  if v_contact_kind = 'role_inbox' and v_email is null then
    v_errors := array_append(v_errors, 'Role inbox contacts require an email address.');
  end if;

  if v_bty_status is not null and v_bty_status <> all (array[
    'identified','researching','qualified','ready_for_campaign','contacted','responded',
    'interested','recording_planned','booked','declined','nurture','disqualified','completed'
  ]::text[]) then
    v_errors := array_append(v_errors, 'BTY status is invalid.');
  end if;

  if v_role_code is not null then
    select catalog.applies_to
    into v_role_applies_to
    from public.relationship_role_catalog catalog
    where catalog.code = v_role_code
      and catalog.is_active;

    if v_role_applies_to is null then
      v_errors := array_append(v_errors, 'Role code is not active in the relationship role catalog.');
    elsif v_role_applies_to = 'contact' and v_contact_name is null and v_email is null then
      v_errors := array_append(v_errors, 'This role requires a contact name or email.');
    end if;
  end if;

  if (v_source_category is null) <> (v_source_summary is null) then
    v_errors := array_append(v_errors, 'Source category and source summary must be provided together.');
  end if;

  if num_nonnulls(v_social_platform, v_social_handle, v_social_url) > 0
     and (v_social_platform is null or num_nonnulls(v_social_handle, v_social_url) = 0) then
    v_errors := array_append(v_errors, 'Social profiles require a platform and a handle or URL.');
  end if;

  if v_normalized ? 'veteran_affiliation'
     and jsonb_typeof(v_normalized -> 'veteran_affiliation') <> 'boolean'
     and v_veteran_text is not null then
    v_errors := array_append(v_errors, 'Veteran affiliation must be yes or no.');
  end if;

  if v_normalized ? 'bty_audience_reach'
     and jsonb_typeof(v_normalized -> 'bty_audience_reach') <> 'number' then
    v_errors := array_append(v_errors, 'BTY audience reach must be numeric.');
  end if;

  with raw_candidates as (
    select 'contact'::text as entity, contact.id, 100 as score, 'email'::text as signal
    from public.relationship_contacts contact
    where v_email is not null
      and contact.tenant_id = p_tenant_id
      and lower(contact.email) = v_email

    union all

    select 'organization', organization.id, 100, 'website_domain'
    from public.relationship_organizations organization
    where v_domain is not null
      and organization.tenant_id = p_tenant_id
      and private.relationship_import_domain(organization.website) = v_domain

    union all

    select 'organization', organization.id, 90, 'organization_name'
    from public.relationship_organizations organization
    where v_org_name is not null
      and organization.tenant_id = p_tenant_id
      and lower(regexp_replace(btrim(organization.name), '\s+', ' ', 'g'))
          = lower(regexp_replace(v_org_name, '\s+', ' ', 'g'))
  ),
  grouped_candidates as (
    select entity, id, max(score) as score, array_agg(distinct signal order by signal) as signals
    from raw_candidates
    group by entity, id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entity', entity,
        'id', id,
        'score', score,
        'signals', to_jsonb(signals)
      )
      order by score desc, entity, id
    ),
    '[]'::jsonb
  )
  into v_candidates
  from grouped_candidates;

  if cardinality(v_errors) > 0 then
    v_decision := 'invalid';
  elsif exists (
    select 1
    from jsonb_array_elements(v_candidates) candidate
    where (candidate ->> 'score')::integer = 100
  ) then
    v_decision := 'duplicate';
  elsif jsonb_array_length(v_candidates) > 0 then
    v_decision := 'ambiguous';
  else
    v_decision := 'create';
  end if;

  return jsonb_build_object(
    'normalized_data', v_normalized,
    'errors', to_jsonb(v_errors),
    'candidates', v_candidates,
    'decision', v_decision
  );
end;
$$;

revoke all on function private.evaluate_relationship_import_normalized(uuid, jsonb) from public, anon, authenticated;
grant execute on function private.evaluate_relationship_import_normalized(uuid, jsonb) to service_role;

comment on function private.evaluate_relationship_import_normalized(uuid, jsonb) is
  'Validates normalized relationship import rows, including role applicability, contact identity, source-pair, and social-profile completeness.';
