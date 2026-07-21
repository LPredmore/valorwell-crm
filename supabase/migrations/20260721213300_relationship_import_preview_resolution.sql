create or replace function private.relationship_import_context(
  p_require_mutation boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_context jsonb;
  v_tenant_id uuid;
  v_role text;
begin
  if v_actor is null then
    raise exception 'Authenticated CRM access is required.' using errcode = '42501';
  end if;

  v_context := public.get_crm_operating_context();
  v_tenant_id := nullif(v_context ->> 'current_tenant_id', '')::uuid;
  v_role := coalesce(v_context ->> 'crm_role', 'crm_none');

  if v_tenant_id is null or v_role = 'crm_none' then
    raise exception 'No operating tenant is selected for this CRM session.' using errcode = '42501';
  end if;

  if p_require_mutation and v_role <> all (array['crm_admin','crm_operator']::text[]) then
    raise exception 'You do not have permission to manage relationship imports.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'actor_id', v_actor,
    'tenant_id', v_tenant_id,
    'crm_role', v_role
  );
end;
$$;

create or replace function private.get_relationship_import_preview(
  p_import_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_import_context(false);
  v_actor uuid := (v_context ->> 'actor_id')::uuid;
  v_tenant_id uuid := (v_context ->> 'tenant_id')::uuid;
  v_role text := v_context ->> 'crm_role';
  v_import public.relationship_imports%rowtype;
  v_rows jsonb;
  v_conflicts jsonb;
  v_excluded integer[];
begin
  select *
  into v_import
  from public.relationship_imports import_batch
  where import_batch.id = p_import_id
    and import_batch.tenant_id = v_tenant_id;

  if not found then
    raise exception 'Relationship import not found.' using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'row', import_row.row_number,
          'decision', import_row.decision,
          'errors', to_jsonb(import_row.errors),
          'candidates', import_row.candidates,
          'resolution', import_row.resolution,
          'normalizedData', import_row.normalized_data,
          'rawData', case when v_role = 'crm_admin' then import_row.raw_data else null end,
          'committedOrganizationId', import_row.committed_organization_id,
          'committedContactId', import_row.committed_contact_id,
          'committedOpportunityId', import_row.committed_opportunity_id
        )
      )
      order by import_row.row_number
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.relationship_import_rows import_row
  where import_row.import_id = v_import.id
    and import_row.tenant_id = v_import.tenant_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'row', import_row.row_number,
        'candidates', import_row.candidates,
        'decision', import_row.decision,
        'errors', to_jsonb(import_row.errors)
      )
      order by import_row.row_number
    ),
    '[]'::jsonb
  )
  into v_conflicts
  from public.relationship_import_rows import_row
  where import_row.import_id = v_import.id
    and import_row.tenant_id = v_import.tenant_id
    and import_row.decision = any (array['duplicate','ambiguous','invalid']::text[]);

  select coalesce(array_agg(import_row.row_number order by import_row.row_number), '{}'::integer[])
  into v_excluded
  from public.relationship_import_rows import_row
  where import_row.import_id = v_import.id
    and import_row.tenant_id = v_import.tenant_id
    and import_row.decision = 'excluded';

  return jsonb_build_object(
    'previewId', v_import.id,
    'status', v_import.status,
    'version', v_import.version,
    'filename', v_import.filename,
    'sourceType', v_import.source_type,
    'mapping', v_import.mapping,
    'headers', to_jsonb(v_import.headers),
    'rowCount', v_import.row_count,
    'validRowCount', v_import.valid_row_count,
    'conflictCount', v_import.conflict_count,
    'excludedCount', v_import.excluded_count,
    'committedCount', v_import.committed_count,
    'valid', v_import.status = any (array['ready','completed']::text[]),
    'rows', v_rows,
    'conflicts', v_conflicts,
    'excludedRows', to_jsonb(v_excluded),
    'canViewRawRows', v_role = 'crm_admin',
    'createdAt', v_import.created_at,
    'updatedAt', v_import.updated_at,
    'completedAt', v_import.completed_at
  );
