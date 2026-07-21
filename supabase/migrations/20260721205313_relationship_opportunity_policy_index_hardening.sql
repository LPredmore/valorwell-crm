create index relationship_opportunities_owner_profile_idx
  on public.relationship_opportunities (owner_profile_id)
  where owner_profile_id is not null;
create index relationship_opportunities_created_by_profile_idx
  on public.relationship_opportunities (created_by_profile_id)
  where created_by_profile_id is not null;
create index relationship_opportunities_updated_by_profile_idx
  on public.relationship_opportunities (updated_by_profile_id)
  where updated_by_profile_id is not null;
create index relationship_opportunity_history_created_by_profile_idx
  on public.relationship_opportunity_status_history (created_by_profile_id)
  where created_by_profile_id is not null;
create index relationship_opportunity_history_updated_by_profile_idx
  on public.relationship_opportunity_status_history (updated_by_profile_id)
  where updated_by_profile_id is not null;

drop policy if exists relationship_opportunities_crm_select on public.relationship_opportunities;
create policy relationship_opportunities_crm_select
on public.relationship_opportunities
for select
to authenticated
using (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = (select auth.uid())
      and capability.tenant_id = relationship_opportunities.tenant_id
      and capability.crm_role <> 'crm_none'::public.crm_capability_role
  )
);

drop policy if exists relationship_opportunities_crm_insert on public.relationship_opportunities;
create policy relationship_opportunities_crm_insert
on public.relationship_opportunities
for insert
to authenticated
with check (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = (select auth.uid())
      and capability.tenant_id = relationship_opportunities.tenant_id
      and capability.crm_role = any (array['crm_admin','crm_operator']::public.crm_capability_role[])
  )
  and created_by_profile_id = (select auth.uid())
  and updated_by_profile_id = (select auth.uid())
);

drop policy if exists relationship_opportunities_crm_update on public.relationship_opportunities;
create policy relationship_opportunities_crm_update
on public.relationship_opportunities
for update
to authenticated
using (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = (select auth.uid())
      and capability.tenant_id = relationship_opportunities.tenant_id
      and capability.crm_role = any (array['crm_admin','crm_operator']::public.crm_capability_role[])
  )
)
with check (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = (select auth.uid())
      and capability.tenant_id = relationship_opportunities.tenant_id
      and capability.crm_role = any (array['crm_admin','crm_operator']::public.crm_capability_role[])
  )
  and updated_by_profile_id = (select auth.uid())
);

drop policy if exists relationship_opportunity_history_crm_select on public.relationship_opportunity_status_history;
create policy relationship_opportunity_history_crm_select
on public.relationship_opportunity_status_history
for select
to authenticated
using (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = (select auth.uid())
      and capability.tenant_id = relationship_opportunity_status_history.tenant_id
      and capability.crm_role <> 'crm_none'::public.crm_capability_role
  )
);

drop policy if exists relationship_interactions_tenant_select on public.relationship_interactions;
create policy relationship_interactions_tenant_select
on public.relationship_interactions
for select
to authenticated
using (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = (select auth.uid())
      and capability.tenant_id = relationship_interactions.tenant_id
      and capability.crm_role <> 'crm_none'::public.crm_capability_role
  )
);

drop policy if exists relationship_interactions_tenant_insert on public.relationship_interactions;
create policy relationship_interactions_tenant_insert
on public.relationship_interactions
for insert
to authenticated
with check (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = (select auth.uid())
      and capability.tenant_id = relationship_interactions.tenant_id
      and capability.crm_role = any (array['crm_admin','crm_operator']::public.crm_capability_role[])
  )
  and created_by_profile_id = (select auth.uid())
  and updated_by_profile_id = (select auth.uid())
  and (organization_id is not null or contact_id is not null or opportunity_id is not null)
);
