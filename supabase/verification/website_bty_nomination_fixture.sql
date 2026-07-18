-- Minimal local-only fixture for website_bty_nomination_workflow_test.sql.
-- Never run this against a Supabase project.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;

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

grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
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
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (tenant_id, profile_id)
);

create table public.relationship_role_catalog (
  code text primary key,
  label text not null,
  description text,
  outreach_lane text not null,
  applies_to text not null check (applies_to in ('contact', 'organization', 'both')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  review_state text not null default 'review_needed'
    check (review_state in (
      'review_needed','direct_outreach','nurture','not_relevant',
      'duplicate','invalid_spam','managed'
    )),
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
  on public.relationship_contacts (tenant_id, lower(email))
  where email is not null;
create unique index relationship_contacts_source_unique
  on public.relationship_contacts (tenant_id, source, source_record_key)
  where source_record_key is not null;

create table public.relationship_organizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  organization_kind text,
  veteran_affiliated boolean,
  website text,
  outreach_status text not null default 'new',
  owner_profile_id uuid references public.profiles(id) on delete set null,
  next_action text,
  next_action_due_at timestamptz,
  last_contact_at timestamptz,
  do_not_contact boolean not null default false,
  source text not null default 'website',
  source_record_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index relationship_organizations_source_unique
  on public.relationship_organizations (tenant_id, source, source_record_key)
  where source_record_key is not null;

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

create table public.relationship_organization_roles (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  organization_id uuid not null references public.relationship_organizations(id) on delete cascade,
  role_code text not null references public.relationship_role_catalog(code),
  source text not null default 'website',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, role_code)
);

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

create or replace function public.is_staff_or_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = p_user_id
      and role in ('staff', 'admin')
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
    select 1
    from public.tenant_memberships
    where profile_id = p_user_id
      and tenant_id = p_tenant_id
  )
$$;

revoke all on function public.is_staff_or_admin(uuid) from public, anon;
revoke all on function public.is_tenant_member(uuid, uuid) from public, anon;
grant execute on function public.is_staff_or_admin(uuid) to authenticated, service_role;
grant execute on function public.is_tenant_member(uuid, uuid) to authenticated, service_role;

alter table public.relationship_contacts enable row level security;
alter table public.relationship_organizations enable row level security;
alter table public.relationship_contact_roles enable row level security;
alter table public.relationship_organization_roles enable row level security;
alter table public.website_submissions enable row level security;

-- Reproduce the pre-migration global-staff policies so the migration must
-- replace them with tenant-aware policies.
create policy relationship_contacts_staff_admin
  on public.relationship_contacts
  for all to authenticated
  using (
    public.is_staff_or_admin(auth.uid())
    and public.is_tenant_member(auth.uid(), tenant_id)
  )
  with check (
    public.is_staff_or_admin(auth.uid())
    and public.is_tenant_member(auth.uid(), tenant_id)
  );

create policy relationship_organizations_staff_admin
  on public.relationship_organizations
  for all to authenticated
  using (public.is_staff_or_admin(auth.uid()))
  with check (public.is_staff_or_admin(auth.uid()));

create policy relationship_organization_roles_staff_admin
  on public.relationship_organization_roles
  for all to authenticated
  using (public.is_staff_or_admin(auth.uid()))
  with check (public.is_staff_or_admin(auth.uid()));

create policy website_submissions_staff_admin
  on public.website_submissions
  for all to authenticated
  using (
    public.is_staff_or_admin(auth.uid())
    and public.is_tenant_member(auth.uid(), tenant_id)
    and (
      contact_id is null
      or exists (
        select 1 from public.relationship_contacts as contact
        where contact.id = website_submissions.contact_id
          and contact.tenant_id = website_submissions.tenant_id
      )
    )
  )
  with check (
    public.is_staff_or_admin(auth.uid())
    and public.is_tenant_member(auth.uid(), tenant_id)
    and (
      contact_id is null
      or exists (
        select 1 from public.relationship_contacts as contact
        where contact.id = website_submissions.contact_id
          and contact.tenant_id = website_submissions.tenant_id
      )
    )
  );

grant all on public.relationship_contacts,
  public.relationship_organizations,
  public.relationship_contact_roles,
  public.relationship_organization_roles,
  public.website_submissions to authenticated, service_role;
grant select on public.relationship_role_catalog, public.tenants, public.profiles
  to authenticated, service_role;
grant select on public.user_roles, public.tenant_memberships to authenticated, service_role;

create or replace function public.website_intake_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tenant.id
  from public.tenants as tenant
  where tenant.slug = 'valorwell'
$$;

revoke all on function public.website_intake_tenant_id() from public, anon, authenticated;
grant execute on function public.website_intake_tenant_id() to service_role;

insert into public.tenants (id, slug)
values
  ('00000000-0000-0000-0000-000000000001', 'valorwell'),
  ('00000000-0000-0000-0000-000000000002', 'other-tenant');

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000101', 'established@example.invalid'),
  ('00000000-0000-0000-0000-000000000102', 'valorwell-staff@example.invalid'),
  ('00000000-0000-0000-0000-000000000103', 'other-staff@example.invalid'),
  ('00000000-0000-0000-0000-000000000104', 'valorwell-client@example.invalid'),
  ('00000000-0000-0000-0000-000000000105', 'inactive-staff@example.invalid');
insert into public.profiles (id, email, is_active)
values
  ('00000000-0000-0000-0000-000000000101', 'established@example.invalid', true),
  ('00000000-0000-0000-0000-000000000102', 'valorwell-staff@example.invalid', true),
  ('00000000-0000-0000-0000-000000000103', 'other-staff@example.invalid', true),
  ('00000000-0000-0000-0000-000000000104', 'valorwell-client@example.invalid', true),
  ('00000000-0000-0000-0000-000000000105', 'inactive-staff@example.invalid', false);

insert into public.user_roles (user_id, role)
values
  ('00000000-0000-0000-0000-000000000102', 'staff'),
  ('00000000-0000-0000-0000-000000000103', 'staff'),
  ('00000000-0000-0000-0000-000000000104', 'client'),
  ('00000000-0000-0000-0000-000000000105', 'staff');

insert into public.tenant_memberships (tenant_id, profile_id)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000102'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000104'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000105'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000103');

insert into public.relationship_organizations (
  id, tenant_id, name, source, source_record_key
)
values (
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000002',
  'Other Tenant Organization',
  'fixture',
  'other-tenant-organization'
);

insert into public.relationship_contacts (
  id,
  tenant_id,
  profile_id,
  first_name,
  last_name,
  email,
  phone,
  source,
  source_record_key,
  metadata
)
values (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000101',
  'Established',
  'Identity',
  'established@example.invalid',
  '555-0001',
  'therapist_crm_clinician_application',
  'established-identity',
  '{"protected":true}'::jsonb
);

insert into public.relationship_contacts (
  id,
  tenant_id,
  email,
  source,
  source_record_key,
  metadata
)
values (
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000001',
  'merge@example.invalid',
  'therapist_crm_interest_migration',
  'historical-merge',
  '{"historical":true}'::jsonb
);

insert into public.relationship_contacts (
  id, tenant_id, email, source, source_record_key
)
values (
  '00000000-0000-0000-0000-000000000203',
  '00000000-0000-0000-0000-000000000002',
  'other-tenant-contact@example.invalid',
  'fixture',
  'other-tenant-contact'
);
