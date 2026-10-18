# October 18, 2026 — CRM/Billing security release gate

**Status: PRE-PRODUCTION / NOT AUTHORIZED FOR BLIND ROLLOUT.** This is a shared Supabase instance (Billing Hub project `ahqauomkgflopxgnlndd`) used by multiple ValorWell services. This document is not evidence that a source merge changed live production permissions.

## Verified read-only production baseline

At the time of this audit, `supabase_migrations.schema_migrations` contained 957 versions and the newest was `20261018123031`. None of the planned `20261019...` security versions appeared. No Supabase development branches were available. No live SQL migration, real donor write, payment posting, campaign enrollment, claim submission, or YouTube publishing was performed.

The exact source-backed inspection query is `supabase/tests/20261018_october_security_rollout_readonly.sql`. It has been executed as read-only SELECTs against live production:

- 16 privilege-contract cases: **13 FAIL**, **3 PASS**, as expected on the pre-hardening database. The direct Stripe payment posting function still allows anonymous and authenticated EXECUTE; the campaign emitter and reviewed internal worker RPCs still allow authenticated EXECUTE.
- 4 non-mutating contract checks: legacy Givebutter historical replay still not fail-closed, donor overview still not explicitly unavailable, mutable-search-path trigger still uncorrected, and legacy cross-tenant donor transaction view browser denial **PASS**.
- These are catalog/body tests, not signed-identity HTTP acceptance and not exploit reproduction. A healthy migration import alone does not imply browser/worker behavior is safe.

## Mandatory single-database migration ordering

All repositories share **one** deployment ledger; do not independently push whichever repository's migrations are first. Use one reviewed ordered sequence without renaming source versions after acceptance:

| Sequence | Repository | Exact migration version / purpose |
|---|---|---|
| 1 | valorwell-billing-hub | `20261019000100_stripe_checkout_payment_service_only.sql` — remove direct browser Stripe payment posting |
| 2 | valorwell-crm | `20261019000200_revoke_direct_crm_idempotency_helpers.sql` — prevent direct browser idempotency helpers |
| 3 | valorwell-billing-hub | `20261019000300_claim_payroll_internal_rpc_acl.sql` — isolate claims and payroll workers |
| 4 | valorwell-crm | `20261019000310_campaign_lifecycle_authorization_and_idempotency.sql` — actor, tenant, operation and concurrency safeguards |
| 5 | valorwell-crm | `20261019000400_internal_campaign_social_worker_acl.sql` — isolate Social Media/campaign jobs |
| 6 | valorwell-crm | `20261019000410_ai_ops_title_trigger_search_path.sql` — pin trigger path |
| 7 | valorwell-crm | `20261019000500_fail_closed_legacy_donor_attribution.sql` — no unverified Givebutter tenant assignment |
| 8 | valorwell-crm | `20261019000600_restrict_crm_automation_event_emitter.sql` — close privileged event-emitter wrapper route |

Preflight must re-read the live ledger and **all three** checked-out migration directories (CRM, Billing Hub, Clients) immediately before deployment and reject duplicate versions for different SQL content or any unexpected interleaved migration. PR #180 added a cross-repository uniqueness check, but rerun it against the current repositories.

## Acceptance required before production changes

1. **Isolated real signed-JWT negative tests:** true anon, readonly, ordinary authenticated and foreign-tenant users must be denied each newly internalized RPC; verify that `crm_emit_automation_event` cannot bypass the already restricted job helper and foreign-enrollment manual/lifecycle actions are denied.
2. **Positive worker tests in synthetic environment:** trusted service-role Stripe webhook RPC remains callable without a real payment; claim/Stedi finalizer and payroll worker valid paths retain grants; authorized owned Social Media publish queue enqueues exactly once without external YouTube; CRM trigger, newsletter, inbound email and campaign orchestration continue through postgres-owned or server-owned paths. No live sends.
3. **Data compatibility:** revised legacy `crm_donor_overview` returns `totalDonations=null` with explicit reason and the UI does not present an empty/zero donation count incorrectly. Historical replay refuses to associate globally unowned Givebutter transactions. No source record deletion. Existing Zeffy scoped reporting preserved.
4. **Campaign lifecycle:** genuine signed operator/admin positive and readonly/foreign denial, idempotency cross-actor/tenant/target/operation reuse fail-closed, same-key and different-key concurrency append exactly one transition audit. Confirm the previous 78-scenario SQL/JWT result still passes current main.
5. **Security release and monitoring:** capture GitHub CI, isolated acceptance logs and operator authorization; apply the *exact* eight reviewed migrations in order with the project's proper migration history tooling. Record the version ledger, execute the read-only `20261018_october_security_rollout_readonly.sql` script and require all privilege rows PASS and all four extra checks PASS. Recheck Supabase advisors, webhook/worker logs and a bounded authenticated browser smoke suite. Do not interpret blanket 16/316 advisory counts as 332 confirmed vulnerabilities.
6. **Follow-on, not part of these eight migrations:** separately test the observed `public.claim_is_externally_submitted_v1(uuid)` claim-status existence oracle with a synthetic two-tenant signed JWT. Do not revoke it blindly: invoker claim-protection triggers call it. Finish full roadmap 03D and 03C signed two-tenant acceptance.

## Rollback and interruption controls

The source changes are forward-only privilege/body corrections, not data transformations. Before production application, keep the original function definitions/grants and owner contracts as the rollback reference, and record current live grants and trigger state. An interrupted rollout should halt further migrations, check whether permissions are now too narrow, and use a reviewed forward correction or independently approved rollback after checking that unauthorized direct browser calls are not reopened. Never temporarily grant arbitrary browser execution to recover a worker that should use `service_role`.

**Operator handoff:** merge to main is source readiness only. Until Codex's independent acceptance report is reviewed and any deficiencies repaired, do not mark the production release or Todoist roadmap acceptance as complete.
