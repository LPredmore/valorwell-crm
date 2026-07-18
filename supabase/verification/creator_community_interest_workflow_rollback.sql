-- Safe application rollback for 20260717225018.
--
-- Run this only after rolling the Website back to a version that does not call
-- submit_website_creator_interest. This disables the anonymous entrypoint without
-- deleting submissions, contacts, profiles, roles, social profiles, or notes.
-- The additive columns, constraints, indexes, and tenant-aware RLS policies are
-- deliberately retained: removing them would either destroy data or weaken the
-- pre-migration authorization model. Re-enable by re-running the CREATE FUNCTION,
-- COMMENT, REVOKE, and GRANT statements from the migration.

begin;

revoke all on function public.submit_website_creator_interest(jsonb) from public;
revoke all on function public.submit_website_creator_interest(jsonb) from anon;
revoke all on function public.submit_website_creator_interest(jsonb) from authenticated;
revoke all on function public.submit_website_creator_interest(jsonb) from service_role;

drop function if exists public.submit_website_creator_interest(jsonb);

commit;
