-- Additive rollback for 20260718112222_website_bty_nomination_intake.sql.
-- Preserve accepted submissions, relationship records, and the shared role catalog.

begin;

revoke all on function public.submit_website_bty_nomination(jsonb) from public;
revoke all on function public.submit_website_bty_nomination(jsonb) from anon;
revoke all on function public.submit_website_bty_nomination(jsonb) from authenticated;
revoke all on function public.submit_website_bty_nomination(jsonb) from service_role;

drop function if exists public.submit_website_bty_nomination(jsonb);
drop index if exists public.website_submissions_bty_nomination_rate_idx;

-- Do not delete `bty_nominee`: it is a shared, pre-existing canonical role in
-- production and accepted rows can continue to reference it after intake stops.
-- Do not delete raw website_submissions or canonical relationship records.
-- Keep the tenant-aware organization/submission policies and explicit anon
-- table revocations; rollback must not restore cross-tenant/direct-table access.

commit;
