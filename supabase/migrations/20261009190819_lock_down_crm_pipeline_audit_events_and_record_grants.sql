-- Applied to Billing Hub on 2026-10-09 as migration 20261009190819.
-- Preserve RLS-scoped reading while ensuring pipeline history is trigger managed.
ALTER FUNCTION private.crm_audit_pipeline_stage() SECURITY DEFINER;

REVOKE ALL PRIVILEGES ON TABLE public.crm_pipeline_stage_events FROM anon, authenticated;
GRANT SELECT ON TABLE public.crm_pipeline_stage_events TO authenticated;

-- Remove grants that would allow bypassing the CRM's auditable workflow.
REVOKE ALL PRIVILEGES ON TABLE public.crm_pipeline_records FROM anon;
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.crm_pipeline_records FROM authenticated;
-- Authenticated SELECT/INSERT/UPDATE and corresponding RLS policies remain in force.
