-- BTY orchestration activation verification (read-only + rollback-safe).
-- Run inside a transaction and roll back. Confirms flag administration guard rails,
-- reconciliation dry-run purity, idempotent replay, terminal-state protection,
-- and the duplicate-observation invariant.

begin;

-- 1. Flag administration surface exists with the expected grants.
select
  to_regprocedure('public.list_relationship_feature_flags()') is not null as list_flags_exists,
  to_regprocedure('public.set_relationship_feature_flag(text,boolean,text)') is not null as set_flag_exists,
  has_function_privilege('anon','public.set_relationship_feature_flag(text,boolean,text)','execute') as anon_can_set,
  has_function_privilege('authenticated','public.set_relationship_feature_flag(text,boolean,text)','execute') as authenticated_can_set;

-- 2. Every flag row is installed for the BTY tenant and mutation-dependent flags are off.
select flag_name, enabled
from private.relationship_feature_flags
where tenant_id = '00000000-0000-0000-0000-000000000001'
order by flag_name;

-- 3. Dry run writes nothing.
select count(*) as activity_events_before from public.relationship_activity_events;
select jsonb_array_length(public.preview_relationship_bty_reconciliation()) as proposal_count;
select count(*) as activity_events_after from public.relationship_activity_events;

-- 4. Zero-tolerance invariants.
select public.list_relationship_orchestration_integrity()->'invariants' as invariants;

-- 5. Duplicate canonical communication invariant (must be zero).
select count(*) as duplicate_rfc_message_ids
from (
  select rfc_message_id
  from public.relationship_message_observations
  where rfc_message_id is not null
  group by rfc_message_id
  having count(distinct communication_id) > 1
) d;

-- 6. Idempotency: the activity ledger must never hold two rows for one key.
select count(*) as duplicate_idempotency_keys
from (
  select tenant_id, idempotency_key
  from public.relationship_activity_events
  group by tenant_id, idempotency_key
  having count(*) > 1
) d;

-- 7. Terminal-state protection: no non-cancelled recording linked to a pre-booked opportunity.
select count(*) as recordings_before_booked
from public.relationship_meetings m
join public.relationship_opportunities o on o.tenant_id = m.tenant_id and o.id = m.opportunity_id
where m.event_status <> 'cancelled'
  and o.status <> all (array['booked','completed']::text[]);

-- 8. BTY follow-up steps must remain inactive before activation.
select step_order, is_active
from public.relationship_campaign_steps
where campaign_id = '50ec97e9-340d-4c1e-b2fd-2a3fc7fb649a'
order by step_order;

rollback;
