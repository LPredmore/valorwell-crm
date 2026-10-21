# Preview recovery receipt v2 and acceptance plan

Reported **2026-10-21 03:41 UTC** by the operator, based on ChatGPT Supabase tools. **Not independently observed by this source follow-up.** [Closed sanitized metadata](migration-recovery-evidence/20261021-0341-branch-followup.json). The [02:02 receipt](2026-10-21-branch-recovery-source-receipt.md) remains unchanged; its 24-version/1122-function/no-Stedi facts describe an earlier state, not the later report.

## Reported verification versus source verification

| Item | Later operator-reported result | Boundary |
| --- | --- | --- |
| Authorized preview | `dskqovrvogmwrlmxsdjd`, `valorwell-security-recovery-20261020`; parent `ahqauomkgflopxgnlndd`; $0.01344/hour | No current existence, billing duration or total-cost query here |
| Native replay | `MIGRATIONS_FAILED`, first `20251201181524` needs `public.set_updated_at()` | Manual reconstruction is not successful native replay; never merge/reset/rebase this branch |
| Restore | Private October 20 schema-only snapshot, 12 batches, branch-only pg_cron 1.6.4, post-export applicant delta, ten staged exact-source files and separate Billing PR #34 Stedi retirement | Private snapshot retained by operator; no SQL or secrets requested/read here |
| Ledger | Production 966, preview 25 | `test_*` shadow versions are not canonical; no fabricated historic ledger entries |
| Tables / RLS | 425 = public361/private51/credentialing13; 408 RLS enabled | Counts are not all-object parity |
| Views / enums / policies / triggers | 37 / 67 / 551 / 368 | Exact object-level differences still require review |
| Indexes | public1385/private156/credentialing37 = **1578** | Uses explicit schema counts, not ambiguous “158?” shorthand |
| Functions | Production1122 / preview1123 | Expected added `private.claim_is_externally_submitted_internal_v1` helper |
| Fingerprints | All tables/indexes and all credentialing objects match; expected changed claim/CRM functions, title trigger, claim-lines trigger | Full per-object diff/identities/hashes not supplied here; do not declare broad categories an automatic allowlist |
| Other drift | `public.relationship_report_metrics_v` differs; 12 `supabase_admin` default-privilege statements omitted; pg_net preview0.20.4 vs production0.19.5 | Unresolved; earlier reported schema placement extensions vs public also remains unreviewed |
| Data / cron | No clinical rows copied; preview cron.job empty | Empty synthetic-history tests cannot establish production retention |
| October catalog gate | Production4/16 PASS,12/16 FAIL; preview16/16 PASS | Existing sixteen-function query, not earlier 14-signature or reported 15-definer sets; no per-RPC observations supplied here |
| Repository DO tests | Five PASS: claim_payroll_internal_rpc_acl, crm_idempotency_internal_acl_contract, crm_automation_event_emitter_acl, internal_campaign_social_worker_acl, legacy_donor_attribution_acl_contract | Operator report; Billing claim/payroll source unavailable in this checkout |
| Other catalog assertions | Campaign missing/foreign 403 marker; claim-line tenant trigger; donor transaction view browser denial; title trigger search path PASS | Markers/catalog are not signed-JWT requests or runtime tenant tests |
| Stedi postdeploy | 4/6 PASS: zero enabled/unclosed routes, zero active Stedi cron, retirement constraint present; two historical attempts/events assertions FAIL with zero rows | Expected schema-only limitation, not evidence historical production rows were lost |
| Advisors | Total480→464; authenticated executable SECURITY DEFINER318→306; anon15→15; RLS-enabled/no-policy info144→143 | Not a clean security bill, no blanket revocations, no production Auth inference from preview settings |

Stored bodies of the ten staged files plus separate PR #34 reportedly match reviewed GitHub text exactly. No per-file hashes/body evidence supplied here; do not manufacture them. Source checks independently pin **available** post-export `20261020214527`: 4771 bytes, SHA256 `a87ad8a61a2e78674df7b757e499d24097b34f6181c167325d4b0df47d9af01f`. This proves checked-in bytes only, not live application or exact export-time coverage. Original private export: 5442397 bytes, SHA256 `4da55b28809507eaa9438a0cb27a7f4335a884ea92dea87551890c0e6ef8230f` (operator reported).

