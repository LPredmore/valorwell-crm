begin;

drop policy if exists relationship_contact_organizations_tenant_staff_admin on public.relationship_contact_organizations;
create policy relationship_contact_organizations_tenant_staff_admin
on public.relationship_contact_organizations
for all to authenticated
using (
  public.crm_has_role(
    auth.uid(), array['admin','staff'],
    relationship_contact_organizations.tenant_id
  )
)
with check (
  public.crm_has_role(
    auth.uid(), array['admin','staff'],
    relationship_contact_organizations.tenant_id
  )
  and exists (
    select 1 from public.relationship_contacts c
    where c.id = relationship_contact_organizations.contact_id
      and c.tenant_id = relationship_contact_organizations.tenant_id
  )
  and exists (
    select 1 from public.relationship_organizations o
    where o.id = relationship_contact_organizations.organization_id
      and o.tenant_id = relationship_contact_organizations.tenant_id
  )
);

drop policy if exists relationship_contact_roles_tenant_staff_admin on public.relationship_contact_roles;
create policy relationship_contact_roles_tenant_staff_admin
on public.relationship_contact_roles
for all to authenticated
using (
  public.crm_has_role(
    auth.uid(), array['admin','staff'],
    relationship_contact_roles.tenant_id
  )
)
with check (
  public.crm_has_role(
    auth.uid(), array['admin','staff'],
    relationship_contact_roles.tenant_id
  )
  and exists (
    select 1 from public.relationship_contacts c
    where c.id = relationship_contact_roles.contact_id
      and c.tenant_id = relationship_contact_roles.tenant_id
  )
);

drop policy if exists relationship_organization_roles_tenant_staff_admin on public.relationship_organization_roles;
create policy relationship_organization_roles_tenant_staff_admin
on public.relationship_organization_roles
for all to authenticated
using (
  public.crm_has_role(
    auth.uid(), array['admin','staff'],
    relationship_organization_roles.tenant_id
  )
)
with check (
  public.crm_has_role(
    auth.uid(), array['admin','staff'],
    relationship_organization_roles.tenant_id
  )
  and exists (
    select 1 from public.relationship_organizations o
    where o.id = relationship_organization_roles.organization_id
      and o.tenant_id = relationship_organization_roles.tenant_id
  )
);

drop policy if exists relationship_social_profiles_tenant_staff_admin on public.relationship_social_profiles;
create policy relationship_social_profiles_tenant_staff_admin
on public.relationship_social_profiles
for all to authenticated
using (
  public.crm_has_role(
    auth.uid(), array['admin','staff'],
    relationship_social_profiles.tenant_id
  )
)
with check (
  public.crm_has_role(
    auth.uid(), array['admin','staff'],
    relationship_social_profiles.tenant_id
  )
  and (
    (
      relationship_social_profiles.contact_id is not null
      and exists (
        select 1 from public.relationship_contacts c
        where c.id = relationship_social_profiles.contact_id
          and c.tenant_id = relationship_social_profiles.tenant_id
      )
    )
    or
    (
      relationship_social_profiles.organization_id is not null
      and exists (
        select 1 from public.relationship_organizations o
        where o.id = relationship_social_profiles.organization_id
          and o.tenant_id = relationship_social_profiles.tenant_id
      )
    )
  )
);

drop policy if exists relationship_influencer_profiles_tenant_staff_admin on public.relationship_influencer_profiles;
create policy relationship_influencer_profiles_tenant_staff_admin
on public.relationship_influencer_profiles
for all to authenticated
using (
  public.crm_has_role(
    auth.uid(), array['admin','staff'],
    relationship_influencer_profiles.tenant_id
  )
)
with check (
  public.crm_has_role(
    auth.uid(), array['admin','staff'],
    relationship_influencer_profiles.tenant_id
  )
  and exists (
    select 1 from public.relationship_contacts c
    where c.id = relationship_influencer_profiles.contact_id
      and c.tenant_id = relationship_influencer_profiles.tenant_id
  )
);

