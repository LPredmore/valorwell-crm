create table public.relationship_referrals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  organization_id uuid,
  contact_id uuid,
  source_category text not null,
  summary text not null,
  evidence_urls text[] not null default '{}'::text[],
  verified boolean not null default false,
  verified_at timestamptz,
  verified_by_profile_id uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  disclosure text not null default 'internal',
  named_referrer text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_referrals_subject_check check (num_nonnulls(organization_id, contact_id) >= 1),
  constraint relationship_referrals_source_category_check check (length(btrim(source_category)) > 0),
  constraint relationship_referrals_summary_check check (length(btrim(summary)) > 0),
  constraint relationship_referrals_disclosure_check check (disclosure = any (array['internal','community_anonymous','named_referrer','compliance_review']::text[])),
  constraint relationship_referrals_named_referrer_check check ((disclosure = 'named_referrer' and nullif(btrim(named_referrer), '') is not null) or (disclosure <> 'named_referrer' and named_referrer is null)),
  constraint relationship_referrals_verification_check check ((verified and verified_at is not null and verified_by_profile_id is not null) or (not verified and verified_at is null and verified_by_profile_id is null)),
  constraint relationship_referrals_revocation_check check (revoked_at is null or verified),
  constraint relationship_referrals_tenant_organization_fkey foreign key (tenant_id, organization_id) references public.relationship_organizations(tenant_id, id) on delete cascade,
  constraint relationship_referrals_tenant_contact_fkey foreign key (tenant_id, contact_id) references public.relationship_contacts(tenant_id, id) on delete cascade
);

create index relationship_referrals_tenant_created_idx on public.relationship_referrals (tenant_id, created_at desc);
create index relationship_referrals_organization_created_idx on public.relationship_referrals (tenant_id, organization_id, created_at desc) where organization_id is not null;
create index relationship_referrals_contact_created_idx on public.relationship_referrals (tenant_id, contact_id, created_at desc) where contact_id is not null;
create index relationship_referrals_verification_idx on public.relationship_referrals (tenant_id, verified, revoked_at, updated_at desc);
create index relationship_referrals_source_category_idx on public.relationship_referrals (tenant_id, source_category);

create or replace function public.set_relationship_referral_audit_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.created_by_profile_id := coalesce(v_actor, new.created_by_profile_id);
    new.updated_by_profile_id := coalesce(v_actor, new.updated_by_profile_id, new.created_by_profile_id);
  else
    new.created_by_profile_id := old.created_by_profile_id;
    new.updated_by_profile_id := coalesce(v_actor, new.updated_by_profile_id, old.updated_by_profile_id);
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger set_relationship_referrals_audit_fields
before insert or update on public.relationship_referrals
for each row execute function public.set_relationship_referral_audit_fields();

alter table public.relationship_referrals enable row level security;

create policy relationship_referrals_crm_select
on public.relationship_referrals
for select
to authenticated
using (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = relationship_referrals.tenant_id
      and capability.crm_role <> 'crm_none'::public.crm_capability_role
  )
);

create policy relationship_referrals_crm_insert
on public.relationship_referrals
for insert
to authenticated
with check (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = relationship_referrals.tenant_id
      and capability.crm_role = any (array['crm_admin','crm_operator']::public.crm_capability_role[])
  )
  and created_by_profile_id = auth.uid()
  and updated_by_profile_id = auth.uid()
);

create policy relationship_referrals_crm_update
on public.relationship_referrals
for update
to authenticated
using (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = relationship_referrals.tenant_id
      and capability.crm_role = any (array['crm_admin','crm_operator']::public.crm_capability_role[])
  )
)
with check (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = relationship_referrals.tenant_id
      and capability.crm_role = any (array['crm_admin','crm_operator']::public.crm_capability_role[])
  )
  and updated_by_profile_id = auth.uid()
);

