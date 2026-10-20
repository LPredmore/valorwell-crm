-- ValorWell CRM + Billing Hub shared-production security ACL acceptance (READ ONLY)
-- Captured 2026-10-19; inspect current migration ledger BEFORE running.
-- Run in Supabase SQL Editor as an authorized operator. No RPCs are invoked,
-- no role is impersonated, no claims/patients/campaigns are read, and NO writes.
--
-- Important: this checks object-level EXECUTE grants only. A PASS is not
-- authorization correctness, signed-JWT proof, RLS proof, business workflow
-- success, or permission to deploy. Especially for claim status, a scoped
-- authenticated wrapper must remain callable and be tested behaviorally.
--
-- Expected after the 9 outstanding Oct 19 migrations have passed their
-- full-schema / trusted-worker tests and been deployed with approval:
-- 14/14 ACL_PASS. The initial 2026-10-19 live read produced 2/14 ACL_PASS
-- (Stripe payment posting + intentionally authorized claim-status wrapper).
-- Recheck every time: another actor already applied Stripe under a distinct
-- live version 20261019232604 versus source 20261019000100.
with expected(signature, authenticated_allowed) as (
 values
 ('public.process_stripe_checkout_payment(text,text,integer,uuid[],uuid[])',false),
 ('public._crm_idempotency_claim(text,text,uuid,uuid)',false),
 ('public._crm_idempotency_record(text,text,jsonb)',false),
 ('public._crm_enrollment_tenant_check(uuid)',false),
 ('public.finalize_claim_submission(uuid,text,jsonb)',false),
 ('public.finalize_stedi_submission_attempt_v2(uuid,text,text,jsonb,text,text,boolean)',false),
 ('public.reconcile_payroll_line_items_from_attempts(uuid)',false),
 ('public.payroll_refresh_historical_gap_findings_v1()',false),
 ('public.social_queue_publish(uuid)',false),
 ('public.crm_enqueue_campaign_trigger_jobs(uuid)',false),
 ('public.crm_correlate_client_email_reply(uuid)',false),
 ('public.crm_evaluate_campaign_concurrency(uuid,uuid,text,uuid)',false),
 ('public.crm_emit_automation_event(uuid,text,text,uuid,text,jsonb,text,uuid,timestamp with time zone)',false),
 ('public.claim_is_externally_submitted_v1(uuid)',true)
), observed as (
 select signature, authenticated_allowed, to_regprocedure(signature) as target
 from expected
), checks as (
 select signature,
   case
     when target is null then 'FAIL_MISSING'
     when has_function_privilege('anon',target,'EXECUTE') then 'FAIL_ANON'
     when not has_function_privilege('service_role',target,'EXECUTE') then 'FAIL_SERVICE'
     when has_function_privilege('authenticated',target,'EXECUTE')
           is distinct from authenticated_allowed then 'FAIL_AUTH'
     else 'ACL_PASS' end as acl_status
 from observed
)
select signature, acl_status from checks order by signature;

-- Separate read-only historical ledger version check (run as its own query):
-- select version,name from supabase_migrations.schema_migrations
-- where version >= '20261019000000' order by version;
--
-- Mandatory complementary checks, NOT exercised by this SQL:
-- - Signed GoTrue/PostgREST anon, own/foreign tenant and authorized RPC tests
-- - Valid claim-status authenticated wrapper; client/line/event immutability
-- - Social Media legitimate queue worker; NO production media publishes
-- - Campaign worker/evaluator/email and idempotent trusted trigger paths
-- - Claim.MD fail-closed handling; NO mocked provider accepted responses
-- - Stripe webhook signature/amount/allocation, payroll, donor NULL state
-- - Supabase advisor results and cross-repository migration version order
-- - Stedi retired endpoints/cron and remaining privileged DB RPC containment
-- - Rollback/monitoring in a controlled approved production release
