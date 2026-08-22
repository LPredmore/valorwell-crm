-- Stop new legacy client bulk-newsletter jobs without touching shared bulk infrastructure.
revoke all on function public.crm_create_bulk_newsletter(uuid, uuid[], text, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_create_bulk_newsletter(uuid, uuid[], text, jsonb, uuid, uuid) to service_role;
