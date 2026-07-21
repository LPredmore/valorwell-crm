create table public.relationship_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  filename text not null,
  source_type text not null default 'csv',
  status text not null default 'draft',
  mapping jsonb not null default '{}'::jsonb,
  headers text[] not null default '{}'::text[],
  row_count integer not null default 0,
  valid_row_count integer not null default 0,
  conflict_count integer not null default 0,
  excluded_count integer not null default 0,
  committed_count integer not null default 0,
  error_summary text,
  version bigint not null default 1,
  commit_idempotency_key text,
  commit_started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_imports_tenant_id_id_key unique (tenant_id, id),
  constraint relationship_imports_filename_check check (length(btrim(filename)) > 0),
  constraint relationship_imports_source_type_check check (length(btrim(source_type)) > 0),
  constraint relationship_imports_status_check check (
    status = any (array[
      'draft','previewed','resolving','ready','committing','completed','failed','cancelled'
    ]::text[])
  ),
  constraint relationship_imports_mapping_check check (jsonb_typeof(mapping) = 'object'),
  constraint relationship_imports_counts_check check (
    row_count >= 0 and valid_row_count >= 0 and conflict_count >= 0
    and excluded_count >= 0 and committed_count >= 0
    and valid_row_count + excluded_count <= row_count
    and conflict_count <= row_count
    and committed_count <= row_count
  ),
  constraint relationship_imports_version_check check (version > 0),
  constraint relationship_imports_completion_check check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed')
  )
);

create table public.relationship_import_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  import_id uuid not null,
  row_number integer not null,
  raw_data jsonb not null,
  normalized_data jsonb not null default '{}'::jsonb,
  decision text not null,
  errors text[] not null default '{}'::text[],
  candidates jsonb not null default '[]'::jsonb,
  resolution jsonb not null default '{}'::jsonb,
  committed_organization_id uuid,
  committed_contact_id uuid,
  committed_opportunity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_import_rows_tenant_import_fkey
    foreign key (tenant_id, import_id)
    references public.relationship_imports(tenant_id, id) on delete cascade,
  constraint relationship_import_rows_tenant_organization_fkey
    foreign key (tenant_id, committed_organization_id)
    references public.relationship_organizations(tenant_id, id) on delete set null,
  constraint relationship_import_rows_tenant_contact_fkey
    foreign key (tenant_id, committed_contact_id)
    references public.relationship_contacts(tenant_id, id) on delete set null,
  constraint relationship_import_rows_tenant_opportunity_fkey
    foreign key (tenant_id, committed_opportunity_id)
    references public.relationship_opportunities(tenant_id, id) on delete set null,
  constraint relationship_import_rows_row_number_check check (row_number > 0),
  constraint relationship_import_rows_raw_data_check check (jsonb_typeof(raw_data) = 'object'),
  constraint relationship_import_rows_normalized_data_check check (jsonb_typeof(normalized_data) = 'object'),
  constraint relationship_import_rows_candidates_check check (jsonb_typeof(candidates) = 'array'),
  constraint relationship_import_rows_resolution_check check (jsonb_typeof(resolution) = 'object'),
  constraint relationship_import_rows_decision_check check (
    decision = any (array['create','update','duplicate','ambiguous','invalid','excluded']::text[])
  ),
  constraint relationship_import_rows_import_row_key unique (import_id, row_number)
);

create index relationship_imports_tenant_status_updated_idx
  on public.relationship_imports (tenant_id, status, updated_at desc);
create index relationship_imports_tenant_created_idx
  on public.relationship_imports (tenant_id, created_at desc);
create unique index relationship_imports_commit_idempotency_idx
  on public.relationship_imports (tenant_id, commit_idempotency_key)
  where commit_idempotency_key is not null;
create index relationship_import_rows_import_decision_idx
  on public.relationship_import_rows (tenant_id, import_id, decision, row_number);
create index relationship_import_rows_committed_org_idx
  on public.relationship_import_rows (tenant_id, committed_organization_id)
  where committed_organization_id is not null;
create index relationship_import_rows_committed_contact_idx
  on public.relationship_import_rows (tenant_id, committed_contact_id)
  where committed_contact_id is not null;

create or replace function public.set_relationship_import_audit_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.filename := btrim(new.filename);
    new.source_type := lower(btrim(new.source_type));
    new.created_by_profile_id := coalesce(v_actor, new.created_by_profile_id);
    new.updated_by_profile_id := coalesce(v_actor, new.updated_by_profile_id, new.created_by_profile_id);
    new.version := 1;
  else
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'Import tenant cannot be changed.' using errcode = '22023';
    end if;
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by_profile_id := old.created_by_profile_id;
    new.updated_by_profile_id := coalesce(v_actor, new.updated_by_profile_id, old.updated_by_profile_id);
    new.updated_at := now();
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

create trigger set_relationship_imports_audit_fields
before insert or update on public.relationship_imports
for each row execute function public.set_relationship_import_audit_fields();

create or replace function public.touch_relationship_import_row()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id
       or new.import_id is distinct from old.import_id
       or new.row_number is distinct from old.row_number then
      raise exception 'Import row identity cannot be changed.' using errcode = '22023';
    end if;
    new.id := old.id;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger touch_relationship_import_rows
before update on public.relationship_import_rows
for each row execute function public.touch_relationship_import_row();

create schema if not exists private;

create or replace function private.relationship_import_domain(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    split_part(
      regexp_replace(
        regexp_replace(lower(btrim(coalesce(p_value, ''))), '^https?://', '', 'i'),
        '^www\.', '', 'i'
      ),
      '/',
      1
    ),
    ''
  );
