# CRM automation event emitter: direct RPC authorization gap

Date: 2026-10-18. Canonical tracking: existing CRM roadmap task 03D, campaign/email worker RPC subtask. This is a distinct call path missed by the prior PR #178 worker-only ACL hardening.

## Verified live, read-only evidence

- `public.crm_emit_automation_event(uuid,text,text,uuid,text,jsonb,text,uuid,timestamptz)` is owned by `postgres`, is `SECURITY DEFINER`, and has direct `authenticated EXECUTE`.
- The RPC accepts a caller-supplied tenant ID, event type, subject ID, idempotency key, payload, source and occurrence time. Its body does not check the caller's tenant membership or CRM mutation capability.
- It inserts into `public.crm_automation_events`, then calls `public.crm_enqueue_campaign_trigger_jobs`. If the target tenant's campaign trigger engine is enabled, the latter may create campaign trigger jobs. Restricting the helper in PR #178 alone does **not** prevent this owner-executed nested call.
- A catalog search of Postgres function source located 12 DB call sites that reference the emitter. All 12 are `postgres`-owned `SECURITY DEFINER` functions: 11 in `public` and `private.crm_process_donor_transaction`. This is a caller inventory for the observed DB schema, not proof that there are no external consumers.
- Existing direct `service_role EXECUTE` is true. No live event or campaign state was changed to investigate this.

## Targeted correction

The forward-only `20261019000600_restrict_crm_automation_event_emitter.sql` migration revokes direct `EXECUTE` from `PUBLIC`, `anon` and `authenticated`, preserving `service_role` and `postgres`. It does not change the emitter body, table rows, RLS, campaigns, queue flags, transports, or event consumers.

Order after the existing cross-repository planned migrations 20261019000100 through 20261019000500; use the same shared Supabase history, with no duplicate migration version.

## Release gate (not completed by source merge)

1. On a disposable representative migrated database with synthetic data, run `supabase/tests/crm_automation_event_emitter_acl.sql` and confirm relevant catalog assertions. Confirm full CRM + Billing Hub migration sequence, without using production as a test sandbox.
2. With real signed GoTrue identities over PostgREST, assert direct emitter call denial for anonymous, ordinary authenticated, readonly, and a different-tenant operator. Test trusted `service_role` and existing postgres-owned trigger/wrapper call paths positively, including cross-tenant denial at the public entrypoint that causes the legitimate event.
3. Confirm event deduplication, expected campaign-job behavior for synthetic fixtures, and **zero external emails, payments, video publishing, or claim submissions**.
4. Check CRM and Edge callers for any intentional direct end-user emitter invocation not visible in the database inventory. Such callers must be routed through an authorized server entrypoint instead of restoring direct browser privileges.
5. Only after the combined acceptance passes, deploy the versioned migration in order. Verify `has_function_privilege` for `anon`, `authenticated`, `service_role` and review live advisors and worker logs. Do not mark CRM roadmap 03D complete without remaining RPC review.

**Status:** migration and catalog test are source-only. No production migration applied; no functional acceptance claimed.
