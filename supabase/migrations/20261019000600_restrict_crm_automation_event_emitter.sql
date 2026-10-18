-- Restrict direct browser invocation of the privileged automation-event emitter.
-- Live 2026-10-18 audit: authenticated EXECUTE on a postgres-owned
-- SECURITY DEFINER RPC accepting caller-supplied tenant, event, subject,
-- payload, and source. The function writes automation events and immediately
-- invokes the campaign trigger-job helper.
-- Reviewed database call sites are postgres-owned SECURITY DEFINER functions;
-- the trusted service_role is explicitly retained.
-- Forward only; no event, campaign, or queued job is mutated by this change.
begin;
revoke execute on function public.crm_emit_automation_event(
  uuid,text,text,uuid,text,jsonb,text,uuid,timestamptz
) from public, anon, authenticated;
grant execute on function public.crm_emit_automation_event(
  uuid,text,text,uuid,text,jsonb,text,uuid,timestamptz
) to service_role;
commit;