end;
$$;

create or replace function private.create_relationship_import_preview(
  p_filename text,
  p_source_type text,
  p_mapping jsonb,
  p_headers text[],
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_import_context(true);
  v_actor uuid := (v_context ->> 'actor_id')::uuid;
  v_tenant_id uuid := (v_context ->> 'tenant_id')::uuid;
  v_import public.relationship_imports%rowtype;
  v_raw jsonb;
  v_evaluation jsonb;
  v_ordinality bigint;
  v_row_count integer := 0;
  v_valid_count integer := 0;
  v_conflict_count integer := 0;
  v_invalid_count integer := 0;
  v_status text;
  v_unknown_field text;
  v_duplicate_field text;
begin
  if nullif(btrim(p_filename), '') is null then
    raise exception 'Import filename is required.' using errcode = '22023';
  end if;
  if nullif(btrim(p_source_type), '') is null then
    raise exception 'Import source type is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_mapping) <> 'object' then
    raise exception 'Import mapping must be a JSON object.' using errcode = '22023';
  end if;
  if coalesce(array_length(p_headers, 1), 0) = 0 then
    raise exception 'Import headers are required.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Import rows must be a JSON array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'Import must contain at least one data row.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Import preview is limited to 5000 rows.' using errcode = '22023';
  end if;

  select value
  into v_unknown_field
  from jsonb_each_text(p_mapping)
  where value <> all (array[
    'organization_name','website','organization_type','state','veteran_affiliation',
    'contact_name','contact_email','contact_phone','contact_kind','contact_title',
    'source_category','source_summary','social_platform','social_handle','social_url',
    'role_code','bty_status','bty_cause_area','bty_audience_reach','ignore'
  ]::text[])
  limit 1;

  if v_unknown_field is not null then
    raise exception 'Unsupported relationship import field: %.', v_unknown_field using errcode = '22023';
  end if;

  if not exists (
    select 1 from jsonb_each_text(p_mapping) mapping_entry
    where mapping_entry.value = 'organization_name'
  ) then
    raise exception 'The organization_name field must be mapped.' using errcode = '22023';
  end if;

  select value
  into v_duplicate_field
  from jsonb_each_text(p_mapping)
  where value <> 'ignore'
  group by value
  having count(*) > 1
  limit 1;

  if v_duplicate_field is not null then
    raise exception 'Import field % is mapped more than once.', v_duplicate_field using errcode = '22023';
  end if;

  insert into public.relationship_imports (
    tenant_id, filename, source_type, status, mapping, headers,
    metadata, created_by_profile_id, updated_by_profile_id
  ) values (
    v_tenant_id, btrim(p_filename), lower(btrim(p_source_type)), 'draft',
    p_mapping, p_headers, jsonb_build_object('preview_created_by', v_actor),
    v_actor, v_actor
  )
  returning * into v_import;

  for v_raw, v_ordinality in
    select value, ordinality
    from jsonb_array_elements(p_rows) with ordinality
  loop
    if jsonb_typeof(v_raw) <> 'object' then
      raise exception 'Every import row must be a JSON object.' using errcode = '22023';
    end if;

    v_evaluation := private.evaluate_relationship_import_normalized(
      v_tenant_id,
      private.relationship_import_map_row(v_raw, p_mapping)
    );

    insert into public.relationship_import_rows (
      tenant_id, import_id, row_number, raw_data, normalized_data,
      decision, errors, candidates, resolution
    ) values (
      v_tenant_id,
      v_import.id,
      v_ordinality::integer + 1,
      v_raw,
      v_evaluation -> 'normalized_data',
      v_evaluation ->> 'decision',
      array(select jsonb_array_elements_text(v_evaluation -> 'errors')),
      v_evaluation -> 'candidates',
      '{}'::jsonb
    );

    v_row_count := v_row_count + 1;
    if v_evaluation ->> 'decision' <> 'invalid' then
      v_valid_count := v_valid_count + 1;
    else
      v_invalid_count := v_invalid_count + 1;
    end if;
    if v_evaluation ->> 'decision' = any (array['duplicate','ambiguous']::text[]) then
      v_conflict_count := v_conflict_count + 1;
    end if;
  end loop;

  v_status := case
    when v_conflict_count = 0 and v_invalid_count = 0 then 'ready'
    else 'resolving'
  end;

  update public.relationship_imports
  set status = v_status,
      row_count = v_row_count,
      valid_row_count = v_valid_count,
      conflict_count = v_conflict_count + v_invalid_count,
      excluded_count = 0,
      committed_count = 0,
      updated_by_profile_id = v_actor
  where id = v_import.id;

  return private.get_relationship_import_preview(v_import.id);
end;
$$;

create or replace function private.resolve_relationship_import_conflicts(
  p_import_id uuid,
  p_resolutions jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_import_context(true);
  v_actor uuid := (v_context ->> 'actor_id')::uuid;
  v_tenant_id uuid := (v_context ->> 'tenant_id')::uuid;
  v_import public.relationship_imports%rowtype;
  v_row public.relationship_import_rows%rowtype;
  v_resolution jsonb;
  v_action text;
  v_selected_id uuid;
  v_corrected jsonb;
  v_evaluation jsonb;
  v_org_id uuid;
  v_org_candidate_count integer;
  v_contact_candidate_count integer;
  v_valid_count integer;
  v_conflict_count integer;
  v_excluded_count integer;
  v_status text;
begin
  if jsonb_typeof(p_resolutions) <> 'array' then
    raise exception 'Import resolutions must be a JSON array.' using errcode = '22023';
  end if;

  select *
  into v_import
  from public.relationship_imports import_batch
  where import_batch.id = p_import_id
    and import_batch.tenant_id = v_tenant_id
  for update;

  if not found then
    raise exception 'Relationship import not found.' using errcode = 'P0002';
  end if;
  if v_import.status = any (array['committing','completed','cancelled']::text[]) then
    raise exception 'Relationship import can no longer be resolved.' using errcode = '22023';
  end if;
  if p_expected_version is not null and p_expected_version <> v_import.version then
    raise exception 'Import changed after it was loaded. Refresh and retry.' using errcode = '40001';
  end if;

  for v_resolution in
    select value from jsonb_array_elements(p_resolutions)
  loop
    if jsonb_typeof(v_resolution) <> 'object' then
      raise exception 'Every import resolution must be a JSON object.' using errcode = '22023';
    end if;

    select *
    into v_row
    from public.relationship_import_rows import_row
    where import_row.import_id = v_import.id
      and import_row.tenant_id = v_import.tenant_id
      and import_row.row_number = coalesce(
        nullif(v_resolution ->> 'row', '')::integer,
        nullif(v_resolution ->> 'row_number', '')::integer
      )
    for update;

    if not found then
      raise exception 'Import resolution row was not found.' using errcode = 'P0002';
    end if;

    v_action := coalesce(
      nullif(v_resolution ->> 'decision', ''),
      nullif(v_resolution ->> 'action', '')
    );
    if v_action is null or v_action <> all (array[
      'link_organization','link_contact','create_organization','create_contact',
      'exclude','correct_source','defer'
    ]::text[]) then
      raise exception 'Invalid import conflict decision.' using errcode = '22023';
    end if;

    v_selected_id := coalesce(
      nullif(v_resolution ->> 'selectedCandidateId', '')::uuid,
      nullif(v_resolution ->> 'selected_candidate_id', '')::uuid
    );

    select count(*) filter (where candidate ->> 'entity' = 'organization'),
           count(*) filter (where candidate ->> 'entity' = 'contact')
    into v_org_candidate_count, v_contact_candidate_count
    from jsonb_array_elements(v_row.candidates) candidate;

    if v_action = 'link_organization' then
      if v_selected_id is null or not exists (
        select 1
        from jsonb_array_elements(v_row.candidates) candidate
        where candidate ->> 'entity' = 'organization'
          and (candidate ->> 'id')::uuid = v_selected_id
      ) then
        raise exception 'Select a valid organization candidate.' using errcode = '22023';
      end if;
      if v_contact_candidate_count > 0 then
        raise exception 'This row also matches an existing contact; resolve it by linking the contact.' using errcode = '22023';
      end if;

      update public.relationship_import_rows
      set decision = 'update',
          resolution = jsonb_build_object('action', v_action, 'organization_id', v_selected_id)
      where id = v_row.id;

    elsif v_action = 'link_contact' then
      if v_selected_id is null or not exists (
        select 1
        from jsonb_array_elements(v_row.candidates) candidate
        where candidate ->> 'entity' = 'contact'
          and (candidate ->> 'id')::uuid = v_selected_id
      ) then
        raise exception 'Select a valid contact candidate.' using errcode = '22023';
      end if;

      select affiliation.organization_id
      into v_org_id
      from public.relationship_contact_organizations affiliation
      where affiliation.tenant_id = v_import.tenant_id
        and affiliation.contact_id = v_selected_id
      order by affiliation.is_primary desc, affiliation.created_at
      limit 1;

      if v_org_id is null and v_org_candidate_count = 1 then
        select (candidate ->> 'id')::uuid
        into v_org_id
        from jsonb_array_elements(v_row.candidates) candidate
        where candidate ->> 'entity' = 'organization'
        limit 1;
      elsif v_org_id is null and v_org_candidate_count > 1 then
        raise exception 'Select the contact only after resolving which organization should be used.' using errcode = '22023';
      end if;

      update public.relationship_import_rows
      set decision = 'update',
          resolution = jsonb_strip_nulls(jsonb_build_object(
            'action', v_action,
            'contact_id', v_selected_id,
            'organization_id', v_org_id
          ))
      where id = v_row.id;

    elsif v_action = 'create_organization' then
      if v_contact_candidate_count > 0 then
        raise exception 'An existing contact matches this row; link the contact instead of creating a duplicate.' using errcode = '22023';
      end if;

      update public.relationship_import_rows
      set decision = 'create',
          resolution = jsonb_build_object('action', v_action, 'force_new_organization', true)
      where id = v_row.id;

    elsif v_action = 'create_contact' then
      if v_contact_candidate_count > 0 then
        raise exception 'An existing contact matches this row; link the contact instead of creating a duplicate.' using errcode = '22023';
      end if;

      v_org_id := null;
      if v_selected_id is not null then
        if not exists (
          select 1
          from jsonb_array_elements(v_row.candidates) candidate
          where candidate ->> 'entity' = 'organization'
            and (candidate ->> 'id')::uuid = v_selected_id
        ) then
          raise exception 'Select a valid organization candidate.' using errcode = '22023';
        end if;
        v_org_id := v_selected_id;
      elsif v_org_candidate_count = 1 then
        select (candidate ->> 'id')::uuid
        into v_org_id
        from jsonb_array_elements(v_row.candidates) candidate
        where candidate ->> 'entity' = 'organization'
        limit 1;
      elsif v_org_candidate_count > 1 then
        raise exception 'Select the organization for the new contact.' using errcode = '22023';
      end if;

      update public.relationship_import_rows
      set decision = 'create',
          resolution = jsonb_strip_nulls(jsonb_build_object(
            'action', v_action,
            'force_new_contact', true,
            'organization_id', v_org_id
          ))
      where id = v_row.id;

    elsif v_action = 'exclude' then
      update public.relationship_import_rows
      set decision = 'excluded',
          resolution = jsonb_build_object('action', v_action)
      where id = v_row.id;

    elsif v_action = 'defer' then
      update public.relationship_import_rows
      set decision = 'ambiguous',
          resolution = jsonb_build_object('action', v_action)
      where id = v_row.id;

    elsif v_action = 'correct_source' then
      v_corrected := coalesce(
        v_resolution -> 'correctedData',
        v_resolution -> 'corrected_data'
      );
      if v_corrected is null or jsonb_typeof(v_corrected) <> 'object' then
        raise exception 'Corrected source data must be a JSON object.' using errcode = '22023';
      end if;

      v_evaluation := private.evaluate_relationship_import_normalized(
        v_import.tenant_id,
        (v_row.normalized_data - 'website_domain') || v_corrected
      );

      update public.relationship_import_rows
      set normalized_data = v_evaluation -> 'normalized_data',
          decision = v_evaluation ->> 'decision',
          errors = array(select jsonb_array_elements_text(v_evaluation -> 'errors')),
          candidates = v_evaluation -> 'candidates',
          resolution = jsonb_build_object('action', v_action, 'corrected_data', v_corrected)
      where id = v_row.id;
    end if;
  end loop;

  select count(*) filter (where decision <> all (array['invalid','excluded']::text[])),
         count(*) filter (where decision = any (array['duplicate','ambiguous','invalid']::text[])),
         count(*) filter (where decision = 'excluded')
  into v_valid_count, v_conflict_count, v_excluded_count
  from public.relationship_import_rows
  where import_id = v_import.id
    and tenant_id = v_import.tenant_id;

  v_status := case when v_conflict_count = 0 then 'ready' else 'resolving' end;

  update public.relationship_imports
  set status = v_status,
      valid_row_count = v_valid_count,
      conflict_count = v_conflict_count,
      excluded_count = v_excluded_count,
      updated_by_profile_id = v_actor
  where id = v_import.id;

  return private.get_relationship_import_preview(v_import.id);
end;
$$;

create or replace function public.get_relationship_import_preview(
  p_import_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_relationship_import_preview(p_import_id);
$$;

create or replace function public.create_relationship_import_preview(
  p_filename text,
  p_source_type text,
  p_mapping jsonb,
  p_headers text[],
  p_rows jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.create_relationship_import_preview(
    p_filename, p_source_type, p_mapping, p_headers, p_rows
  );
$$;

create or replace function public.resolve_relationship_import_conflicts(
  p_import_id uuid,
  p_resolutions jsonb,
  p_expected_version bigint default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.resolve_relationship_import_conflicts(
    p_import_id, p_resolutions, p_expected_version
  );
$$;

grant usage on schema private to authenticated, service_role;

revoke all on function private.relationship_import_context(boolean) from public, anon;
grant execute on function private.relationship_import_context(boolean) to authenticated, service_role;
revoke all on function private.get_relationship_import_preview(uuid) from public, anon;
grant execute on function private.get_relationship_import_preview(uuid) to authenticated, service_role;
revoke all on function private.create_relationship_import_preview(text, text, jsonb, text[], jsonb) from public, anon;
grant execute on function private.create_relationship_import_preview(text, text, jsonb, text[], jsonb) to authenticated, service_role;
revoke all on function private.resolve_relationship_import_conflicts(uuid, jsonb, bigint) from public, anon;
grant execute on function private.resolve_relationship_import_conflicts(uuid, jsonb, bigint) to authenticated, service_role;

revoke all on function public.get_relationship_import_preview(uuid) from public, anon;
grant execute on function public.get_relationship_import_preview(uuid) to authenticated, service_role;
revoke all on function public.create_relationship_import_preview(text, text, jsonb, text[], jsonb) from public, anon;
grant execute on function public.create_relationship_import_preview(text, text, jsonb, text[], jsonb) to authenticated, service_role;
revoke all on function public.resolve_relationship_import_conflicts(uuid, jsonb, bigint) from public, anon;
grant execute on function public.resolve_relationship_import_conflicts(uuid, jsonb, bigint) to authenticated, service_role;

comment on function public.create_relationship_import_preview(text, text, jsonb, text[], jsonb) is
  'Creates a sanitized, tenant-scoped relationship import preview with duplicate and validation classification.';
comment on function public.resolve_relationship_import_conflicts(uuid, jsonb, bigint) is
  'Applies version-checked relationship import conflict decisions without writing relationship records.';
comment on function public.get_relationship_import_preview(uuid) is
  'Returns a sanitized relationship import preview; raw source rows are included only for CRM administrators.';
