-- Legacy Givebutter is retired. Historic donations lack a trusted tenant key.
-- A CRM user's selected tenant must never be used to claim every global
-- Givebutter donation as belonging to that tenant.
-- Preserve all imported evidence and previously queued records. No deletion.
begin;
create or replace function public.crm_donor_overview()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $body$
declare
  v_context jsonb := private.relationship_campaign_context(false);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
begin
  return jsonb_build_object(
    'donors', (select count(*) from public.crm_donors where tenant_id=v_tenant),
    'recurringDonors', (select count(*) from public.crm_donors where tenant_id=v_tenant and recurring_status='active'),
    'lifetimeAmount', coalesce((select sum(lifetime_amount) from public.crm_donors where tenant_id=v_tenant),0),
    'queuePending', (select count(*) from public.crm_donor_ingest_queue where tenant_id=v_tenant and status='pending'),
    'queueFailed', (select count(*) from public.crm_donor_ingest_queue where tenant_id=v_tenant and status='failed'),
    -- Do not report a global, cross-tenant count as a tenant donation metric.
    'totalDonations', null,
    'totalDonationsStatus', 'legacy_source_tenant_ownership_unverified'
  );
end;
$body$;
create or replace function public.crm_enqueue_donor_transactions(
  p_reason text, p_historical boolean default true, p_limit integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $body$
begin
  -- Preserve the existing CRM permission boundary even on rejected attempts.
  perform private.relationship_campaign_context(true);
  raise exception 'LEGACY_DONOR_SOURCE_OWNERSHIP_REQUIRED: historical Givebutter enqueue is disabled until each transaction has a verified tenant mapping'
    using errcode='42501';
end;
$body$;
-- Keep existing explicit permissions for crm_donor_overview, but never grant
-- an unverified legacy replay path to service_role or an authenticated user.
commit;