Preserve ten-file ordering in `recovery.RELEASE_ORDER`, with CRM #193 immediately after 00310; separate Stedi `20261018235900` has its own reviewed source/receipt, not an eleventh member of the ten-file set. No relative Stedi execution order is invented from this report. Stripe source00100 was already represented by production-applied `20261019232604` in the snapshot: **do not reapply**. Nothing edits CRM/Billing staged SQL or PRs, branch ledger, records, workers, or deployment.

## Reproducible offline and read-only catalog checks

Source-only CI runs:

```sh
python3 -m unittest discover -s scripts/migration-recovery -p 'test_*.py' -v
python3 scripts/migration-recovery/branch_receipt.py
python3 scripts/migration-recovery/branch_followup.py
```

The new validator pins the existing sixteen-function query SHA256 `2b932817a8f03f68a30382d71c0f8afc133e6cb2a3fbecd482f0af6e59791052`, checks post-export source bytes, and checks closed metadata types/limits. `validate_acl_results` can validate sanitized **first-result-set** rows offline: exactly the sixteen existing labels, PASS, anon=false, service=true, authenticated=true only for manual enrollment/donor overview/donor replay. It rejects duplicate/missing/unknown labels, wrong role grants, extra diagnostics and boolean coercion. It never generates a purported observed 16/16 result. Receipt consistency is not provenance authentication.

An authorized operator may run the pinned `supabase/tests/20261018_october_security_rollout_readonly.sql` inside an explicit **READ ONLY** transaction on the exact preview, with a read-only connection already configured privately. Verify `current_database()` and trusted control-plane identity before execution; database name alone is not sufficient to identify a hosted project. Do not supply credentials as command arguments, repository files or CI secrets. Preserve raw results privately; export only fixed labels/counts/outcomes. The legacy ledger section in that query expects source00100 and is **not authoritative** for a reconstructed 25-version branch or production's applied Stripe version. Evaluate its sixteen ACL rows separately; do not force ledger names to match it. The older 14-RPC local-restore gate remains unchanged.

`preview-drift-readonly.sql` supplies additional read-only catalog summaries for pg_net, managed default-ACL presence and disabled cron. Absence of one owner's ACL entry does not reconstruct the 12 omitted statements or resolve parity. Review exact private default-ACL differences with the managed service owner; never impersonate `supabase_admin` or apply blanket grants/revocations. No live SQL is executed by source CI.

## Historic bootstrap repair strategy

**Source diagnosis:** first migration source is absent; the preserved replay witness references missing `public.set_updated_at()`. The next historic migration `20251201195701` depends on earlier missing tenants/profiles/staff and later role/membership definitions (`20251201200225`). Adding only a guessed timestamp helper cannot establish replay. Existing five-app inventory/replay-blocker documentation records additional incomplete/bodyless history. No new database change is proposed here, so no new ecosystem migration is applied or approved.

Two reviewed strategies, neither executed here:

1. **Authentic historical recovery:** recover original pre-December/bootstrap artifacts and dependency ordering from authoritative backups/repositories. Bind their bytes/ownership to an immutable ledger manifest; review across Clients, Staff, CRM, Billing, Onboarding. Test the entire authentic chain on a new genuine isolated stack. Missing applied bytes must remain missing evidence—not be filled with a guessed function under an old version. A new late migration cannot fix an earlier replay dependency by itself.
2. **New-environment current-state baseline:** after private human secret/dependency/owner/grant/Auth/Storage review, use a complete current-state baseline with exact captured export-time ledger coverage, a separate immutable provenance manifest, and only hash-bound post-cutover deltas. In a separately reviewed fresh-environment deployment track, install the reviewed baseline as a genuinely new baseline version; archive its mapping to production's historical versions outside the runtime ledger. Do **not** insert 966 historic rows to simulate replay or overlay the baseline followed by superseded SQL. CI must demonstrate fresh genuine stack startup and actual intended parity. This is reproducible new-environment provisioning, **not** restored native historic replay. Supabase's existing failed preview cannot become merge-safe by renaming/reconciling shadow versions.

