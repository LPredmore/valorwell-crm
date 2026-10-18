-- Forward-only least-privilege correction for internal CRM idempotency helpers.
-- Live audit 2026-10-18: authenticated could call both SECURITY DEFINER
-- helpers directly. _crm_idempotency_claim accepts a caller-supplied tenant ID
-- without independently validating tenant membership; _record can overwrite
-- a keyed result. These helpers are internal to postgres-owned SECURITY DEFINER
-- campaign lifecycle RPCs, not browser entry points.
-- Preserve the service_role's explicit grants and postgres owner privileges.
begin;
revoke execute on function public._crm_idempotency_claim(text,text,uuid,uuid)
  from public, anon, authenticated;
revoke execute on function public._crm_idempotency_record(text,text,jsonb)
  from public, anon, authenticated;
commit;
