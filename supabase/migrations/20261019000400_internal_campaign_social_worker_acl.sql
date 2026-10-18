-- Narrow direct invocation of privileged CRM internal worker RPCs.
-- Social queue publish is intentionally called by social-media-manager using
-- its own service-role client after authenticated tenant/capability checks.
-- Trigger jobs are emitted by the postgres-owned SECURITY DEFINER
-- crm_emit_automation_event; the other helpers are internal worker utilities.
begin;
revoke execute on function public.social_queue_publish(uuid) from public, anon, authenticated;
revoke execute on function public.crm_enqueue_campaign_trigger_jobs(uuid) from public, anon, authenticated;
revoke execute on function public.crm_correlate_client_email_reply(uuid) from public, anon, authenticated;
revoke execute on function public.crm_evaluate_campaign_concurrency(uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.social_queue_publish(uuid) to service_role;
grant execute on function public.crm_enqueue_campaign_trigger_jobs(uuid) to service_role;
grant execute on function public.crm_correlate_client_email_reply(uuid) to service_role;
grant execute on function public.crm_evaluate_campaign_concurrency(uuid,uuid,text,uuid) to service_role;
commit;
