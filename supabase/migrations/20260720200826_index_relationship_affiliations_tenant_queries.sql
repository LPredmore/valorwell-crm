create index if not exists relationship_contact_orgs_tenant_contact_idx
  on public.relationship_contact_organizations (tenant_id, contact_id, organization_id);

create index if not exists relationship_contact_orgs_tenant_org_idx
  on public.relationship_contact_organizations (tenant_id, organization_id, contact_id);
