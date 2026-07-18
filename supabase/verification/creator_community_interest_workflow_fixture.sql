-- Minimal local-only fixture for creator_community_interest_workflow_test.sql.
-- Never run this against a Supabase project. It intentionally creates a reduced
-- production-shaped schema in an empty disposable PostgreSQL database.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create schema private;

create table auth.users (
  id uuid primary key,
  email text not null unique
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Mirror the shared project's pre-existing private-schema ACL. The migration
-- must not revoke schema access needed by unrelated authenticated helpers.
grant usage on schema private to authenticated, service_role;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  display_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key,
  email text not null unique,
  is_active boolean not null default true
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'staff', 'client')),
  primary key (user_id, role)
);

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tenant_role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (tenant_id, profile_id)
);

create or replace function public.has_role(p_user_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role = p_role
  )
$$;

create or replace function public.is_staff_or_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role in ('staff', 'admin')
  )
$$;

create or replace function public.is_tenant_member(p_user_id uuid, p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_memberships
    where profile_id = p_user_id and tenant_id = p_tenant_id
  )
$$;

revoke all on function public.has_role(uuid, text) from public, anon;
revoke all on function public.is_staff_or_admin(uuid) from public, anon;
revoke all on function public.is_tenant_member(uuid, uuid) from public, anon;
grant execute on function public.has_role(uuid, text) to authenticated, service_role;
grant execute on function public.is_staff_or_admin(uuid) to authenticated, service_role;
grant execute on function public.is_tenant_member(uuid, uuid) to authenticated, service_role;

create table public.relationship_role_catalog (
  code text primary key,
  label text not null,
  outreach_lane text not null,
  applies_to text not null,
  is_active boolean not null default true
);

create table public.relationship_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  first_name text,
  last_name text,
  preferred_name text,
  email text,
  phone text,
  state text,
  veteran_affiliation text not null default 'unknown'
    check (veteran_affiliation in ('unknown','veteran','family_member','military_connected','none')),
  outreach_status text not null default 'new'
    check (outreach_status in ('new','reviewing','contacted','engaged','waiting','closed','do_not_contact')),
  owner_profile_id uuid references public.profiles(id) on delete set null,
  next_action text,
  next_action_due_at timestamptz,
  last_contact_at timestamptz,
  do_not_contact boolean not null default false,
  source text not null default 'website',
  source_record_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is not null or source_record_key is not null)
);

create unique index relationship_contacts_tenant_email_unique
  on public.relationship_contacts (tenant_id, lower(email)) where email is not null;
create unique index relationship_contacts_source_unique
  on public.relationship_contacts (tenant_id, source, source_record_key)
  where source_record_key is not null;

create table public.relationship_organizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null
);

create table public.relationship_influencer_profiles (
  contact_id uuid primary key references public.relationship_contacts(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  status text not null default 'new',
  motivation text,
  veteran_connection text,
  willing_to_share boolean,
  comfort_level text,
  fundraising_goal text,
  additional_info text,
  accepted_rules boolean,
  highest_follower_platform text,
  highest_follower_count bigint,
  personal_mission text,
  avatar_url text,
  profile_complete boolean,
  past_competitions jsonb not null default '[]'::jsonb,
  is_competing boolean not null default false,
  source text not null default 'website',
  source_record_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.relationship_contact_roles (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid not null references public.relationship_contacts(id) on delete cascade,
  role_code text not null references public.relationship_role_catalog(code),
  source text not null default 'website',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (contact_id, role_code)
);

create table public.relationship_social_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid references public.relationship_contacts(id) on delete cascade,
  organization_id uuid references public.relationship_organizations(id) on delete cascade,
  platform_name text not null,
  handle text,
  profile_url text,
  follower_count bigint,
  approved boolean,
  source text not null default 'website',
  source_record_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (((contact_id is not null)::integer + (organization_id is not null)::integer) = 1)
);

create unique index relationship_social_profiles_source_unique
  on public.relationship_social_profiles (tenant_id, source, source_record_key)
  where source_record_key is not null;

create table public.website_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  submission_type text not null
    check (submission_type in ('clinician_application','ocs_inquiry','bty_submission','interest_submission')),
  original_lane text,
  normalized_lane text not null
    check (normalized_lane in ('general_inquiry','provider_recruiting','partnership_support','bty_participation')),
  contact_id uuid references public.relationship_contacts(id) on delete set null,
  organization_id uuid references public.relationship_organizations(id) on delete set null,
  provider_applicant_id uuid,
  subject_contact_id uuid references public.relationship_contacts(id) on delete set null,
  subject_organization_id uuid references public.relationship_organizations(id) on delete set null,
  source_system text not null default 'website',
  source_record_key text,
  payload jsonb not null,
  consent boolean,
  source_page text,
  user_agent text,
  status text not null default 'new'
    check (status in ('new','reviewing','routed','closed','spam')),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index website_submissions_source_unique
  on public.website_submissions (tenant_id, source_system, source_record_key)
  where source_record_key is not null;

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade
);

