-- Apply only after the Website deployment is confirmed to use the narrow
-- submit_website_creator_interest and submit_website_bty_nomination wrappers.
-- The legacy BTY RPC accepts a broad payload and is retained for service-only
-- rollback/forensics, but it must no longer be a browser-callable surface.

revoke all on function public.submit_website_bty_submission(jsonb) from public;
revoke all on function public.submit_website_bty_submission(jsonb) from anon;
revoke all on function public.submit_website_bty_submission(jsonb) from authenticated;
grant execute on function public.submit_website_bty_submission(jsonb) to service_role;

comment on function public.submit_website_bty_submission(jsonb) is
  'Legacy broad BTY intake retained for service-only rollback. Public Website traffic uses narrow validated wrappers.';