Both require exact managed dependency reconciliation (including extension version/schema drift and omitted default ACLs), private baseline/catalog/ledger evidence and explicit control-plane/deployment approval. Preserve PR #198's first-failure/transaction-rollback smoke and #199's Billing boundary gate. Do not reset/rebase/merge/delete the current branch to implement either strategy.

## Follow-up signed-JWT and synthetic integration acceptance plan

**No live runner is added or executed in this phase.** The hosted preview can execute server-side SQL/Edge requests with provider egress; a client firewall does not isolate those services. Until server-side outbound denial is independently proven, limit it to privately authorized read-only catalog inspection. Mutating synthetic acceptance belongs on a complete **owned isolated genuine Supabase stack** reconstructed from approved exact sources, not a partial fixture model. Existing `private-local-restore.py --keep-stack-for-signed-tests` keeps that owned stack only after its strict private gates pass; the drift-bearing receipt cannot bypass them.

### Mandatory runner preflight (fail closed)

- Explicit one-run authorization and exact stack/project identity bound to restored source/catalog hashes. Hosted identity must be exact preview ref and production ref must be denied; redirects/proxies/unrecognized hosts denied. Never rely only on a display name or a URL substring. Local target must be loopback with attested owned stack identity, pinned image and internal-only Docker network.
- Deny outbound service egress for **database, Auth, workers and mock transports**, with loopback-only exposed ports, cron disabled/empty, no production/provider secrets, no public DNS fallback. Independently test blocked outbound requests from each service; do not call real providers to test blocking. Run workers in an internal network or isolated process with network-denied transport. Hosted preview mutation is blocked unless equivalent server-side isolation is proven.
- Review fixtures against real schemas/constraints and the authoritative `tenant_memberships.profile_id` contract; separate `user_roles`, never invented user_id membership columns. Obtain required CRM #193/Billing #40 sources privately from authorized checkouts and hash them. Missing suite/source/authorization or incomplete object diff stops the run.
- Use genuine GoTrue-issued signed sessions for synthetic users; obtain tokens privately at runtime, never store tokens, PHI, raw SQL, responses or database credentials in receipts/artifacts/logs. Turn off request/error/database statement logging. No service-role JWT may stand in for a browser tenant test.

### Test matrix and concrete assertions

| Suite | Synthetic cases | Required assertions |
| --- | --- | --- |
| Tenant boundary | Authorized admin/staff tenantA, tenantB-only user, no-membership user, readonly member, anon | Own authorized operation succeeds and reads back through PostgREST; foreign target and missing target both HTTP403 for affected enrollment boundary, no disclosure/mutation; missing membership and readonly/anon denied. Independent sessions, actual RLS, unchanged foreign row hashes |
| Campaign lifecycle | Eligible A client/campaign, B client, canceled enrollment, retry, competing leases | Membership predicate uses profile_id; own enrollment queues once; duplicate request/parallel claim has one winner; foreign queue/finalizer denied; cancellation and reply stop future work; audit associations reference synthetic A IDs |
| Claim/payroll | Synthetic claim/lines/staff and non-provider attempts from Billing #40 | Own tenant valid transition; foreign line rejection; external-submission status protected; authenticated/anon cannot execute internal finalizers/payroll; worker identity only on protected internal path. Actual constraints/transactions, no claims transmitted |
| Worker integration | Real checked-in worker source plus isolated DB and in-process or internal-only provider mocks | Suppression/refusal before send; stable idempotency; deterministic mock success,429,permanent failure,uncertain outcome and retry exhaustion; audited one-time finalization; cancellation/lease race. Mock receipts explicitly labeled, never provider acceptance |
| Financial/email safety | Fake Stripe/Claim.MD/Stedi/Resend/Gmail/RingCentral/YouTube endpoints | Only local mocks reachable; no production keys; external request fails closed; replay cannot duplicate mock payment/email/claim result; no real money/messages/media |

