# CRM / Billing Hub security release reconciliation — 2026-10-19

> **Status: predeployment evidence, not a release approval.** Re-run every read-only query immediately before a rollout: another session changed the live migration ledger during this review. This record intentionally contains no patient data, credential values, event payloads, or production test writes.

## Systems and provenance
- Shared production Supabase: `Billing Hub` (`ahqauomkgflopxgnlndd`).
- Source repositories: [CRM](https://github.com/LPredmore/valorwell-crm/tree/main/supabase/migrations) and [Billing](https://github.com/LPredmore/valorwell-billing-hub/tree/main/supabase/migrations). Keep their migration versions in one unified release ledger.
- Source tested in earlier PRs, including [CRM #191](https://github.com/LPredmore/valorwell-crm/pull/191), does **not** establish the current hosted worker, trigger, or provider behavior.

## Snapshot of the actual live state
Read-only SQL earlier this evening returned 961 migration rows, latest `20261018171201`. During this review, a different session applied the Stripe ACL patch. Latest verified count is **962**, with one new row `20261019232604 stripe_checkout_payment_service_only`. The **recorded SQL text matches exactly** Billing source `20261019000100_stripe_checkout_payment_service_only.sql`, but its migration **version differs**. Actual `public.process_stripe_checkout_payment(text,text,integer,uuid[],uuid[])` EXECUTE: `authenticated=false`, `service_role=true`. **Do not apply the same patch again solely because its source version is absent. Do not edit migration history to paper over divergence.** Determine the canonical reconciliation method at the release gate.

Nine *other* October 19 SQL files are present in source but not yet recorded under their source versions as of this snapshot:

| Order | Repo | Migration | Gate |
| --- | --- | --- | --- |
| 1 | CRM | `20261019000200_revoke_direct_crm_idempotency_helpers.sql` | Negative direct-RPC tests + trusted lifecycle positive control |
| 2 | Billing | `20261019000300_claim_payroll_internal_rpc_acl.sql` | Claim.MD/payroll server-role workers; no Stedi submission |
| 3 | CRM | `20261019000310_campaign_lifecycle_authorization_and_idempotency.sql` | Genuine signed tenant/role and same-key/replay race checks |
| 4 | CRM | `20261019000400_internal_campaign_social_worker_acl.sql` | Browser denial + authorized synthetic worker enqueue; NO publish |
| 5 | CRM | `20261019000410_ai_ops_title_trigger_search_path.sql` | Compile trigger; synthetic downstream invalidation behavior |
| 6 | CRM | `20261019000500_fail_closed_legacy_donor_attribution.sql` | Givebutter legacy only: null/unavailable UI, deny unverified replay; preserve all historic rows |
| 7 | CRM | `20261019000600_restrict_crm_automation_event_emitter.sql` | User direct denial + legitimate SECURITY DEFINER trigger event |
| 8 | CRM | `20261019000800_campaign_lifecycle_forbidden_response.sql` | Requires 00310; missing and foreign requests both return 42501/403 |
| 9 | Billing | `20261019085103_claim_status_authorization_boundary.sql` | Separate follow-on: genuine own/foreign claim checks and submitted-claim/line/status-event immutability |

**Release order is dependency order, not permission to execute it.** Recompute version/state/dependencies from all repositories immediately before any rollout. Some checks should be performed on an isolated full-schema fixture before any production changes.

## Preflight: read-only production queries
```sql
select count(*) as total, max(version) as newest,
       array_agg(version || ':' || name order by version)
         filter (where version like '20261019%') as october_19_entries
  from supabase_migrations.schema_migrations;

select p.oid::regprocedure::text as signature,
       has_function_privilege('anon',p.oid,'execute') as anon_exec,
       has_function_privilege('authenticated',p.oid,'execute') as authenticated_exec,
       has_function_privilege('service_role',p.oid,'execute') as service_exec,
       p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and p.proname in (
     '_crm_idempotency_claim', '_crm_idempotency_record',
     'crm_emit_automation_event', 'crm_enqueue_campaign_trigger_jobs',
     'crm_correlate_client_email_reply', 'crm_evaluate_campaign_concurrency',
     'social_queue_publish', 'claim_is_externally_submitted_v1',
     'finalize_claim_submission', 'reconcile_payroll_line_items_from_attempts',
     'payroll_refresh_historical_gap_findings_v1',
     'process_stripe_checkout_payment'
   )
 order by signature;
```
Read the **function bodies and all dependent callers** before revoking an RPC; EXECUTE grant alone does not prove exploitation or lack of function-level authorization. Check `pg_policies`, exposed view security mode, default ACLs for both `postgres` and `supabase_admin`, and [Supabase security advisors](https://supabase.com/docs/guides/database/database-linter) after the candidate migrations.

## Release gates (all required)
1. **Freeze and reconcile** exact CRM, Billing, Clients, Staff main SHAs and all shared production migration versions, including dynamically timestamped apply-migration entries. Confirm the Stripe patch's equivalence and no later competing deployment. Never use stale ledger numbers from a previous conversation.
2. **Isolated full-schema dry-run**, no paid preview branch or production test tenant without explicit approval. Use real GoTrue-issued JWTs for at least two synthetic tenants and administrator, operator, viewer, anonymous, expired and foreign identities; use fake queues and fake providers. Validate reapplication/ordering and rollback design. Prior mock-only tests are insufficient for this release.
3. **Privilege denial and trusted positive controls** for idempotency, CRM worker/event chain, Social Media queue, claim/payroll workers, Stripe webhook-to-posting, and campaign lifecycle. Ensure browser cannot directly invoke internal SECURITY DEFINER endpoints; legitimate trusted Postgres/Edge callers must still function. Do not send actual campaigns or publish media.
4. **Claim integrity**: `claim_is_externally_submitted_v1` needs tenant-authorized public lookup plus a privileged internal historical check. Preserve submitted-claim, claim-line and status-evidence protection triggers; test foreign claim, missing claim, inconsistent tenant reparenting, and legitimate write denial/acceptance. Claim.MD must **never manufacture an accepted submission** when credentials/provider acknowledgments are absent.
5. **Historic donor isolation**: prior Givebutter events lack trustworthy tenant attribution; do not project global totals as tenant totals or enqueue historical records into arbitrary tenants. The UI must distinguish `unavailable` from `zero`. Zeffy processing remains separate.
6. **Provider retirement boundary**: Stedi is **retired**. Billing 00300 still mentions a legacy Stedi DB function because restricting an existing unsafe entrypoint can be appropriate until full removal. This does not authorize reactivation or replace the separate Stedi routes/cron/Edge decommission. Preserve immutable historic claims and unresolved attempts; no new Stedi integration tests or live submissions.
7. **Hosted acceptance and sign-off**: verify production grants, advisors, authentic portal roles, authorized campaign scheduling, Social Media queue, and no regression in Billing/Clients/Staff. Maintain rollback/recovery evidence and owner-approved release window. Any changed Auth config must preserve client/clinician redirect flows.

## Explicit GRANT transition — October 30
[Supabase Data API guidance](https://supabase.com/docs/guides/api/securing-your-api): new exposed public objects require **explicit, least-privilege grants** along with tenant/capability-scoped RLS. Earlier default ACL audit showed broad automatic table/function/sequence grants for both `postgres` and `supabase_admin` in this existing project. Do not blanket-revoke defaults in live production without full caller inventory. Add explicit `GRANT`/`REVOKE` and RLS to **each new object's migration**, including service-role-only or deliberately unexposed contracts; test clean/new environments and existing deployment replay.

## Completion definition
A PR merged to main or isolated tests passing is **not** sufficient. Close the affected Todoist issues only after accurate shared migration ledger reconciliation, production ACL verification, full schema/worker acceptance, original business workflow regressions, and release evidence. Never move protected clinical history, send email, charge cards, submit claims, or publish video as a test.
