-- Phase 9 production-readiness repair.
-- Tenant-level CRM operations intentionally emit activity events without a client.
-- Restore that contract so audited control-plane/runtime changes can execute.

alter table public.crm_activity_events
  alter column client_id drop not null;