Existing `src/test/*worker-runtime.test.ts` executes real handler source with synthetic DB adapters and network-denied defaults. It is useful local orchestration coverage, not genuine full-stack acceptance. Existing campaign runner has signed readonly denial coverage but not the complete own/foreign/missing matrix; do not certify it as complete. Billing #40's 20-case suite and claim/payroll contract must be obtained/reviewed rather than reconstructed from labels. Add and execute the above actual-schema cases only once the preflight blockers are met.

### Stedi synthetic history fixture plan

Obtain the exact reviewed PR #34 schema/retention query and references first. On the egress-denied disposable complete stack, create minimal synthetic closed Stedi route, attempt and event with FK-valid synthetic tenant/claim, inert payload and deterministic synthetic IDs. Capture their row hashes/counts, run the original pre/post-retirement source in its reviewed baseline/cutover order **only if not already represented**, and assert records/relationships unchanged, no enabled/unclosed routes, no active Stedi cron and retirement constraint rejection of forbidden routing. If retirement is already applied, test retained existing fixtures loaded in a separately reviewed pre-retirement setup; never disable the retirement constraint to manufacture a passing fixture. Use rolled-back transactions where possible; fixture cleanup only by synthetic IDs on owned stack. Empty history yields NOT_TESTED, not PASS. A separately approved production **read-only** retention audit is an alternative, not authorized or performed here.

### Receipt and release gates

Record only suite IDs, source hashes, exact stack identity, synthetic case counts/results, egress preflight outcome and limitations in a closed sanitized receipt; failing/pending cases stay failing/pending. Keep independent signed-JWT evidence separate from SQL/SET ROLE catalogs and mocks separate from provider acceptance. Source CI never connects to Supabase or runs fixtures. No PR merge until review and all required hosted checks are green; source merge never authorizes production release. Production release requires separate explicit approval, unresolved drift review, successful actual-schema signed-JWT acceptance and separately authorized integration rollout. The existing preview remains non-mergeable; no branch merge/reset/rebase/deletion action follows.

## Source follow-up evidence and blockers

No Supabase/production/provider calls, migrations, paid resources, Auth setting changes or branch deletion occurred. Review PR/hosted-green proof cannot be produced with available tools: there is no repository write/PR integration exposed; no manual git commit/push/merge was run. Docker executable/daemon is unavailable here; no full restore, native replay, Stedi fixture or signed-JWT run is claimed. Operator-only SQL, exact boundary/catalog and managed review, missing external Billing suites, server-side egress proof and independent authorization remain prerequisites, not requests to upload secrets or private SQL.

| Local verification actually run | Result |
| --- | --- |
| Complete recovery Python suite | **113 PASS**, including 33 new follow-up regressions and all 80 earlier tests |
| Earlier receipt CLI / updated receipt-source CLI | PASS / PASS; offline consistency only |
| Existing network-denied worker runtime suites | **44 PASS** across campaign worker, scheduler and Social HTTP entrypoint; synthetic DB adapters, not full-schema acceptance |
| Capture / preserved #198 smoke shell syntax | PASS; Docker smoke not executed |
| Private restore / isolated replay help | PASS; no execution |
| CRM source inventory / real Billing boundary gate | PASS / PASS; no replay implied; #199 stateful-git fixture not executed |
| Whitespace / latest preview diagnostic | `git diff --check` PASS; `build OK` at 2026-10-21T03:44:26Z |
| Hosted CI / review PR / code commit proof | Unavailable; local checks are not hosted green or a commit/PR receipt |

Touched source: new `branch_followup.py`, `test_branch_followup.py`, `preview-drift-readonly.sql`, versioned metadata and this report; updated source-gates workflow, recovery README, AGENTS and roadmap. No existing SQL migration, original branch receipt, #198 smoke or #199 boundary implementation was changed. No application UI changes or manual application build/typecheck.