create table public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  conversation_id text,
  created_by_profile_id uuid not null references public.profiles(id) on delete cascade,
  note_content text not null,
  note_type text not null default 'internal' check (note_type in ('internal','system')),
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.relationship_contacts enable row level security;
alter table public.relationship_influencer_profiles enable row level security;
alter table public.relationship_contact_roles enable row level security;
alter table public.relationship_social_profiles enable row level security;
alter table public.website_submissions enable row level security;
alter table public.crm_notes enable row level security;

create policy relationship_contacts_own_select on public.relationship_contacts
  for select to authenticated using (profile_id = auth.uid());
create policy relationship_contacts_own_update on public.relationship_contacts
  for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy relationship_contacts_staff_admin on public.relationship_contacts
  for all to authenticated using (public.is_staff_or_admin(auth.uid()))
  with check (public.is_staff_or_admin(auth.uid()));

create policy relationship_influencer_profiles_staff_admin
  on public.relationship_influencer_profiles for all to authenticated
  using (public.is_staff_or_admin(auth.uid()))
  with check (public.is_staff_or_admin(auth.uid()));

create policy relationship_contact_roles_staff_admin
  on public.relationship_contact_roles for all to authenticated
  using (public.is_staff_or_admin(auth.uid()))
  with check (public.is_staff_or_admin(auth.uid()));

create policy relationship_social_profiles_staff_admin
  on public.relationship_social_profiles for all to authenticated
  using (public.is_staff_or_admin(auth.uid()))
  with check (public.is_staff_or_admin(auth.uid()));

create policy website_submissions_staff_admin on public.website_submissions
  for all to authenticated using (public.is_staff_or_admin(auth.uid()))
  with check (public.is_staff_or_admin(auth.uid()));

create policy "Tenant members can view notes" on public.crm_notes
  for select using (
    tenant_id in (
      select tenant_id from public.tenant_memberships where profile_id = auth.uid()
    )
  );
create policy "Staff can create notes" on public.crm_notes
  for insert with check (
    tenant_id in (
      select tenant_id from public.tenant_memberships where profile_id = auth.uid()
    )
    and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'staff'))
  );
create policy "Staff can update own notes" on public.crm_notes
  for update using (
    created_by_profile_id = auth.uid()
    and tenant_id in (
      select tenant_id from public.tenant_memberships where profile_id = auth.uid()
    )
  );
create policy "Staff can delete own notes" on public.crm_notes
  for delete using (
    created_by_profile_id = auth.uid()
    and tenant_id in (
      select tenant_id from public.tenant_memberships where profile_id = auth.uid()
    )
  );

grant all on public.relationship_contacts,
  public.relationship_influencer_profiles,
  public.relationship_contact_roles,
  public.relationship_social_profiles,
  public.website_submissions,
  public.crm_notes,
  public.relationship_role_catalog to authenticated, service_role;
grant select on public.tenants, public.user_roles, public.tenant_memberships,
  public.profiles to authenticated, service_role;

insert into public.tenants (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'ValorWell', 'valorwell');

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000101', 'staff-fixture@example.invalid');
insert into public.profiles (id, email)
values ('00000000-0000-0000-0000-000000000101', 'staff-fixture@example.invalid');
insert into public.user_roles (user_id, role)
values ('00000000-0000-0000-0000-000000000101', 'staff');
insert into public.tenant_memberships (tenant_id, profile_id)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000101'
);

insert into public.relationship_role_catalog (code, label, outreach_lane, applies_to)
values
  ('creator', 'Creator or influencer', 'partnership_support', 'both'),
  ('bty_promoter', 'BTY promoter or participant', 'bty_participation', 'both'),
  ('storyteller', 'Storyteller', 'partnership_support', 'both'),
  ('bty_story_submitter', 'BTY story submitter', 'bty_participation', 'contact'),
  ('podcaster', 'Podcaster', 'partnership_support', 'both'),
  ('connector', 'Connector or introduction source', 'partnership_support', 'contact'),
  ('funder', 'Funder', 'partnership_support', 'both'),
  ('supporter', 'Supporter', 'partnership_support', 'both'),
  ('general_mission_interest', 'General mission interest', 'general_inquiry', 'contact');

insert into public.relationship_contacts (
  tenant_id, email, veteran_affiliation, source, source_record_key
) values
  (
    '00000000-0000-0000-0000-000000000001',
    'historical-interest-fixture@example.invalid',
    'unknown',
    'therapist_crm_interest_migration',
    'historical-interest-fixture'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'clinician-fixture@example.invalid',
    'unknown',
    'therapist_crm_clinician_application',
    'clinician-fixture'
  );
