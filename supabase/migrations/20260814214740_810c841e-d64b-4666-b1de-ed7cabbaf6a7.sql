-- =========================================================
-- Communications Control Plane: implementation feature flags
-- =========================================================
create table if not exists private.crm_control_plane_flags (
  tenant_id uuid not null,
  flag_name text not null,
  enabled boolean not null default false,
  updated_by_profile_id uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, flag_name)
);

insert into private.crm_control_plane_flags (tenant_id, flag_name, enabled)
select t.tenant_id, f.flag_name, false
from (select distinct tenant_id from private.relationship_feature_flags) t
cross join (values
  ('communications_control_plane_enabled'),
  ('campaign_trigger_engine_enabled'),
  ('client_trigger_cutover_enabled'),
  ('bty_trigger_cutover_enabled'),
  ('staff_campaigns_enabled'),
  ('donor_campaigns_enabled'),
  ('universal_newsletters_enabled'),
  ('newsletter_mailbox_suppression_enabled')
) as f(flag_name)
on conflict do nothing;

create or replace function public.list_crm_control_plane_flags()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(false);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'flagName', f.flag_name,
      'enabled', f.enabled,
      'updatedAt', f.updated_at
    ) order by f.flag_name)
    from private.crm_control_plane_flags f
    where f.tenant_id = v_tenant
  ), '[]'::jsonb);
end;
$$;