drop policy if exists relationship_influencer_profiles_own_select on public.relationship_influencer_profiles;
create policy relationship_influencer_profiles_own_select
on public.relationship_influencer_profiles
for select to authenticated
using (exists (
  select 1
  from public.relationship_contacts c
  where c.id = relationship_influencer_profiles.contact_id
    and c.profile_id = auth.uid()
    and c.tenant_id = relationship_influencer_profiles.tenant_id
    and c.tenant_id = public.website_intake_tenant_id()
));

drop policy if exists relationship_influencer_profiles_own_update on public.relationship_influencer_profiles;
create policy relationship_influencer_profiles_own_update
on public.relationship_influencer_profiles
for update to authenticated
using (exists (
  select 1
  from public.relationship_contacts c
  where c.id = relationship_influencer_profiles.contact_id
    and c.profile_id = auth.uid()
    and c.tenant_id = relationship_influencer_profiles.tenant_id
    and c.tenant_id = public.website_intake_tenant_id()
))
with check (exists (
  select 1
  from public.relationship_contacts c
  where c.id = relationship_influencer_profiles.contact_id
    and c.profile_id = auth.uid()
    and c.tenant_id = relationship_influencer_profiles.tenant_id
    and c.tenant_id = public.website_intake_tenant_id()
));

drop policy if exists relationship_social_profiles_own_select on public.relationship_social_profiles;
create policy relationship_social_profiles_own_select
on public.relationship_social_profiles
for select to authenticated
using (
  relationship_social_profiles.contact_id is not null
  and exists (
    select 1
    from public.relationship_contacts c
    where c.id = relationship_social_profiles.contact_id
      and c.profile_id = auth.uid()
      and c.tenant_id = relationship_social_profiles.tenant_id
      and c.tenant_id = public.website_intake_tenant_id()
  )
);

drop policy if exists relationship_social_profiles_own_insert on public.relationship_social_profiles;
create policy relationship_social_profiles_own_insert
on public.relationship_social_profiles
for insert to authenticated
with check (
  relationship_social_profiles.contact_id is not null
  and relationship_social_profiles.organization_id is null
  and exists (
    select 1
    from public.relationship_contacts c
    where c.id = relationship_social_profiles.contact_id
      and c.profile_id = auth.uid()
      and c.tenant_id = relationship_social_profiles.tenant_id
      and c.tenant_id = public.website_intake_tenant_id()
  )
);

drop policy if exists relationship_social_profiles_own_update on public.relationship_social_profiles;
create policy relationship_social_profiles_own_update
on public.relationship_social_profiles
for update to authenticated
using (
  relationship_social_profiles.contact_id is not null
  and exists (
    select 1
    from public.relationship_contacts c
    where c.id = relationship_social_profiles.contact_id
      and c.profile_id = auth.uid()
      and c.tenant_id = relationship_social_profiles.tenant_id
      and c.tenant_id = public.website_intake_tenant_id()
  )
)
with check (
  relationship_social_profiles.contact_id is not null
  and relationship_social_profiles.organization_id is null
  and exists (
    select 1
    from public.relationship_contacts c
    where c.id = relationship_social_profiles.contact_id
      and c.profile_id = auth.uid()
      and c.tenant_id = relationship_social_profiles.tenant_id
      and c.tenant_id = public.website_intake_tenant_id()
  )
);

drop policy if exists relationship_social_profiles_own_delete on public.relationship_social_profiles;
create policy relationship_social_profiles_own_delete
on public.relationship_social_profiles
for delete to authenticated
using (
  relationship_social_profiles.contact_id is not null
  and exists (
    select 1
    from public.relationship_contacts c
    where c.id = relationship_social_profiles.contact_id
      and c.profile_id = auth.uid()
      and c.tenant_id = relationship_social_profiles.tenant_id
      and c.tenant_id = public.website_intake_tenant_id()
  )
);

commit;
