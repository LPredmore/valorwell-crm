do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'relationship_organizations_tenant_id_id_key') then
    alter table public.relationship_organizations
      add constraint relationship_organizations_tenant_id_id_key unique (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'relationship_contacts_tenant_id_id_key') then
    alter table public.relationship_contacts
      add constraint relationship_contacts_tenant_id_id_key unique (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'relationship_stage_history_tenant_organization_fkey') then
    alter table public.relationship_stage_history
      add constraint relationship_stage_history_tenant_organization_fkey
      foreign key (tenant_id, organization_id)
      references public.relationship_organizations(tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'relationship_stage_history_tenant_contact_fkey') then
    alter table public.relationship_stage_history
      add constraint relationship_stage_history_tenant_contact_fkey
      foreign key (tenant_id, contact_id)
      references public.relationship_contacts(tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'relationship_interactions_tenant_organization_fkey') then
    alter table public.relationship_interactions
      add constraint relationship_interactions_tenant_organization_fkey
      foreign key (tenant_id, organization_id)
      references public.relationship_organizations(tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'relationship_interactions_tenant_contact_fkey') then
    alter table public.relationship_interactions
      add constraint relationship_interactions_tenant_contact_fkey
      foreign key (tenant_id, contact_id)
      references public.relationship_contacts(tenant_id, id) on delete cascade;
  end if;
end $$;

drop policy if exists relationship_stage_history_tenant_select on public.relationship_stage_history;
create policy relationship_stage_history_tenant_select
on public.relationship_stage_history
for select
to authenticated
using (public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id));

drop policy if exists relationship_interactions_tenant_select on public.relationship_interactions;
create policy relationship_interactions_tenant_select
on public.relationship_interactions
for select
to authenticated
using (public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id));

drop policy if exists relationship_interactions_tenant_insert on public.relationship_interactions;
create policy relationship_interactions_tenant_insert
on public.relationship_interactions
for insert
to authenticated
with check (
  public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id)
  and created_by_profile_id = auth.uid()
  and updated_by_profile_id = auth.uid()
  and (organization_id is not null or contact_id is not null)
);
