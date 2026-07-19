create table if not exists public.crm_domain_contracts (
  domain_key text primary key,
  canonical_database text not null,
  canonical_application text not null,
  inbound_lane text not null,
  outbound_lane text not null,
  clinical_campaign_lane text not null,
  clinical_campaign_boundary_enforced boolean not null default true,
  terminology jsonb not null default '{}'::jsonb,
  implementation_status text not null default 'phase_1_established',
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_domain_contracts_domain_key_check
    check (domain_key ~ '^[a-z0-9_]+$'),
  constraint crm_domain_contracts_status_check
    check (implementation_status in ('phase_1_established', 'active', 'superseded')),
  constraint crm_domain_contracts_terminology_object_check
    check (jsonb_typeof(terminology) = 'object')
);

alter table public.crm_domain_contracts enable row level security;

revoke all on table public.crm_domain_contracts from anon, authenticated;
grant select on table public.crm_domain_contracts to authenticated;

drop policy if exists crm_domain_contracts_staff_select on public.crm_domain_contracts;
create policy crm_domain_contracts_staff_select
on public.crm_domain_contracts
for select
to authenticated
using (public.is_staff_or_admin(auth.uid()));

insert into public.crm_domain_contracts (
  domain_key,
  canonical_database,
  canonical_application,
  inbound_lane,
  outbound_lane,
  clinical_campaign_lane,
  clinical_campaign_boundary_enforced,
  terminology,
  implementation_status,
  effective_at,
  updated_at
)
values (
  'business_development_relationships',
  'billing_hub_supabase',
  'valorwell_crm',
  'creator_community_interest',
  'bty_relationship_outreach',
  'clinical_client_campaigns',
  true,
  jsonb_build_object(
    'organization', 'The entity being considered for Beyond The Yellow or another managed relationship.',
    'contact', 'The named person or role-based inbox used to communicate with an organization.',
    'referral', 'The factual provenance supporting how an organization or contact entered the relationship system.',
    'bty_opportunity', 'The specific Beyond The Yellow invitation opportunity linked to a broader relationship.',
    'relationship', 'ValorWell''s broader intentionally managed connection to a person or organization.',
    'campaign_enrollment', 'A contact''s participation in a relationship outreach sequence.'
  ),
  'phase_1_established',
  now(),
  now()
)
on conflict (domain_key) do update
set canonical_database = excluded.canonical_database,
    canonical_application = excluded.canonical_application,
    inbound_lane = excluded.inbound_lane,
    outbound_lane = excluded.outbound_lane,
    clinical_campaign_lane = excluded.clinical_campaign_lane,
    clinical_campaign_boundary_enforced = excluded.clinical_campaign_boundary_enforced,
    terminology = excluded.terminology,
    implementation_status = excluded.implementation_status,
    effective_at = excluded.effective_at,
    updated_at = now();

comment on table public.crm_domain_contracts is
  'Read-only runtime registry for canonical CRM domain ownership and architectural boundaries. Business Development relationship records are owned by Billing Hub Supabase and operated through valorwell-crm.';
comment on column public.crm_domain_contracts.inbound_lane is
  'Inbound and self-submitted creator/community interest lane. This lane is distinct from researched or referred outbound BTY targets.';
comment on column public.crm_domain_contracts.outbound_lane is
  'Manually researched or referred Business Development and Beyond The Yellow outreach lane.';
comment on column public.crm_domain_contracts.clinical_campaign_boundary_enforced is
  'True when clinical client campaigns must remain structurally separate from organization and relationship outreach campaigns.';

comment on table public.relationship_organizations is
  'Canonical organization identity table for ValorWell Business Development, partner, creator, connector, and Beyond The Yellow relationship work.';
comment on table public.relationship_contacts is
  'Canonical non-clinical relationship contact table. A relationship contact is not a clinical client record.';
comment on table public.relationship_contact_organizations is
  'Canonical link between non-clinical relationship contacts and organizations.';
comment on table public.relationship_organization_roles is
  'Canonical organization role assignments for relationship and outreach routing.';
comment on table public.relationship_social_profiles is
  'Canonical public/professional social-profile evidence for relationship contacts and organizations.';
comment on table public.crm_campaigns is
  'Clinical client campaign engine. Do not use this table for organization, creator, partner, or Beyond The Yellow relationship outreach.';
comment on table public.crm_campaign_enrollments is
  'Clinical client campaign enrollment table requiring client_id. Organization and relationship outreach must use a separate campaign module.';
comment on table public.crm_campaign_step_logs is
  'Clinical client campaign delivery log. Relationship outreach delivery history must remain in a separate module.';