$$;

create or replace function private.relationship_import_map_row(
  p_raw jsonb,
  p_mapping jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_header text;
  v_field text;
  v_value text;
  v_boolean boolean;
  v_reach numeric;
begin
  if jsonb_typeof(p_raw) <> 'object' or jsonb_typeof(p_mapping) <> 'object' then
    raise exception 'Import rows and mapping must be JSON objects.' using errcode = '22023';
  end if;

  for v_header, v_field in
    select key, value
    from jsonb_each_text(p_mapping)
  loop
    if v_field = 'ignore' then
      continue;
    end if;

    v_value := btrim(coalesce(p_raw ->> v_header, ''));
    if v_value = '' then
      continue;
    end if;

    if v_field = 'organization_name' then
      v_value := regexp_replace(v_value, '\s+', ' ', 'g');
    elsif v_field in ('website','contact_email','contact_kind','role_code','bty_status','social_platform') then
      v_value := lower(v_value);
    elsif v_field = 'state' then
      v_value := upper(v_value);
    elsif v_field = 'social_handle' then
      v_value := lower(regexp_replace(v_value, '^@', ''));
    elsif v_field = 'veteran_affiliation' then
      if lower(v_value) = any (array['yes','y','true','1']::text[]) then
        v_boolean := true;
        v_result := v_result || jsonb_build_object(v_field, v_boolean);
        continue;
      elsif lower(v_value) = any (array['no','n','false','0']::text[]) then
        v_boolean := false;
        v_result := v_result || jsonb_build_object(v_field, v_boolean);
        continue;
      end if;
    elsif v_field = 'bty_audience_reach' then
      if regexp_replace(v_value, '[,\s]', '', 'g') ~ '^[0-9]+(\.[0-9]+)?$' then
        v_reach := regexp_replace(v_value, '[,\s]', '', 'g')::numeric;
        v_result := v_result || jsonb_build_object(v_field, v_reach);
        continue;
      end if;
    end if;

    v_result := v_result || jsonb_build_object(v_field, v_value);
  end loop;

  return v_result;
end;
$$;

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
  v_email text := nullif(lower(btrim(v_normalized ->> 'contact_email')), '');
  v_role_code text := nullif(lower(btrim(v_normalized ->> 'role_code')), '');
  v_contact_kind text := nullif(lower(btrim(v_normalized ->> 'contact_kind')), '');
  v_bty_status text := nullif(lower(btrim(v_normalized ->> 'bty_status')), '');
  v_veteran_text text := nullif(lower(btrim(v_normalized ->> 'veteran_affiliation')), '');
  v_decision text;
begin
  if jsonb_typeof(v_normalized) <> 'object' then
    raise exception 'Normalized import row must be a JSON object.' using errcode = '22023';
  end if;

  if v_org_name is null then
    v_errors := array_append(v_errors, 'Organization name is required.');
  else
    v_normalized := jsonb_set(v_normalized, '{organization_name}', to_jsonb(regexp_replace(v_org_name, '\s+', ' ', 'g')), true);
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

  if v_bty_status is not null and v_bty_status <> all (array[
    'identified','researching','qualified','ready_for_campaign','contacted','responded',
    'interested','recording_planned','booked','declined','nurture','disqualified','completed'
  ]::text[]) then
    v_errors := array_append(v_errors, 'BTY status is invalid.');
  end if;

  if v_role_code is not null and not exists (
    select 1
    from public.relationship_role_catalog catalog
    where catalog.code = v_role_code
      and catalog.is_active
  ) then
    v_errors := array_append(v_errors, 'Role code is not active in the relationship role catalog.');
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

alter table public.relationship_imports enable row level security;
alter table public.relationship_import_rows enable row level security;

create policy relationship_imports_crm_select
on public.relationship_imports
for select
to authenticated
using (
  exists (
    select 1
    from public.crm_user_capabilities capability
    where capability.profile_id = (select auth.uid())
      and capability.tenant_id = relationship_imports.tenant_id
      and capability.crm_role <> 'crm_none'::public.crm_capability_role
  )
);

create policy relationship_import_rows_admin_select
on public.relationship_import_rows
for select
to authenticated
using (
  exists (
    select 1
    from public.crm_user_capabilities capability
    where capability.profile_id = (select auth.uid())
      and capability.tenant_id = relationship_import_rows.tenant_id
      and capability.crm_role = 'crm_admin'::public.crm_capability_role
  )
);

revoke all on table public.relationship_imports from public, anon, authenticated;
grant select on table public.relationship_imports to authenticated;
grant all on table public.relationship_imports to service_role;

revoke all on table public.relationship_import_rows from public, anon, authenticated;
grant select on table public.relationship_import_rows to authenticated;
grant all on table public.relationship_import_rows to service_role;

revoke all on function public.set_relationship_import_audit_fields() from public, anon, authenticated;
revoke all on function public.touch_relationship_import_row() from public, anon, authenticated;
revoke all on function private.relationship_import_domain(text) from public, anon, authenticated;
revoke all on function private.relationship_import_map_row(jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.evaluate_relationship_import_normalized(uuid, jsonb) from public, anon, authenticated;

comment on table public.relationship_imports is
  'Non-clinical Business Development import batches. Raw rows are isolated from clinical and inbound-interest records.';
comment on table public.relationship_import_rows is
  'Row-level import preview, conflict, resolution, and commit state. Direct authenticated access is admin-only.';
