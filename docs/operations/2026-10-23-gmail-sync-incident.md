# Gmail P0 — verified incident and gated source repair

## Status

**Source prepared; not deployed; live sync NOT verified; history NOT reconciled.**
No production SQL, worker deployment, provider reconciliation, emails, stage changes,
ledger edits, paid resources or branch operations were performed here.

## Direct read-only evidence (UTC)

- 14:52:53: production ledger 996, maximum version `20261023132446`; all four
  `20261022195806`, `20261022195848`, `20261022195938`, `20261022200829` absent.
  `private.relationship_gmail_source_receipts` absent.
- 14:53:34: active canonical Gmail connection `81446fa9-dd3f-424a-8fe1-487d95e85af5`;
  cursor **3485910**; verified success **2026-10-22 15:00:55.843913**;
  notification **2026-10-22 21:16:36.564128**; watch expiry
  **2026-10-30 14:17:01.462**. Age 85,959 seconds. Error `gmail_sync_failed`:
  missing `public.record_relationship_gmail_retrieval_failure(p_message_id,p_status)`.
- Catalog confirms both receipt/failure RPCs and source report/diagnostics absent.
  Existing ingest/match/state/backfill RPCs remain postgres-owned definers with
  empty search paths and service-only EXECUTE; reviewed private audit/triage/group
  tables have RLS and restricted grants. Existing global provider-message unique
  index and open-issue partial unique index are present.
- 14:55:56: pg_net response evidence contains **seven** missing-retrieval-RPC 502
  responses at 09:17 through 14:17 inclusive (12:17 also has an additional response).
  Transport DNS timeouts were also observed but not attributable to Gmail without
  dispatch request IDs. Cron jobs 30/31/105/106 are enabled; dispatch success is
  not ingestion success. Dedicated Edge log tools and analytics returned no logs;
  that does not establish absence of execution. Deployed versions/source could
  not be independently retrieved through available read-only tools.
- 14:58:29: ledger had concurrently advanced to **997**, receipts still absent,
  cursor unchanged, same success/notification/watch/error, age **86,253 seconds**
  (**23h 57m 33s**). 14:59:43 maximum version `20261023145419`.
- Open Gmail sync issues and historical gaps: **0**, not proof of recovery because
  the recorder is missing. Gmail observation flag true; calendar observation false.
  Neither was changed.
- Security advisor: 477 aggregate findings (152 RLS-without-policy informational,
  1 extension location, 14 anonymous definer, 309 authenticated definer, 1 password
  protection). None proves this missing writer exists; no blanket revocations made.
- Final read at **15:01:06.577029 UTC**: cursor **3485910**, receipts absent, same
  `gmail_sync_failed` missing-function error; age **86,411 seconds / 24h 00m 11s**.
  No provider message recovery counts were established.

## Root cause and provenance

Commit `fd77cbe59cd70578a6187ae2783ff88c76e10287` introduced the receipt/failure
calls and the four SQL sources together. Git sync can deploy changed Edge code
but **does not apply migration files**. The observed state is consistent with a
code-before-database release. This mechanism is documented by Lovable; the exact
operator omission/review/deployment event is **unverified**, not inferred from the
ledger. Newer migrations are present under both matching and differing source
versions/names; timestamp ordering is not a safe release strategy.

Original files are unchanged and pinned by `scripts/gmail-recovery/verify-source.py`.
The supplied October 20 private baseline predates this incident and cannot establish
current-state parity after 997 ledger entries. Preserve all prior recovery receipts.

## Five-app impact and minimal closure

Read-only snapshots inspected: Clients `c4033530`, Staff `9bf4717b`, Billing
`4f3478ca`, Onboarding `15910787`; current CRM source. Other apps contain generated
relationship RPC/table declarations; no competing receipt/failure implementations
were found. Billing has indirect legacy CRM task consumers, so broad task/ingestion
replacement is excluded. Snapshots are not proof of current remote heads.

The four original files also replace anchored link repair, review-task cleanup/linking
and secondary-recipient behavior. They depend on private triage/audit/review groups,
CRM task triggers/context/permissions, relationship contacts/opportunities/replies,
observations, email/activity records, header parsing, Google state and connection
tables. These nonincident behaviors require separate review; never bundle them into
an emergency blind cherry-pick.

The staged incident candidate adds only the private receipt table, two missing
service-only writers and a non-mutating runtime handshake. Dependencies: tenant FK,
existing issue columns/defaults/partial unique index, ingest/match/state/backfill RPCs,
postgres ownership and private schema. It does not replace existing ingestion,
calendar, task cleanup, association repair, CC functions or any trigger. Receipt
source must be actual full provider retrieval; NULL/foreign tenants, draft labels,
thread and existing RFC conflicts fail closed. Reapplication intentionally stops
for fresh inspection rather than overwriting concurrently created objects.

