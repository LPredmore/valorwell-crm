create table if not exists public.relationship_stage_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  organization_id uuid references public.relationship_organizations(id) on delete cascade,
  contact_id uuid references public.relationship_contacts(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  changed_at timestamptz not null default now(),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_stage_history_subject_check check (num_nonnulls(organization_id, contact_id) = 1),
  constraint relationship_stage_history_from_stage_check check (from_stage is null or from_stage = any (array['identified','qualified_outreach','contacted','engaged','discovery','next_step_agreed','active','nurture','closed_no_fit','inactive']::text[])),
  constraint relationship_stage_history_to_stage_check check (to_stage = any (array['identified','qualified_outreach','contacted','engaged','discovery','next_step_agreed','active','nurture','closed_no_fit','inactive']::text[]))
);

create table if not exists public.relationship_interactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  organization_id uuid references public.relationship_organizations(id) on delete cascade,
  contact_id uuid references public.relationship_contacts(id) on delete cascade,
  opportunity_id uuid,
  interaction_type text not null,
  occurred_at timestamptz not null default now(),
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_interactions_subject_check check (num_nonnulls(organization_id, contact_id, opportunity_id) >= 1),
  constraint relationship_interactions_summary_check check (length(btrim(summary)) > 0),
  constraint relationship_interactions_type_check check (interaction_type = any (array['outbound_email','inbound_reply','phone_call','meeting','manual_note','stage_transition','owner_change','next_action_change','referral_verification','opportunity_status_change','campaign_enrollment','campaign_stop','suppression','unsubscribe','import','system']::text[]))
);

create index if not exists relationship_stage_history_tenant_changed_idx on public.relationship_stage_history (tenant_id, changed_at desc);
create index if not exists relationship_stage_history_org_changed_idx on public.relationship_stage_history (tenant_id, organization_id, changed_at desc) where organization_id is not null;
create index if not exists relationship_stage_history_contact_changed_idx on public.relationship_stage_history (tenant_id, contact_id, changed_at desc) where contact_id is not null;
create index if not exists relationship_interactions_tenant_occurred_idx on public.relationship_interactions (tenant_id, occurred_at desc);
create index if not exists relationship_interactions_org_occurred_idx on public.relationship_interactions (tenant_id, organization_id, occurred_at desc) where organization_id is not null;
create index if not exists relationship_interactions_contact_occurred_idx on public.relationship_interactions (tenant_id, contact_id, occurred_at desc) where contact_id is not null;
create index if not exists relationship_interactions_type_occurred_idx on public.relationship_interactions (tenant_id, interaction_type, occurred_at desc);

alter table public.relationship_stage_history enable row level security;
alter table public.relationship_interactions enable row level security;

drop policy if exists relationship_stage_history_tenant_select on public.relationship_stage_history;
create policy relationship_stage_history_tenant_select on public.relationship_stage_history for select to authenticated using (
  public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id)
  and (organization_id is null or exists (select 1 from public.relationship_organizations o where o.id = relationship_stage_history.organization_id and o.tenant_id = relationship_stage_history.tenant_id))
  and (contact_id is null or exists (select 1 from public.relationship_contacts c where c.id = relationship_stage_history.contact_id and c.tenant_id = relationship_stage_history.tenant_id))
);

drop policy if exists relationship_interactions_tenant_select on public.relationship_interactions;
create policy relationship_interactions_tenant_select on public.relationship_interactions for select to authenticated using (
  public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id)
  and (organization_id is null or exists (select 1 from public.relationship_organizations o where o.id = relationship_interactions.organization_id and o.tenant_id = relationship_interactions.tenant_id))
  and (contact_id is null or exists (select 1 from public.relationship_contacts c where c.id = relationship_interactions.contact_id and c.tenant_id = relationship_interactions.tenant_id))
);

drop policy if exists relationship_interactions_tenant_insert on public.relationship_interactions;
create policy relationship_interactions_tenant_insert on public.relationship_interactions for insert to authenticated with check (
  public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id)
  and created_by_profile_id = auth.uid()
  and updated_by_profile_id = auth.uid()
  and (organization_id is not null or contact_id is not null)
  and (organization_id is null or exists (select 1 from public.relationship_organizations o where o.id = relationship_interactions.organization_id and o.tenant_id = relationship_interactions.tenant_id))
  and (contact_id is null or exists (select 1 from public.relationship_contacts c where c.id = relationship_interactions.contact_id and c.tenant_id = relationship_interactions.tenant_id))
);

grant select on table public.relationship_stage_history to authenticated;
grant select, insert on table public.relationship_interactions to authenticated;
grant all on table public.relationship_stage_history to service_role;
grant all on table public.relationship_interactions to service_role;
revoke all on table public.relationship_stage_history from anon;
revoke all on table public.relationship_interactions from anon;
