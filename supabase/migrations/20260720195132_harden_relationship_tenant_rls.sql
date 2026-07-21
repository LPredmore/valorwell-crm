begin;

revoke truncate, references, trigger on table
  public.relationship_organizations,
  public.relationship_contacts,
  public.relationship_contact_organizations,
  public.relationship_role_catalog,
  public.relationship_contact_roles,
  public.relationship_organization_roles,
  public.relationship_social_profiles,
  public.relationship_influencer_profiles
from authenticated;

drop policy if exists relationship_organizations_staff_admin on public.relationship_organizations;
create policy relationship_organizations_tenant_staff_admin
on public.relationship_organizations
for all to authenticated
using (public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id))
with check (public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id));

drop policy if exists relationship_contacts_staff_admin on public.relationship_contacts;
create policy relationship_contacts_tenant_staff_admin
on public.relationship_contacts
for all to authenticated
using (public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id))
with check (public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id));

drop policy if exists relationship_contact_organizations_staff_admin on public.relationship_contact_organizations;
create policy relationship_contact_organizations_tenant_staff_admin
on public.relationship_contact_organizations
for all to authenticated
using (public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id))
with check (
  public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id)
  and exists (
    select 1 from public.relationship_contacts c
    where c.id = contact_id and c.tenant_id = tenant_id
  )
  and exists (
    select 1 from public.relationship_organizations o
    where o.id = organization_id and o.tenant_id = tenant_id
  )
);

drop policy if exists relationship_contact_roles_staff_admin on public.relationship_contact_roles;
create policy relationship_contact_roles_tenant_staff_admin
on public.relationship_contact_roles
for all to authenticated
using (public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id))
with check (
  public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id)
  and exists (
    select 1 from public.relationship_contacts c
    where c.id = contact_id and c.tenant_id = tenant_id
  )
);

drop policy if exists relationship_organization_roles_staff_admin on public.relationship_organization_roles;
create policy relationship_organization_roles_tenant_staff_admin
on public.relationship_organization_roles
for all to authenticated
using (public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id))
with check (
  public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id)
  and exists (
    select 1 from public.relationship_organizations o
    where o.id = organization_id and o.tenant_id = tenant_id
  )
);

drop policy if exists relationship_social_profiles_staff_admin on public.relationship_social_profiles;
create policy relationship_social_profiles_tenant_staff_admin
on public.relationship_social_profiles
for all to authenticated
using (public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id))
with check (
  public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id)
  and (
    (contact_id is not null and exists (
      select 1 from public.relationship_contacts c
      where c.id = contact_id and c.tenant_id = tenant_id
    ))
    or
    (organization_id is not null and exists (
      select 1 from public.relationship_organizations o
      where o.id = organization_id and o.tenant_id = tenant_id
    ))
  )
);

drop policy if exists relationship_influencer_profiles_staff_admin on public.relationship_influencer_profiles;
create policy relationship_influencer_profiles_tenant_staff_admin
on public.relationship_influencer_profiles
for all to authenticated
using (public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id))
with check (
  public.crm_has_role(auth.uid(), array['admin','staff'], tenant_id)
  and exists (
    select 1 from public.relationship_contacts c
    where c.id = contact_id and c.tenant_id = tenant_id
  )
);

drop policy if exists relationship_contacts_own_select on public.relationship_contacts;
create policy relationship_contacts_own_select
on public.relationship_contacts
for select to authenticated
using (
  profile_id = auth.uid()
  and tenant_id = public.website_intake_tenant_id()
);

drop policy if exists relationship_contacts_own_update on public.relationship_contacts;
create policy relationship_contacts_own_update
on public.relationship_contacts
for update to authenticated
using (
  profile_id = auth.uid()
  and tenant_id = public.website_intake_tenant_id()
)
with check (
  profile_id = auth.uid()
  and tenant_id = public.website_intake_tenant_id()
);

drop policy if exists relationship_influencer_profiles_own_select on public.relationship_influencer_profiles;
create policy relationship_influencer_profiles_own_select
on public.relationship_influencer_profiles
for select to authenticated
using (exists (
  select 1
  from public.relationship_contacts c
  where c.id = contact_id
    and c.profile_id = auth.uid()
    and c.tenant_id = tenant_id
    and c.tenant_id = public.website_intake_tenant_id()
));

drop policy if exists relationship_influencer_profiles_own_update on public.relationship_influencer_profiles;
create policy relationship_influencer_profiles_own_update
on public.relationship_influencer_profiles
for update to authenticated
using (exists (
  select 1
  from public.relationship_contacts c
  where c.id = contact_id
    and c.profile_id = auth.uid()
    and c.tenant_id = tenant_id
    and c.tenant_id = public.website_intake_tenant_id()
))
with check (exists (
  select 1
  from public.relationship_contacts c
  where c.id = contact_id
    and c.profile_id = auth.uid()
    and c.tenant_id = tenant_id
    and c.tenant_id = public.website_intake_tenant_id()
));

drop policy if exists relationship_social_profiles_own_select on public.relationship_social_profiles;
create policy relationship_social_profiles_own_select
on public.relationship_social_profiles
for select to authenticated
using (
  contact_id is not null
  and exists (
    select 1
    from public.relationship_contacts c
    where c.id = contact_id
      and c.profile_id = auth.uid()
      and c.tenant_id = tenant_id
      and c.tenant_id = public.website_intake_tenant_id()
  )
);

drop policy if exists relationship_social_profiles_own_insert on public.relationship_social_profiles;
create policy relationship_social_profiles_own_insert
on public.relationship_social_profiles
for insert to authenticated
with check (
  contact_id is not null
  and organization_id is null
  and exists (
    select 1
    from public.relationship_contacts c
    where c.id = contact_id
      and c.profile_id = auth.uid()
      and c.tenant_id = tenant_id
      and c.tenant_id = public.website_intake_tenant_id()
  )
);

drop policy if exists relationship_social_profiles_own_update on public.relationship_social_profiles;
create policy relationship_social_profiles_own_update
on public.relationship_social_profiles
for update to authenticated
using (
  contact_id is not null
  and exists (
    select 1
    from public.relationship_contacts c
    where c.id = contact_id
      and c.profile_id = auth.uid()
      and c.tenant_id = tenant_id
      and c.tenant_id = public.website_intake_tenant_id()
  )
)
with check (
  contact_id is not null
  and organization_id is null
  and exists (
    select 1
    from public.relationship_contacts c
    where c.id = contact_id
      and c.profile_id = auth.uid()
      and c.tenant_id = tenant_id
      and c.tenant_id = public.website_intake_tenant_id()
  )
);

drop policy if exists relationship_social_profiles_own_delete on public.relationship_social_profiles;
create policy relationship_social_profiles_own_delete
on public.relationship_social_profiles
for delete to authenticated
using (
  contact_id is not null
  and exists (
    select 1
    from public.relationship_contacts c
    where c.id = contact_id
      and c.profile_id = auth.uid()
      and c.tenant_id = tenant_id
      and c.tenant_id = public.website_intake_tenant_id()
  )
);

commit;
