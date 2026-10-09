-- The existing staff_list_provider_applicants RPC is scoped to the caller's
-- authorized STAFF tenant, not to the tenant selected in the CRM UI. Before
-- rendering or mutating an applicant card, require those tenant IDs to match.
-- This wrapper only returns the tenant ID already authorized by staff contract.
create function public.crm_staff_tenant_for_applicant_pipeline()
returns uuid language plpgsql stable security definer set search_path=''
as $f$
declare
  v_tenant uuid := private.valorwell_current_staff_tenant_id();
begin
  perform private.valorwell_require_staff_contract(v_tenant,true);
  return v_tenant;
end;
$f$;
revoke all on function public.crm_staff_tenant_for_applicant_pipeline() from public,anon,authenticated;
grant execute on function public.crm_staff_tenant_for_applicant_pipeline() to authenticated;
