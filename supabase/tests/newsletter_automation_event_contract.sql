-- Newsletter automation-event contract test
-- Guards against regressing newsletter RPCs to the removed
-- public.crm_automation_events.subject_domain column.
-- Read-only: run against the target project and expect zero failures.

-- 1. The events table must not have a subject_domain column, and must keep the
--    required columns the canonical writer populates.
select
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'crm_automation_events'
      and column_name = 'subject_domain'
  ) as subject_domain_absent,
  (
    select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name = 'crm_automation_events'
      and column_name in ('subject_type', 'source', 'idempotency_key')
      and is_nullable = 'NO'
  ) = 3 as required_event_columns_present;

-- 2. Every newsletter RPC that records history must emit through the canonical
--    writer and must not mention subject_domain. Expect uses_emitter = true and
--    has_subject_domain = false for all seven rows.
select
  p.proname,
  position('crm_emit_automation_event' in pg_get_functiondef(p.oid)) > 0 as uses_emitter,
  position('subject_domain' in pg_get_functiondef(p.oid)) > 0 as has_subject_domain
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'crm_upsert_newsletter_canonical',
    'crm_upsert_newsletter',
    'crm_clone_newsletter_to_draft',
    'crm_schedule_newsletter',
    'crm_cancel_newsletter_send',
    'crm_claim_due_newsletters',
    'crm_finalize_newsletter'
  )
order by p.proname;

-- 3. Repeated content-preserving edits must not be deduplicated: the update
--    event key includes a per-call unique component. Expect true.
select position('gen_random_uuid()::text' in pg_get_functiondef(
  'public.crm_upsert_newsletter_canonical(uuid,text,text,jsonb,text[],text,uuid)'::regprocedure
)) > 0 as update_event_key_is_per_call_unique;
