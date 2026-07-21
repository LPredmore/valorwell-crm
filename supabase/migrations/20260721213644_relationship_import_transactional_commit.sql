alter table public.relationship_import_rows
  drop constraint relationship_import_rows_tenant_organization_fkey,
  drop constraint relationship_import_rows_tenant_contact_fkey,
  drop constraint relationship_import_rows_tenant_opportunity_fkey;

alter table public.relationship_import_rows
  add constraint relationship_import_rows_tenant_organization_fkey
    foreign key (tenant_id, committed_organization_id)
    references public.relationship_organizations(tenant_id, id)
    on delete set null (committed_organization_id),
  add constraint relationship_import_rows_tenant_contact_fkey
    foreign key (tenant_id, committed_contact_id)
    references public.relationship_contacts(tenant_id, id)
    on delete set null (committed_contact_id),
  add constraint relationship_import_rows_tenant_opportunity_fkey
    foreign key (tenant_id, committed_opportunity_id)
    references public.relationship_opportunities(tenant_id, id)
    on delete set null (committed_opportunity_id);

create or replace function private.commit_relationship_import(
  p_import_id uuid,
  p_expected_version bigint,
  p_idempotency_key text
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
  v_data jsonb;
  v_resolution jsonb;
  v_action text;
  v_org_id uuid;
  v_contact_id uuid;
  v_opportunity_id uuid;
  v_existing_id uuid;
  v_org_name text;
  v_website text;
  v_domain text;
  v_contact_name text;
  v_contact_email text;
  v_contact_phone text;
  v_contact_title text;
  v_contact_kind text;
  v_role_code text;
  v_role_applies_to text;
  v_social_platform text;
  v_social_handle text;
  v_social_url text;
  v_source_category text;
  v_source_summary text;
  v_bty_status text;
  v_bty_cause_area text;
  v_audience_reach numeric;
  v_state text;
  v_organization_type text;
  v_veteran_affiliated boolean;
  v_has_contact_data boolean;
  v_force_new_org boolean;
  v_force_new_contact boolean;
  v_is_primary boolean;
  v_committed_count integer := 0;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'An import commit idempotency key is required.' using errcode = '22023';
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

  if v_import.status = 'completed' then
    return private.get_relationship_import_preview(v_import.id);
  end if;

  if p_expected_version is not null and p_expected_version <> v_import.version then
    raise exception 'Import changed after it was loaded. Refresh and retry.' using errcode = '40001';
  end if;

  if v_import.status <> 'ready' then
    raise exception 'Relationship import must be fully resolved before commit.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.relationship_import_rows import_row
    where import_row.import_id = v_import.id
      and import_row.tenant_id = v_import.tenant_id
      and import_row.decision = any (array['duplicate','ambiguous','invalid']::text[])
  ) then
    raise exception 'Relationship import still contains unresolved rows.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.relationship_imports other_import
    where other_import.tenant_id = v_import.tenant_id
      and other_import.commit_idempotency_key = btrim(p_idempotency_key)
      and other_import.id <> v_import.id
  ) then
    raise exception 'Import idempotency key was already used for another batch.' using errcode = '23505';
  end if;

  update public.relationship_imports
  set status = 'committing',
      commit_idempotency_key = btrim(p_idempotency_key),
      commit_started_at = now(),
      error_summary = null,
      updated_by_profile_id = v_actor
  where id = v_import.id;

  for v_row in
    select *
    from public.relationship_import_rows import_row
    where import_row.import_id = v_import.id
      and import_row.tenant_id = v_import.tenant_id
    order by import_row.row_number
    for update
  loop
    if v_row.decision = 'excluded' then
      continue;
    end if;

    if v_row.decision <> all (array['create','update']::text[]) then
      raise exception 'Import row % is not ready to commit.', v_row.row_number using errcode = '22023';
    end if;

    v_data := v_row.normalized_data;
    v_resolution := v_row.resolution;
    v_action := nullif(v_resolution ->> 'action', '');
    v_org_id := nullif(v_resolution ->> 'organization_id', '')::uuid;
    v_contact_id := nullif(v_resolution ->> 'contact_id', '')::uuid;
    v_opportunity_id := null;
    v_org_name := nullif(btrim(v_data ->> 'organization_name'), '');
    v_website := nullif(btrim(v_data ->> 'website'), '');
    v_domain := private.relationship_import_domain(v_website);
    v_contact_name := nullif(btrim(v_data ->> 'contact_name'), '');
    v_contact_email := nullif(lower(btrim(v_data ->> 'contact_email')), '');
    v_contact_phone := nullif(btrim(v_data ->> 'contact_phone'), '');
    v_contact_title := nullif(btrim(v_data ->> 'contact_title'), '');
    v_contact_kind := coalesce(nullif(lower(btrim(v_data ->> 'contact_kind')), ''), 'person');
    v_role_code := nullif(lower(btrim(v_data ->> 'role_code')), '');
    v_social_platform := nullif(lower(btrim(v_data ->> 'social_platform')), '');
    v_social_handle := nullif(lower(btrim(v_data ->> 'social_handle')), '');
    v_social_url := nullif(btrim(v_data ->> 'social_url'), '');
    v_source_category := nullif(btrim(v_data ->> 'source_category'), '');
    v_source_summary := nullif(btrim(v_data ->> 'source_summary'), '');
    v_bty_status := coalesce(nullif(lower(btrim(v_data ->> 'bty_status')), ''), 'identified');
    v_bty_cause_area := nullif(btrim(v_data ->> 'bty_cause_area'), '');
    v_state := nullif(upper(btrim(v_data ->> 'state')), '');
    v_organization_type := nullif(btrim(v_data ->> 'organization_type'), '');
    v_veteran_affiliated := case
      when jsonb_typeof(v_data -> 'veteran_affiliation') = 'boolean'
        then (v_data ->> 'veteran_affiliation')::boolean
      else null
    end;
    v_audience_reach := case
      when jsonb_typeof(v_data -> 'bty_audience_reach') = 'number'
        then (v_data ->> 'bty_audience_reach')::numeric
      else null
    end;
    v_has_contact_data := num_nonnulls(
      v_contact_name, v_contact_email, v_contact_phone, v_contact_title,
      nullif(v_data ->> 'contact_kind', '')
    ) > 0;
    v_force_new_org := coalesce((v_resolution ->> 'force_new_organization')::boolean, false);
    v_force_new_contact := coalesce((v_resolution ->> 'force_new_contact')::boolean, false);

    if v_org_name is null then
      raise exception 'Import row % has no organization name.', v_row.row_number using errcode = '22023';
    end if;

    if v_org_id is not null then
      if not exists (
        select 1
        from public.relationship_organizations organization
        where organization.id = v_org_id
          and organization.tenant_id = v_import.tenant_id
      ) then
        raise exception 'Resolved organization is no longer available for row %.', v_row.row_number using errcode = '40001';
      end if;
    else
      if not v_force_new_org then
        select organization.id
        into v_existing_id
        from public.relationship_organizations organization
        where organization.tenant_id = v_import.tenant_id
          and (
            (v_domain is not null and private.relationship_import_domain(organization.website) = v_domain)
            or lower(regexp_replace(btrim(organization.name), '\s+', ' ', 'g'))
               = lower(regexp_replace(v_org_name, '\s+', ' ', 'g'))
          )
        order by
          case when v_domain is not null
                    and private.relationship_import_domain(organization.website) = v_domain
               then 0 else 1 end,
          organization.created_at
        limit 1;

        if v_existing_id is not null then
          raise exception 'A matching organization appeared after preview for row %. Refresh and resolve the import again.', v_row.row_number
            using errcode = '40001';
        end if;
      end if;

      insert into public.relationship_organizations (
        tenant_id, name, website, organization_kind, veteran_affiliated,
        outreach_status, relationship_stage, source, source_record_key,
        metadata, created_by_profile_id, updated_by_profile_id
      ) values (
        v_import.tenant_id,
        v_org_name,
        v_website,
        v_organization_type,
        v_veteran_affiliated,
        'new',
        'identified',
        'crm_import',
        format('import:%s:row:%s:organization', v_import.id, v_row.row_number),
        jsonb_strip_nulls(jsonb_build_object(
          'import_id', v_import.id,
          'import_row', v_row.row_number,
          'state', v_state,
          'source_type', v_import.source_type
        )),
        v_actor,
        v_actor
      )
      on conflict (tenant_id, source, source_record_key)
        where source_record_key is not null
      do update set updated_at = excluded.updated_at
      returning id into v_org_id;
    end if;

    if v_contact_id is not null then
      if not exists (
        select 1
        from public.relationship_contacts contact
        where contact.id = v_contact_id
          and contact.tenant_id = v_import.tenant_id
      ) then
        raise exception 'Resolved contact is no longer available for row %.', v_row.row_number using errcode = '40001';
      end if;
    elsif v_has_contact_data then
      if v_contact_email is not null then
        select contact.id
        into v_existing_id
        from public.relationship_contacts contact
        where contact.tenant_id = v_import.tenant_id
          and lower(contact.email) = v_contact_email
        limit 1;

        if v_existing_id is not null then
          raise exception 'A matching contact appeared after preview for row %. Refresh and resolve the import again.', v_row.row_number
            using errcode = '40001';
        end if;
      end if;

      if v_force_new_contact and v_contact_email is null and v_contact_name is null then
        raise exception 'A new contact requires a name or email on row %.', v_row.row_number using errcode = '22023';
      end if;

      insert into public.relationship_contacts (
        tenant_id, preferred_name, email, phone, state, veteran_affiliation,
        outreach_status, relationship_stage, source, source_record_key,
        metadata, created_by_profile_id, updated_by_profile_id
      ) values (
        v_import.tenant_id,
        v_contact_name,
        v_contact_email,
        v_contact_phone,
        v_state,
        'unknown',
        'new',
        'identified',
        'crm_import',
        format('import:%s:row:%s:contact', v_import.id, v_row.row_number),
        jsonb_strip_nulls(jsonb_build_object(
          'import_id', v_import.id,
          'import_row', v_row.row_number,
          'contact_kind', v_contact_kind,
          'source_type', v_import.source_type
        )),
        v_actor,
        v_actor
      )
      on conflict (tenant_id, source, source_record_key)
        where source_record_key is not null
      do update set updated_at = excluded.updated_at
      returning id into v_contact_id;
    end if;

    if v_contact_id is not null then
      select not exists (
        select 1
        from public.relationship_contact_organizations affiliation
        where affiliation.tenant_id = v_import.tenant_id
          and affiliation.contact_id = v_contact_id
          and affiliation.is_primary
      )
      into v_is_primary;

      insert into public.relationship_contact_organizations (
        tenant_id, contact_id, organization_id, role_title, is_primary, metadata
      ) values (
        v_import.tenant_id,
        v_contact_id,
        v_org_id,
        v_contact_title,
        v_is_primary,
        jsonb_build_object('import_id', v_import.id, 'import_row', v_row.row_number)
      )
      on conflict (contact_id, organization_id)
      do update set
        role_title = coalesce(excluded.role_title, relationship_contact_organizations.role_title),
        metadata = relationship_contact_organizations.metadata || excluded.metadata,
        updated_at = now();
    end if;

    if v_role_code is not null then
      select catalog.applies_to
      into v_role_applies_to
      from public.relationship_role_catalog catalog
      where catalog.code = v_role_code
        and catalog.is_active;

      if v_role_applies_to is null then
        raise exception 'Role code % is no longer active for row %.', v_role_code, v_row.row_number using errcode = '40001';
      end if;

      if v_contact_id is not null and v_role_applies_to = any (array['contact','both']::text[]) then
        insert into public.relationship_contact_roles (
          tenant_id, contact_id, role_code, source, metadata
        ) values (
          v_import.tenant_id, v_contact_id, v_role_code, 'crm_import',
          jsonb_build_object('import_id', v_import.id, 'import_row', v_row.row_number)
        )
        on conflict (contact_id, role_code)
        do update set
          source = excluded.source,
          metadata = relationship_contact_roles.metadata || excluded.metadata,
          updated_at = now();
      elsif v_role_applies_to = any (array['organization','both']::text[]) then
        insert into public.relationship_organization_roles (
          tenant_id, organization_id, role_code, source, metadata
        ) values (
          v_import.tenant_id, v_org_id, v_role_code, 'crm_import',
          jsonb_build_object('import_id', v_import.id, 'import_row', v_row.row_number)
        )
        on conflict (organization_id, role_code)
        do update set
          source = excluded.source,
          metadata = relationship_organization_roles.metadata || excluded.metadata,
          updated_at = now();
      else
        raise exception 'Role code % does not apply to the imported subject on row %.', v_role_code, v_row.row_number
          using errcode = '22023';
      end if;
    end if;

    if v_social_platform is not null and num_nonnulls(v_social_handle, v_social_url) > 0 then
      insert into public.relationship_social_profiles (
        tenant_id, contact_id, organization_id, platform_name, handle,
        profile_url, follower_count, source, source_record_key, metadata
      ) values (
        v_import.tenant_id,
        case when v_contact_id is not null then v_contact_id else null end,
        case when v_contact_id is null then v_org_id else null end,
        v_social_platform,
        v_social_handle,
        v_social_url,
        case when v_audience_reach is not null then floor(v_audience_reach)::bigint else null end,
        'crm_import',
        format('import:%s:row:%s:social', v_import.id, v_row.row_number),
        jsonb_build_object('import_id', v_import.id, 'import_row', v_row.row_number)
      )
      on conflict (tenant_id, source, source_record_key)
        where source_record_key is not null
      do update set
        handle = excluded.handle,
        profile_url = excluded.profile_url,
        follower_count = excluded.follower_count,
        metadata = relationship_social_profiles.metadata || excluded.metadata,
        updated_at = now();
    end if;

    if v_source_category is not null and v_source_summary is not null then
      insert into public.relationship_referrals (
        tenant_id, organization_id, contact_id, source_category, summary,
        evidence_urls, verified, disclosure, metadata,
        created_by_profile_id, updated_by_profile_id
      ) values (
        v_import.tenant_id,
        v_org_id,
        v_contact_id,
        v_source_category,
        v_source_summary,
        '{}'::text[],
        false,
        'internal',
        jsonb_build_object('import_id', v_import.id, 'import_row', v_row.row_number),
        v_actor,
        v_actor
      );
    end if;

    if (v_data ? 'bty_status')
       or (v_data ? 'bty_cause_area')
       or (v_data ? 'bty_audience_reach')
       or v_role_code = any (array['bty_nominee','bty_promoter','bty_story_submitter']::text[]) then
      insert into public.relationship_opportunities (
        tenant_id, organization_id, primary_contact_id, status,
        cause_area, veteran_priority, qualification, review_status,
        metadata, created_by_profile_id, updated_by_profile_id
      ) values (
        v_import.tenant_id,
        v_org_id,
        v_contact_id,
        v_bty_status,
        v_bty_cause_area,
        coalesce(v_veteran_affiliated, false),
        jsonb_strip_nulls(jsonb_build_object(
          'audience_reach', v_audience_reach,
          'import_id', v_import.id,
          'import_row', v_row.row_number
        )),
        'unreviewed',
        jsonb_build_object('import_id', v_import.id, 'import_row', v_row.row_number),
        v_actor,
        v_actor
      )
      returning id into v_opportunity_id;
    end if;

    insert into public.relationship_interactions (
      tenant_id, organization_id, contact_id, opportunity_id,
      interaction_type, occurred_at, summary, metadata,
      created_by_profile_id, updated_by_profile_id
    ) values (
      v_import.tenant_id,
      v_org_id,
      v_contact_id,
      v_opportunity_id,
      'import',
      now(),
      format('Relationship import row %s committed.', v_row.row_number),
      jsonb_build_object(
        'import_id', v_import.id,
        'import_row', v_row.row_number,
        'resolution_action', v_action,
        'source_type', v_import.source_type
      ),
      v_actor,
      v_actor
    );

    update public.relationship_import_rows
    set committed_organization_id = v_org_id,
        committed_contact_id = v_contact_id,
        committed_opportunity_id = v_opportunity_id
    where id = v_row.id;

    v_committed_count := v_committed_count + 1;
  end loop;

  update public.relationship_imports
  set status = 'completed',
      committed_count = v_committed_count,
      completed_at = now(),
      updated_by_profile_id = v_actor
  where id = v_import.id;

  return private.get_relationship_import_preview(v_import.id);
end;
$$;

create or replace function public.commit_relationship_import(
  p_import_id uuid,
  p_expected_version bigint,
  p_idempotency_key text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.commit_relationship_import(
    p_import_id, p_expected_version, p_idempotency_key
  );
$$;

revoke all on function private.commit_relationship_import(uuid, bigint, text) from public, anon;
grant execute on function private.commit_relationship_import(uuid, bigint, text) to authenticated, service_role;
revoke all on function public.commit_relationship_import(uuid, bigint, text) from public, anon;
grant execute on function public.commit_relationship_import(uuid, bigint, text) to authenticated, service_role;

comment on function public.commit_relationship_import(uuid, bigint, text) is
  'Idempotent, version-checked, transactional commit of resolved non-clinical relationship import rows.';
