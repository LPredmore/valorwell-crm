# Browser-invocable idempotency helpers: direct EXECUTE restriction

2026-10-18 catalog inspection of the live Billing Hub found authenticated users
could execute `_crm_idempotency_claim(text,text,uuid,uuid)` and
`_crm_idempotency_record(text,text,jsonb)` directly. Both run SECURITY DEFINER
as postgres. The claim function trusts caller-supplied tenant/target IDs when
inserting a key and lacks its own membership check; the record function can
update a keyed result. No direct write or exploit attempt was made.

The six identified internal callers are postgres-owned SECURITY DEFINER
campaign lifecycle functions. A forward-only migration revokes browser
EXECUTE on only the two private-intent helpers while preserving service_role
explicit grants and owner execution. No function bodies, table ACLs, RLS,
campaign data or email workflows change.

## Verification required before merge
1. Run the migration and rollback-only catalog assertions in a disposable,
   representative CRM database with both helper functions and six callers.
2. Run real signed-JWT HTTP RPC denial tests: anon and authenticated direct
   calls to both helpers must be refused.
3. Run a synthetic authorized campaign lifecycle sequence using all relevant
   caller RPCs; confirm internal idempotency and audit behavior are unchanged.
4. Run lint, tests and Application CI. Do not deploy or send live campaigns.
5. Reinspect function ownership and grants on the actual target before
   applying a forward migration. A caller becoming SECURITY INVOKER or changing
   owner requires redesign rather than blindly deploying this correction.

This PR is a reviewable hardening proposal. No production database modification
or isolated execution is claimed by creating the migration.
