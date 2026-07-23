create or replace function private.crm_has_relationship_permission(
  p_user_id uuid,
  p_tenant_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
     and p_user_id = (select auth.uid())
     and exists (
       select 1
       from public.crm_user_capabilities c
       where c.profile_id = p_user_id
         and c.tenant_id = p_tenant_id
         and case lower(trim(p_permission))
           when 'view_relationships' then c.crm_role::text in ('crm_admin','crm_operator','crm_readonly')
           when 'edit_relationships' then c.crm_role::text in ('crm_admin','crm_operator')
           when 'verify_referrals' then c.crm_role::text in ('crm_admin','crm_operator')
           when 'review_opportunities' then c.crm_role::text in ('crm_admin','crm_operator')
           when 'import_relationships' then c.crm_role::text in ('crm_admin','crm_operator')
           when 'manage_campaigns' then c.crm_role::text in ('crm_admin','crm_operator')
           when 'enroll_relationships' then c.crm_role::text in ('crm_admin','crm_operator')
           when 'view_replies' then c.crm_role::text in ('crm_admin','crm_operator','crm_readonly')
           when 'manage_replies' then c.crm_role::text in ('crm_admin','crm_operator')
           when 'manage_suppressions' then c.crm_role::text in ('crm_admin','crm_operator')
           when 'view_sensitive_evidence' then c.crm_role::text = 'crm_admin'
           else false
         end
     );
$$;

revoke all on function private.crm_has_relationship_permission(uuid,uuid,text) from public, anon;
grant execute on function private.crm_has_relationship_permission(uuid,uuid,text) to authenticated, service_role;
comment on function private.crm_has_relationship_permission(uuid,uuid,text) is
  'Private RLS authorization helper for the non-clinical relationship domain. The private schema is not exposed through the Data API.';

-- Preserve legacy staff/admin and profile self-service policies while adding the canonical CRM capability layer.
drop policy if exists relationship_organizations_crm_capability_select on public.relationship_organizations;
create policy relationship_organizations_crm_capability_select on public.relationship_organizations
for select to authenticated
using (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'view_relationships'));
drop policy if exists relationship_organizations_crm_capability_insert on public.relationship_organizations;
create policy relationship_organizations_crm_capability_insert on public.relationship_organizations
for insert to authenticated
with check (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships'));
drop policy if exists relationship_organizations_crm_capability_update on public.relationship_organizations;
create policy relationship_organizations_crm_capability_update on public.relationship_organizations
for update to authenticated
using (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships'))
with check (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships'));

drop policy if exists relationship_contacts_crm_capability_select on public.relationship_contacts;
create policy relationship_contacts_crm_capability_select on public.relationship_contacts
for select to authenticated
using (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'view_relationships'));
drop policy if exists relationship_contacts_crm_capability_insert on public.relationship_contacts;
create policy relationship_contacts_crm_capability_insert on public.relationship_contacts
for insert to authenticated
with check (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships'));
drop policy if exists relationship_contacts_crm_capability_update on public.relationship_contacts;
create policy relationship_contacts_crm_capability_update on public.relationship_contacts
for update to authenticated
using (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships'))
with check (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships'));

drop policy if exists relationship_contact_organizations_crm_capability_select on public.relationship_contact_organizations;
create policy relationship_contact_organizations_crm_capability_select on public.relationship_contact_organizations
for select to authenticated using (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'view_relationships'));
drop policy if exists relationship_contact_organizations_crm_capability_mutate on public.relationship_contact_organizations;
create policy relationship_contact_organizations_crm_capability_mutate on public.relationship_contact_organizations
for all to authenticated
using (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships'))
with check (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships'));

drop policy if exists relationship_contact_roles_crm_capability_select on public.relationship_contact_roles;
create policy relationship_contact_roles_crm_capability_select on public.relationship_contact_roles
for select to authenticated using (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'view_relationships'));
drop policy if exists relationship_contact_roles_crm_capability_mutate on public.relationship_contact_roles;
create policy relationship_contact_roles_crm_capability_mutate on public.relationship_contact_roles
for all to authenticated
using (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships'))
with check (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships'));

drop policy if exists relationship_organization_roles_crm_capability_select on public.relationship_organization_roles;
create policy relationship_organization_roles_crm_capability_select on public.relationship_organization_roles
for select to authenticated using (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'view_relationships'));
drop policy if exists relationship_organization_roles_crm_capability_mutate on public.relationship_organization_roles;
create policy relationship_organization_roles_crm_capability_mutate on public.relationship_organization_roles
for all to authenticated
using (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships'))
with check (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships'));

drop policy if exists relationship_social_profiles_crm_capability_select on public.relationship_social_profiles;
create policy relationship_social_profiles_crm_capability_select on public.relationship_social_profiles
for select to authenticated using (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'view_relationships'));
drop policy if exists relationship_social_profiles_crm_capability_mutate on public.relationship_social_profiles;
create policy relationship_social_profiles_crm_capability_mutate on public.relationship_social_profiles
for all to authenticated
using (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships'))
with check (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships'));

drop policy if exists relationship_influencer_profiles_crm_capability_select on public.relationship_influencer_profiles;
create policy relationship_influencer_profiles_crm_capability_select on public.relationship_influencer_profiles
for select to authenticated using (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'view_relationships'));
drop policy if exists relationship_influencer_profiles_crm_capability_update on public.relationship_influencer_profiles;
create policy relationship_influencer_profiles_crm_capability_update on public.relationship_influencer_profiles
for update to authenticated
using (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships'))
with check (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships'));

drop policy if exists relationship_stage_history_crm_capability_select on public.relationship_stage_history;
create policy relationship_stage_history_crm_capability_select on public.relationship_stage_history
for select to authenticated using (private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'view_relationships'));

drop policy if exists relationship_role_catalog_crm_capability_select on public.relationship_role_catalog;
create policy relationship_role_catalog_crm_capability_select on public.relationship_role_catalog
for select to authenticated
using (exists (
  select 1 from public.crm_user_capabilities c
  where c.profile_id = (select auth.uid()) and c.crm_role::text <> 'crm_none'
));

-- Security-invoker reporting views are read models only.
revoke all privileges on public.relationship_organization_directory_v from public, anon, authenticated, service_role;
revoke all privileges on public.relationship_contact_directory_v from public, anon, authenticated, service_role;
revoke all privileges on public.relationship_opportunity_pipeline_v from public, anon, authenticated, service_role;
revoke all privileges on public.relationship_campaign_summary_v from public, anon, authenticated, service_role;
revoke all privileges on public.relationship_reply_queue_v from public, anon, authenticated, service_role;
revoke all privileges on public.relationship_report_metrics_v from public, anon, authenticated, service_role;
grant select on public.relationship_organization_directory_v to authenticated, service_role;
grant select on public.relationship_contact_directory_v to authenticated, service_role;
grant select on public.relationship_opportunity_pipeline_v to authenticated, service_role;
grant select on public.relationship_campaign_summary_v to authenticated, service_role;
grant select on public.relationship_reply_queue_v to authenticated, service_role;
grant select on public.relationship_report_metrics_v to authenticated, service_role;

-- Trigger functions are invoked by triggers, never directly through the API.
revoke execute on function public.set_relationship_audit_fields() from public, anon, authenticated, service_role;
revoke execute on function public.set_relationship_referral_audit_fields() from public, anon, authenticated, service_role;
revoke execute on function public.touch_relationship_updated_at() from public, anon, authenticated, service_role;
revoke execute on function public.set_relationship_campaign_audit_fields() from public, anon, authenticated, service_role;
revoke execute on function public.set_relationship_campaign_step_audit_fields() from public, anon, authenticated, service_role;
revoke execute on function public.set_relationship_campaign_enrollment_audit_fields() from public, anon, authenticated, service_role;
revoke execute on function public.set_relationship_import_audit_fields() from public, anon, authenticated, service_role;
revoke execute on function public.set_relationship_opportunity_audit_fields() from public, anon, authenticated, service_role;
revoke execute on function public.set_relationship_suppression_audit_fields() from public, anon, authenticated, service_role;
revoke execute on function public.set_relationship_unsubscribe_request_audit_fields() from public, anon, authenticated, service_role;
revoke execute on function public.touch_relationship_import_row() from public, anon, authenticated, service_role;
