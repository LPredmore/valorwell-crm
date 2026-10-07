-- Phase 9: align CRM activity-event storage with tenant-level control-plane auditing.
--
-- Newer communications/newsletter RPCs intentionally emit tenant-scoped audit
-- events that are not tied to a specific client. The historical table contract
-- still required client_id and froze event_type to an obsolete allowlist,
-- causing legitimate control-plane mutations to roll back at audit-write time.

alter table public.crm_activity_events
  alter column client_id drop not null;

alter table public.crm_activity_events
  drop constraint if exists crm_activity_events_event_type_check;

alter table public.crm_activity_events
  add constraint crm_activity_events_event_type_check
  check (nullif(btrim(event_type), '') is not null);

comment on column public.crm_activity_events.client_id is
  'Client-scoped events set client_id; tenant-level CRM/control-plane events intentionally leave it null.';

comment on column public.crm_activity_events.event_type is
  'Nonblank extensible CRM activity event key. Event vocabulary is application-controlled and evolves without a frozen database allowlist.';
