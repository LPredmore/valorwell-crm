# October 19 acceptance execution — production NOT READY

This continues PR #188's release gate. It is execution evidence for source and
isolated testing, not a new audit or production deployment authorization.

## Completed and retained results

- Four main branches synchronized. CRM PRs #181–#188 and Clients #35 are merged
  ancestors of main; no reference commit was reverted.
- Clients #36 merged as `19b86564b011e8cc07fc12311674c0046498bc0e`.
  Baseline broad discovery reproduced 231 PASS / 8 FAIL and the deleted staff
  form load failure. Final discovery: **241 PASS / 0 FAIL / 0 SKIP**. All eight
  obsolete contracts now exercise canonical client RPCs and external staff
  navigation. The removed specialty-editor tests are documented in the Clients
  auth README, including the December 2025 deletion commit. No staff editor was
  restored. Client-only, staff-only, dual-role and CRM-only cases are maintained.
  Lint, type-check, build and all three GitHub CI checks passed.
- CRM main `80366a8e9ad40cb33f0df37c84350bd1c604d805`: **923/923 source tests**,
  lint, application and Node type checks, production build, ownership boundary
  and clinical-recovery provenance checks passed.
- Original command `scripts/run-campaign-lifecycle-acceptance.py` with
  `--billing-repo /workspace/valorwell-billing-hub`,
  `--clients-repo /workspace/valorwell-clients`, `--output-dir <evidence>` and
  `--extended-workers` passed **87/87**, with actual signed GoTrue JWT outcomes.
- Billing #25 merged as `6f23c46c87dd6144242741cc71d6cb2626fa6ba1`.
  Separate migration `20261019085103_claim_status_authorization_boundary.sql`
  authorizes the public helper through the existing billing-role contract,
  keeps the full evidence predicate private, and preserves all three protection
  triggers. It additionally closes the foreign line-reassignment error oracle,
  tenant-only rehoming and inconsistent legacy parent associations.
  Final claim suite: **96/96**. Same assertions without correction: **94/96**,
  reproducing direct foreign lookup (HTTP 200 true) and foreign line reassignment
  (distinguishable P0001/HTTP 400). Both become uniform HTTP 403. Authorized
  tenant billing, service, draft deletion, interactive/system reservation, replay,
  six evidence sources, PCN/line immutability and evidence enrichment pass.
- Billing #26 merged as `b9c43f6487ab5b81c179303791b37da6112cd9b7`.
  The optional `run-claim-status-acceptance.py --extended-financial` supplement
  retains every original group and passes **102/102**. It runs recovered actual
  Claim.MD/Stedi finalizers and payroll reconciliation bodies, including signed
  browser denial, trusted service paths, state transitions, newest-attempt
  selection and local replay/duplicate suppression. It executes the exact nine
  reviewed migration files in order on the prepared scoped fixture and verifies
  browser/service worker ACLs. Linux loopback tooling is checked in and guarded.
  GitHub reported no CI checks for these two Billing PRs; local proof, not a CI
  green badge, is the evidence. Billing build and Python compilation passed.
- Chromium local production-build navigation passed at 1440×1000 and 390×844
  for CRM and Clients: protected anonymous navigation reaches `/auth`, one
  password input, no page exceptions or horizontal overflow, and no detected
  WCAG A/AA axe violations. Every external request was blocked. This says
  nothing about signed hosted navigation or external EMR acceptance.

## Current read-only production checkpoint

The ledger remains **961** versions through `20261018171201`. Exact #188 SQL
checks were rerun using SELECT/catalog queries only: **3 PASS / 13 FAIL** ACL
rows, **1 PASS / 3 FAIL** original follow-ups, all **nine versions MISSING**, and
the HTTP-403 body check **FAIL**. All 16 inspected release functions are owned by
postgres. These expected pre-deployment failures are not acceptance passes.
No production function was invoked or changed by these catalog checks.

The nine rollout migration contents/versions/order remain unchanged. The four
October 18 relationship migrations are not included for replay. The claim fix is
separate from the nine-file package and needs its own controlled rollout review.

## Evidence and reproducibility

The execution bundle contains command arguments, working directories, exit
codes, complete machine-readable test results, SQL scripts/stdout/stderr and
active-cluster guard proofs, signed positive/negative JWT outcomes, browser
screenshots/axe results, current catalog/ledger checks and ordered migration
SHA-256 manifest. Raw database directories, ephemeral auth env files, secrets and
JWT strings are excluded/redacted. The downloadable ZIP is delivered with the
session execution report. It was not uploaded as a GitHub Actions artifact.

Run Billing's `scripts/README-claim-status-acceptance.md` with reviewed CRM and
Clients checkouts to reproduce. The original source/migration assertions remain
unchanged. Source snapshots add SQL terminators to catalog definitions for import.

## Material limitations and remaining gates

1. **Full schema is incomplete.** Across the three checked-out repositories,
   637 of 961 applied migration versions have no source file. Current catalog
   inspection has 361 public and 51 private tables, 794 public and 307 private
   functions, plus auth/storage objects. Recovery retained current clients,
   tenants, staff, set_updated_at and scoped claim/payroll definitions. Historical
   clinicians DDL exists in Clients, while current schema uses staff. A complete,
   reviewed schema-only baseline with constraints, policies, triggers, grants,
   extensions and function dependencies is still required for faithful replay.
   Do not synthesize replacement production contracts to fill this gap.
2. **Scoped dependency limits remain.** Catalog-derived claim/payroll fixtures
   retain columns/defaults/nullability/enums and non-FK constraints, but omit
   external clinical/auth FKs, unrelated triggers and the extra staff/admin
   policy. The CRM engine still has explicit identity/feature-flag dependency
   stubs. Nine-file execution was on an already prepared scoped fixture; it does
   not establish a clean full-schema migration rollout.
3. **Remaining integration:** actual Stripe webhook-to-payment posting,
   provider-mocked submission orchestration/retry/idempotency, complete trigger
   rule evaluation and queue processing, and staff browser workflows remain
   unverified. Actual deployed Edge source was recovered read-only for Stripe,
   claims, Stedi, payroll and campaign workers; snippets confirm service-client
   construction and relevant RPC call sites where present. Source compatibility
   is distinct from executing those deployed transports.
4. **Signed hosted/browser acceptance:** requires supported non-production
   accounts in two independently authorized tenants, admin/operator/readonly
   and client/staff/dual/CRM-only roles. No such preview accounts were supplied.
   Source coverage and anonymous local browser checks do not replace task,
   tenant switching, contact/opportunity, recruitment or email-review UI UAT.
5. **Billing baseline quality:** repository-wide lint reports 215 errors and
   11 warnings in unchanged application source. Application TypeScript checking
   exceeded a 12-minute local validation budget without diagnostics and was
   explicitly terminated; it is BLOCKED, not passed. The focused SQL/Python
   changes did not change application TS. Repair/finish these independent gates.
6. **Human gates:** review evidence; provide/approve the authoritative schema-only
   baseline and safe preview identities; perform manual application acceptance;
   authorize the exact controlled production deployment separately. Immediately
   before any approved rollout, recheck live ledger/grants/bodies/owners and
   confirm no concurrent migrations. Afterward require all catalog checks PASS
   and inspect bounded worker/runtime behavior without real transactions.

**Decision: NOT READY for the controlled nine-migration production deployment.**
No production migrations, real communications, payments, claims, payroll actions,
clinical/financial record changes, publishing or paid infrastructure were initiated.