create or replace function public.set_crm_control_plane_flag(p_flag_name text, p_enabled boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_actor uuid := (v_context->>'actor_id')::uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_previous boolean;
begin
  if p_flag_name <> all (array[
    'communications_control_plane_enabled',
    'campaign_trigger_engine_enabled',
    'client_trigger_cutover_enabled',
    'bty_trigger_cutover_enabled',
    'staff_campaigns_enabled',
    'donor_campaigns_enabled',
    'universal_newsletters_enabled',
    'newsletter_mailbox_suppression_enabled'
  ]::text[]) then
    raise exception 'Unknown communications control plane flag: %', p_flag_name using errcode = '22023';
  end if;

  if v_reason is null then
    raise exception 'A reason is required to change a communications control plane flag.' using errcode = '22023';
  end if;

  select enabled into v_previous
  from private.crm_control_plane_flags
  where tenant_id = v_tenant and flag_name = p_flag_name;

  if p_enabled and p_flag_name = 'client_trigger_cutover_enabled'
     and not coalesce((select enabled from private.crm_control_plane_flags
                       where tenant_id = v_tenant and flag_name = 'campaign_trigger_engine_enabled'), false) then
    raise exception 'The campaign trigger engine must be enabled before cutting client triggers over.' using errcode = '22023';
  end if;

  if p_enabled and p_flag_name = 'bty_trigger_cutover_enabled'
     and not coalesce((select enabled from private.crm_control_plane_flags
                       where tenant_id = v_tenant and flag_name = 'campaign_trigger_engine_enabled'), false) then
    raise exception 'The campaign trigger engine must be enabled before cutting BTY triggers over.' using errcode = '22023';
  end if;

  insert into private.crm_control_plane_flags (tenant_id, flag_name, enabled, updated_by_profile_id, updated_at)
  values (v_tenant, p_flag_name, p_enabled, v_actor, now())
  on conflict (tenant_id, flag_name)
  do update set enabled = excluded.enabled,
                updated_by_profile_id = excluded.updated_by_profile_id,
                updated_at = now();

  insert into public.crm_activity_events (tenant_id, client_id, event_type, created_by_profile_id, metadata)
  values (v_tenant, null, 'communications_control_plane_flag_changed', v_actor, jsonb_build_object(
    'flag_name', p_flag_name,
    'previous_value', v_previous,
    'new_value', p_enabled,
    'reason', v_reason
  ));

  return jsonb_build_object('flagName', p_flag_name, 'enabled', p_enabled, 'previousValue', v_previous);
end;
$$;

revoke all on function public.list_crm_control_plane_flags() from public;
revoke all on function public.set_crm_control_plane_flag(text, boolean, text) from public;
grant execute on function public.list_crm_control_plane_flags() to authenticated;
grant execute on function public.set_crm_control_plane_flag(text, boolean, text) to authenticated;

-- =========================================================
-- Canonical person identity layer
-- =========================================================
create or replace function public.crm_normalize_email(p_value text)
returns text
language sql
immutable
set search_path to ''
as $$ select nullif(lower(btrim(coalesce(p_value, ''))), '') $$;

create or replace function public.crm_normalize_phone(p_value text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when digits is null then null
    when length(digits) = 10 then '+1' || digits
    when length(digits) = 11 and left(digits, 1) = '1' then '+' || digits
    else null
  end
  from (select nullif(regexp_replace(coalesce(p_value, ''), '\D', '', 'g'), '') as digits) s
$$;

create table if not exists public.crm_people (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  display_name text,
  primary_email text,
  primary_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.crm_people to authenticated;
grant all on public.crm_people to service_role;
alter table public.crm_people enable row level security;
create policy "crm_people_read" on public.crm_people
for select to authenticated
using (public.is_tenant_member(auth.uid(), tenant_id));

create table if not exists public.crm_person_identities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  person_id uuid not null references public.crm_people(id) on delete cascade,
  identity_kind text not null check (identity_kind in ('email', 'phone')),
  identity_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, identity_kind, identity_value)
);

create index if not exists crm_person_identities_person_idx on public.crm_person_identities (person_id);

grant select on public.crm_person_identities to authenticated;
grant all on public.crm_person_identities to service_role;
alter table public.crm_person_identities enable row level security;
create policy "crm_person_identities_read" on public.crm_person_identities
for select to authenticated
using (public.is_tenant_member(auth.uid(), tenant_id));

create table if not exists public.crm_person_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  person_id uuid not null references public.crm_people(id) on delete cascade,
  record_domain text not null check (record_domain in ('client', 'relationship_contact', 'provider_applicant', 'staff')),
  record_id uuid not null,
  match_basis text not null check (match_basis in ('email', 'phone', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, record_domain, record_id)
);

create index if not exists crm_person_records_person_idx on public.crm_person_records (person_id);

grant select on public.crm_person_records to authenticated;
grant all on public.crm_person_records to service_role;
alter table public.crm_person_records enable row level security;
create policy "crm_person_records_read" on public.crm_person_records
for select to authenticated
using (public.is_tenant_member(auth.uid(), tenant_id));

create or replace function public.crm_touch_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists crm_people_touch on public.crm_people;
create trigger crm_people_touch before update on public.crm_people
for each row execute function public.crm_touch_updated_at();

drop trigger if exists crm_person_identities_touch on public.crm_person_identities;
create trigger crm_person_identities_touch before update on public.crm_person_identities
for each row execute function public.crm_touch_updated_at();

drop trigger if exists crm_person_records_touch on public.crm_person_records;
create trigger crm_person_records_touch before update on public.crm_person_records
for each row execute function public.crm_touch_updated_at();

-- Source projection of every domain record that can carry an identity
create or replace view public.crm_person_source_records
with (security_invoker = on) as
select 'client'::text as record_domain,
       c.id as record_id,
       c.tenant_id,
       coalesce(nullif(btrim(coalesce(c.pat_name_preferred, '')), ''),
                btrim(coalesce(c.pat_name_f, '') || ' ' || coalesce(c.pat_name_l, ''))) as display_name,
       public.crm_normalize_email(c.email) as email_normalized,
       public.crm_normalize_phone(c.phone) as phone_normalized
from public.clients c
union all
select 'relationship_contact'::text,
       rc.id,
       rc.tenant_id,
       coalesce(nullif(btrim(coalesce(rc.preferred_name, '')), ''),
                btrim(coalesce(rc.first_name, '') || ' ' || coalesce(rc.last_name, ''))),
       public.crm_normalize_email(rc.email),
       public.crm_normalize_phone(rc.phone)
from public.relationship_contacts rc
union all
select 'provider_applicant'::text,
       pa.id,
       pa.tenant_id,
       btrim(coalesce(pa.first_name, '') || ' ' || coalesce(pa.last_name, '')),
       public.crm_normalize_email(pa.email),
       public.crm_normalize_phone(pa.phone)
from public.provider_applicants pa
union all
select 'staff'::text,
       s.id,
       s.tenant_id,
       btrim(coalesce(s.prov_name_f, '') || ' ' || coalesce(s.prov_name_l, '')),
       public.crm_normalize_email(p.email),
       public.crm_normalize_phone(s.prov_phone)
from public.staff s
left join public.profiles p on p.id = s.profile_id;

grant select on public.crm_person_source_records to authenticated;
grant select on public.crm_person_source_records to service_role;

-- Deterministic backfill / incremental reconciliation
create or replace function public.crm_reconcile_person_identities(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(not p_dry_run);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_actor uuid := (v_context->>'actor_id')::uuid;
  v_row record;
  v_person uuid;
  v_basis text;
  v_created int := 0;
  v_linked int := 0;
  v_reused int := 0;
  v_unresolvable int := 0;
begin
  for v_row in
    select r.*
    from public.crm_person_source_records r
    where r.tenant_id = v_tenant
      and (r.email_normalized is not null or r.phone_normalized is not null)
      and not exists (
        select 1 from public.crm_person_records pr
        where pr.tenant_id = v_tenant
          and pr.record_domain = r.record_domain
          and pr.record_id = r.record_id
      )
    order by r.record_domain, r.record_id
  loop
    v_person := null;
    v_basis := null;

    if v_row.email_normalized is not null then
      select i.person_id into v_person
      from public.crm_person_identities i
      where i.tenant_id = v_tenant and i.identity_kind = 'email' and i.identity_value = v_row.email_normalized;
      if v_person is not null then v_basis := 'email'; end if;
    end if;

    if v_person is null and v_row.phone_normalized is not null then
      select i.person_id into v_person
      from public.crm_person_identities i
      where i.tenant_id = v_tenant and i.identity_kind = 'phone' and i.identity_value = v_row.phone_normalized;
      if v_person is not null then v_basis := 'phone'; end if;
    end if;

    if v_person is not null then
      v_reused := v_reused + 1;
    else
      v_basis := case when v_row.email_normalized is not null then 'email' else 'phone' end;
      v_created := v_created + 1;
    end if;

    if p_dry_run then
      continue;
    end if;

    if v_person is null then
      insert into public.crm_people (tenant_id, display_name, primary_email, primary_phone)
      values (v_tenant, nullif(v_row.display_name, ''), v_row.email_normalized, v_row.phone_normalized)
      returning id into v_person;
    end if;

    if v_row.email_normalized is not null then
      insert into public.crm_person_identities (tenant_id, person_id, identity_kind, identity_value)
      values (v_tenant, v_person, 'email', v_row.email_normalized)
      on conflict (tenant_id, identity_kind, identity_value) do nothing;
    end if;

    if v_row.phone_normalized is not null then
      insert into public.crm_person_identities (tenant_id, person_id, identity_kind, identity_value)
      values (v_tenant, v_person, 'phone', v_row.phone_normalized)
      on conflict (tenant_id, identity_kind, identity_value) do nothing;
    end if;

    insert into public.crm_person_records (tenant_id, person_id, record_domain, record_id, match_basis)
    values (v_tenant, v_person, v_row.record_domain, v_row.record_id, v_basis)
    on conflict (tenant_id, record_domain, record_id) do nothing;

    v_linked := v_linked + 1;
  end loop;

  select count(*) into v_unresolvable
  from public.crm_person_source_records r
  where r.tenant_id = v_tenant
    and r.email_normalized is null
    and r.phone_normalized is null;

  if not p_dry_run then
    insert into public.crm_activity_events (tenant_id, client_id, event_type, created_by_profile_id, metadata)
    values (v_tenant, null, 'crm_person_identity_reconciled', v_actor, jsonb_build_object(
      'people_created', v_created,
      'records_linked', v_linked,
      'people_reused', v_reused,
      'records_without_identifier', v_unresolvable
    ));
  end if;

  return jsonb_build_object(
    'dryRun', p_dry_run,
    'peopleCreated', v_created,
    'peopleReused', v_reused,
    'recordsLinked', v_linked,
    'recordsWithoutIdentifier', v_unresolvable
  );
end;
$$;

create or replace function public.crm_person_identity_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(false);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
begin
  return jsonb_build_object(
    'people', (select count(*) from public.crm_people where tenant_id = v_tenant),
    'identities', (select count(*) from public.crm_person_identities where tenant_id = v_tenant),
    'linkedRecords', (select count(*) from public.crm_person_records where tenant_id = v_tenant),
    'byDomain', coalesce((
      select jsonb_object_agg(d.record_domain, d.total)
      from (
        select r.record_domain, count(*) as total
        from public.crm_person_source_records r
        where r.tenant_id = v_tenant
        group by r.record_domain
      ) d
    ), '{}'::jsonb),
    'linkedByDomain', coalesce((
      select jsonb_object_agg(d.record_domain, d.total)
      from (
        select pr.record_domain, count(*) as total
        from public.crm_person_records pr
        where pr.tenant_id = v_tenant
        group by pr.record_domain
      ) d
    ), '{}'::jsonb),
    'crossDomainPeople', (
      select count(*) from (
        select pr.person_id
        from public.crm_person_records pr
        where pr.tenant_id = v_tenant
        group by pr.person_id
        having count(distinct pr.record_domain) > 1
      ) x
    )
  );
end;
$$;

revoke all on function public.crm_reconcile_person_identities(boolean) from public;
revoke all on function public.crm_person_identity_overview() from public;
grant execute on function public.crm_reconcile_person_identities(boolean) to authenticated;
grant execute on function public.crm_person_identity_overview() to authenticated;
grant execute on function public.crm_normalize_email(text) to authenticated, anon, service_role;
grant execute on function public.crm_normalize_phone(text) to authenticated, anon, service_role;