## Source deliverables and verification

- `supabase/staged-migrations/20261023150000_crm_gmail_receipt_incident_repair.sql`:
  **not auto-applied**, does not claim any original version was applied.
- `scripts/gmail-recovery/relationship-google-sync.candidate.ts` + `worker.patch`:
  non-deployed worker candidate; contract check before provider access, preserves
  provider status when failure recording fails, accurate unavailable/ambiguous counts.
- `daily-monitor.candidate.ts` + `daily-monitor.patch`: non-deployed 60/240-minute
  rules, persistent stalls no longer suppressed by unchanged timestamps. Daily
  cadence is still insufficient for timely alerts; monitoring scheduling requires
  a separate approved release. Existing UI diagnostic refresh provides 60/240
  severity when the diagnostics RPC becomes available; it is not an unattended pager.
- `catalog-readonly.sql`: sanitized operator evidence query; no mail/token/body export.
- Offline source verifier + CI job: pins original migrations/current worker and
  proves candidate equals zero-fuzz patch. Fails closed on concurrent source drift;
  CI cannot authorize deployment or read live schema.
- Focused provider/cursor/receipt/PGlite/UI tests run locally; PGlite dependencies
  and auth are synthetic, **not complete-schema or signed-JWT/PostgREST proof**.
  Final run at 15:00:43 UTC: **70/70 tests, 9 files PASS**. Offline source verifier,
  repository boundary and diff whitespace checks PASS. Harness build/typecheck
  reported **build OK at 15:00:59 UTC**. Hosted CI was not observed.
  Staged SQL SHA256:
  `6d4fa04b2b6afe0fbee4229f5bb12e2856b6a2b153ae3cbed55ffbabfc7887b0`.

## Required release and acceptance (blocked, not performed)

1. A shared-schema release reviewer must reconcile a **fresh** catalog/ledger receipt
   and concurrent source heads, review the minimal SQL hash/ownership/grants/index
   dependency closure, and approve it separately. Do not `db push`, repair old ledger
   rows, rerun the four historical versions, or overwrite concurrent objects.
2. Authorized isolated runner: genuine complete Supabase/PostgreSQL stack, managed
   dependencies reconciled, cron disabled, synthetic records and denied server egress.
   No Docker daemon or retained exact-stack sockets exist in this sandbox. Test real
   signed anon/authenticated own/foreign/missing-tenant callers denied both writers,
   direct private reads/writes denied including CRM admins; trusted service retrieval
   succeeds; draft/NULL/foreign/conflicting receipts fail; retries do not duplicate
   communication/observation rows; stages/campaign/work queues remain unchanged.
   A test JWT with admin role must not gain service writer access. Use no real mail.
3. Only after those results and explicit production approval, submit the exact reviewed
   staged SQL through the migration release tool as a **new forward version**. Preserve
   original four source files/ledger absence; capture actual migration receipt/hash.
   Schema cache reload follows object creation, never replaces it.
4. Service PostgREST handshake `get_relationship_gmail_runtime_contract()` must return
   `{contractVersion:1,ready:true,failures:[]}`. Verify both writer argument names from
   the API contract and signed browser denial. A SQL catalog pass alone does not
   verify exposed PostgREST. Pin/download deployed sources and versions separately.
5. Apply reviewed `worker.patch` only when source verifier passes, then deploy exactly
   `relationship-gmail-push` and `relationship-google-maintenance` after DB acceptance.
   Preserve OIDC/OAuth; no calendar activation. Existing watch renewal can clear error
   fields via the current state RPC: **last successful reconciliation**, not empty
   error text or valid watch, is the acceptance signal.
6. Authorized provider operator runs one bounded Gmail-only reconciliation; current
   maintenance default also attempts calendar, so use a separately reviewed Gmail-only
   invocation/candidate before live testing. Track actual HTTP result, processed IDs,
   matched/ambiguous/unavailable counts and before/after checkpoints. No test email,
   mass send, campaign activation or association-repair apply is authorized.
7. Reconcile history from saved cursor 3485910 and last verified success. Continue
   bounded pages without skipping records. On expired history, durable gap must precede
   fresh cursor; lease/checkpoint backfill must complete or enumerate remaining debt.
   Zero open issues cannot substitute for that evidence; unavailable messages remain
   review exceptions, not proven deletions. Count unique provider IDs rather than
   replay attempts; **missed/recovered/ambiguous live message counts are unknown here**.
8. Fresh success must advance due actual provider verification (including quiet mailbox
   no-change response), PGRST202 must stop, watch remain valid, no duplicates/stage/send
   mutation. Record separate source/deployment/live/history statuses. A reviewed commit
   or isolated pass does not alone authorize production release.

No manual commit/push/merge or review PR was created; Lovable manages source sync.
Hosted CI/review status and deployed Edge version proof remain unavailable here.