create or replace function public.verify_relationship_referral(
  p_referral_id uuid,
  p_verified boolean,
  p_disclosure text,
  p_verified_at timestamptz default now(),
  p_notes text default null
)
returns public.relationship_referrals
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_referral public.relationship_referrals%rowtype;
begin
  if v_actor is null then
    raise exception 'Authenticated CRM access is required.' using errcode = '42501';
  end if;
  if p_disclosure is null or not (p_disclosure = any (array['internal','community_anonymous','named_referrer','compliance_review']::text[])) then
    raise exception 'Invalid referral disclosure.' using errcode = '22023';
  end if;
  select * into v_referral from public.relationship_referrals where id = p_referral_id for update;
  if not found then
    raise exception 'Relationship referral not found.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = v_actor
      and capability.tenant_id = v_referral.tenant_id
      and capability.crm_role = any (array['crm_admin','crm_operator']::public.crm_capability_role[])
  ) then
    raise exception 'You do not have permission to verify relationship referrals.' using errcode = '42501';
  end if;
  if p_disclosure = 'named_referrer' and nullif(btrim(v_referral.named_referrer), '') is null then
    raise exception 'A named referrer is required for named disclosure.' using errcode = '22023';
  end if;
  update public.relationship_referrals
  set verified = p_verified,
      verified_at = case when p_verified then coalesce(p_verified_at, now()) else null end,
      verified_by_profile_id = case when p_verified then v_actor else null end,
      revoked_at = null,
      disclosure = p_disclosure,
      notes = case when p_notes is null then notes else nullif(btrim(p_notes), '') end,
      updated_by_profile_id = v_actor
  where id = p_referral_id
  returning * into v_referral;
  insert into public.relationship_interactions (
    tenant_id, organization_id, contact_id, interaction_type, occurred_at,
    summary, metadata, created_by_profile_id, updated_by_profile_id
  ) values (
    v_referral.tenant_id, v_referral.organization_id, v_referral.contact_id,
    'referral_verification', coalesce(p_verified_at, now()),
    case when p_verified then 'Relationship referral verified.' else 'Relationship referral verification cleared.' end,
    jsonb_build_object('referral_id', v_referral.id, 'verified', p_verified, 'disclosure', p_disclosure),
    v_actor, v_actor
  );
  return v_referral;
end;
$$;

create or replace function public.revoke_relationship_referral(
  p_referral_id uuid,
  p_revoked_at timestamptz default now(),
  p_note text default null
)
returns public.relationship_referrals
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_referral public.relationship_referrals%rowtype;
begin
  if v_actor is null then
    raise exception 'Authenticated CRM access is required.' using errcode = '42501';
  end if;
  select * into v_referral from public.relationship_referrals where id = p_referral_id for update;
  if not found then
    raise exception 'Relationship referral not found.' using errcode = 'P0002';
  end if;
  if not v_referral.verified then
    raise exception 'Only a verified referral can be revoked.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = v_actor
      and capability.tenant_id = v_referral.tenant_id
      and capability.crm_role = any (array['crm_admin','crm_operator']::public.crm_capability_role[])
  ) then
    raise exception 'You do not have permission to revoke relationship referrals.' using errcode = '42501';
  end if;
  update public.relationship_referrals
  set revoked_at = coalesce(p_revoked_at, now()),
      notes = case when p_note is null then notes else nullif(btrim(p_note), '') end,
      updated_by_profile_id = v_actor
  where id = p_referral_id
  returning * into v_referral;
  insert into public.relationship_interactions (
    tenant_id, organization_id, contact_id, interaction_type, occurred_at,
    summary, metadata, created_by_profile_id, updated_by_profile_id
  ) values (
    v_referral.tenant_id, v_referral.organization_id, v_referral.contact_id,
    'referral_verification', coalesce(p_revoked_at, now()),
    'Relationship referral verification revoked.',
    jsonb_build_object('referral_id', v_referral.id, 'revoked', true),
    v_actor, v_actor
  );
  return v_referral;
end;
$$;

revoke all on table public.relationship_referrals from public, anon;
grant select, insert, update on table public.relationship_referrals to authenticated;
grant all on table public.relationship_referrals to service_role;
revoke all on function public.verify_relationship_referral(uuid, boolean, text, timestamptz, text) from public, anon;
grant execute on function public.verify_relationship_referral(uuid, boolean, text, timestamptz, text) to authenticated, service_role;
revoke all on function public.revoke_relationship_referral(uuid, timestamptz, text) from public, anon;
grant execute on function public.revoke_relationship_referral(uuid, timestamptz, text) to authenticated, service_role;

comment on table public.relationship_referrals is 'Non-clinical relationship provenance and referral evidence. Separate from client referral authorizations.';