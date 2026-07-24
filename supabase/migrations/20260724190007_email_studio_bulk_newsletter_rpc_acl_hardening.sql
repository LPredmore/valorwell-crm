-- Email Studio Pass 9: remove retained explicit Data API EXECUTE grants from service-only RPCs.

revoke all on function public.crm_create_bulk_newsletter(uuid, uuid[], text, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_create_bulk_newsletter(uuid, uuid[], text, jsonb, uuid, uuid) to authenticated, service_role;

revoke all on function public.crm_claim_bulk_client_recipients(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.crm_claim_bulk_client_recipients(uuid, uuid, integer) to service_role;

revoke all on function public.crm_issue_client_unsubscribe_token(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_issue_client_unsubscribe_token(uuid, uuid, uuid, uuid) to service_role;

revoke all on function public.crm_process_client_unsubscribe(text) from public, anon, authenticated;
grant execute on function public.crm_process_client_unsubscribe(text) to service_role;
