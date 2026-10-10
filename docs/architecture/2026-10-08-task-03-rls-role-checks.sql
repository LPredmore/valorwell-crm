-- ValorWell CRM / Billing Hub — reproducible READ-ONLY RLS role-simulation checks.
-- Security audit 2026-10-08; companion to docs/architecture/2026-10-08-task-03-security-audit.md.
--
-- IMPORTANT: These transactions execute against current production data but do not change it.
-- They use Postgres SET LOCAL ROLE and local request.jwt.claim.sub to SIMULATE
-- a JWT-supplied identity. They do NOT test actual PostgREST signed JWT and do not
-- provide two-tenant data isolation evidence when only one tenant has been created.
-- Execute each numbered BEGIN ... ROLLBACK block separately using an authorized SQL admin client.
-- Do not replace with INSERT/UPDATE/DELETE or seed data in the production database.
-- Keep person identity values out of reports; only report aggregate counts.
--
-- 1. Positive control: one existing CRM operator (selected without printing identity).
BEGIN TRANSACTION READ ONLY;
SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT profile_id::text FROM public.crm_user_capabilities
   WHERE crm_role = 'crm_operator'
   ORDER BY profile_id LIMIT 1),
  true
) IS NOT NULL AS configured;
SET LOCAL ROLE authenticated;
SELECT current_user AS db_role, auth.uid() IS NOT NULL AS has_claim,
 (SELECT count(*) FROM public.relationship_contacts) AS relationship_contacts_visible,
 (SELECT count(*) FROM public.relationship_organizations) AS organizations_visible,
 (SELECT count(*) FROM public.relationship_opportunities) AS bty_opportunities_visible,
 (SELECT count(*) FROM public.crm_tasks) AS tasks_visible,
 (SELECT count(*) FROM public.crm_donor_transactions_v) AS donor_transactions_visible;
ROLLBACK;

-- 2. Negative control: an ordinary tenant member who is neither CRM operator nor staff.
BEGIN TRANSACTION READ ONLY;
SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT m.profile_id::text FROM public.tenant_memberships m
   WHERE NOT EXISTS (SELECT 1 FROM public.crm_user_capabilities c WHERE c.profile_id=m.profile_id)
     AND NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.profile_id=m.profile_id)
   ORDER BY m.profile_id LIMIT 1),
  true
) IS NOT NULL AS configured;
SET LOCAL ROLE authenticated;
SELECT current_user AS db_role, auth.uid() IS NOT NULL AS has_claim,
 (SELECT count(*) FROM public.relationship_contacts) AS relationship_contacts_visible,
 (SELECT count(*) FROM public.relationship_organizations) AS organizations_visible,
 (SELECT count(*) FROM public.relationship_opportunities) AS bty_opportunities_visible,
 (SELECT count(*) FROM public.crm_tasks) AS tasks_visible;
ROLLBACK;

-- 3. Negative control: a UUID that is NOT an existing member.
-- Verify this synthetic UUID is not assigned to a profile in this project before using.
BEGIN TRANSACTION READ ONLY;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true) IS NOT NULL AS configured;
SET LOCAL ROLE authenticated;
SELECT current_user AS db_role, auth.uid() IS NOT NULL AS has_claim,
 (SELECT count(*) FROM public.relationship_contacts) AS relationship_contacts_visible,
 (SELECT count(*) FROM public.relationship_organizations) AS organizations_visible,
 (SELECT count(*) FROM public.relationship_opportunities) AS bty_opportunities_visible,
 (SELECT count(*) FROM public.crm_tasks) AS tasks_visible;
ROLLBACK;

-- 4. Anonymous get_crm_operating_context must have no authority (read-only).
BEGIN TRANSACTION READ ONLY;
SET LOCAL ROLE anon;
SELECT current_user AS db_role,
 (public.get_crm_operating_context()->>'authenticated')::boolean AS authenticated,
 public.get_crm_operating_context()->>'crm_role' AS crm_role,
 public.get_crm_operating_context()->>'current_tenant_id' IS NULL AS no_tenant_disclosed;
ROLLBACK;

-- 5. Permission denial controls. Run ONE statement per read-only transaction.
-- Each query is EXPECTED TO RAISE 42501 permission denied and roll back itself.
-- BEGIN TRANSACTION READ ONLY; SET LOCAL ROLE authenticated;
-- SELECT count(*) FROM public.provider_applicants; ROLLBACK;
-- BEGIN TRANSACTION READ ONLY; SET LOCAL ROLE authenticated;
-- SELECT count(*) FROM public.therapist_outreach_prospects; ROLLBACK;
-- BEGIN TRANSACTION READ ONLY; SET LOCAL ROLE authenticated;
-- SELECT count(*) FROM public.ai_operations_social_publications; ROLLBACK;
-- BEGIN TRANSACTION READ ONLY; SET LOCAL ROLE anon;
-- SELECT count(*) FROM public.relationship_contacts; ROLLBACK;

-- 6. Remaining test requirements (do NOT run on live single-tenant production):
-- - Two synthetic populated tenants + real signed JWT users A and B on isolated staging;
-- - HTTP PostgREST SELECT/INSERT/UPDATE/DELETE and protected RPC denied A→B and B→A;
-- - Donor view rows present to test tenant crossing (currently returns 0 in production);
-- - Verify SECURITY DEFINER helper restrictions AFTER remediation (do not invoke
--   _crm_idempotency_claim or _crm_idempotency_record mutating RPCs in production).
