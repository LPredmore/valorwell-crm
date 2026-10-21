# Native CRM/Billing implementation and completion report

The private baseline dependency has been replaced with a new schema-only candidate,
and native development provisioning, worker acceptance, tenant tests and cleanup
now run from a clean checkout. **Full acceptance and production release remain
NOT READY.** Production, provider accounts and the failed hosted diagnostic branch
were not modified.

## Implemented and published

Draft [CRM PR #203](https://github.com/LPredmore/valorwell-crm/pull/203) is stacked
on [#202](https://github.com/LPredmore/valorwell-crm/pull/202). It preserves CRM
#193/#200 and Billing #34/#40/#44/#50; none were merged or replaced.

| Commit | Implementation |
|---|---|
| `c27e07ebed7bde26ba1954db913cef8b2b67b0f8` | Native Docker provisioning, real Auth/Storage/PostgREST/Realtime, private catalog capture/finalization, restore, worker bridges, fixtures and owner-verified cleanup |
| `568f02f595426781efd4b7f8152d6085a4a6380b` | Tenant-bound Storage candidate, uploader metadata, native application billing roles and Stedi/line-protection tests |
| `f947c2d6ea188a29d958c06c4f7a2d1689936ffc` | Genuine signup/profile hook and Realtime broadcast tests; explicit generic probe ACL |
| `c7e3f18ee633159c8cbc2ae4e749801655b0f83a` | All six application/import/legacy-backup schemas included; unknown schemas fail closed |
| `d1ce810c` | Native payroll rate boundaries, decimal statement arithmetic and failed-attempt reconciliation |
| `63553e1f` | Hash-bound private payroll 403 candidate, full input hash verification and fixture contract correction |

The new Storage SQL stays under `supabase/verification`, outside automatic
migrations. It binds object tenant metadata to trusted JWT tenant context,
membership and CRM write capability. The email-signature uploader supplies that
metadata while preserving flat filenames. Untagged legacy objects fail closed for
writes; no production attribution/backfill was attempted.

The existing ten security deltas retain their ordering, including the unchanged
#193 `profile_id` correction immediately after lifecycle migration 00310. The
original Stedi retirement SQL is exercised separately. No application historical
migration entries are fabricated, renamed or inserted. The
[forward-only rollout proposal](2026-10-21-forward-rollout-proposal.json) binds
source hashes and gates; it authorizes no execution and never applies this baseline
to production.

## Executed tests

Counts below describe their stated scope and overlap; they must not be added into
one inflated acceptance total. Machine-readable evidence and private log hashes
are in [the redacted receipt](2026-10-21-native-retest-evidence.json).

| Test | Actual result | Evidence scope |
|---|---|---|
| CRM source suite | 979/979 PASS; 173 files | Source/embedded database tests; not hosted UAT |
| CRM build | PASS | Existing chunk-size/browser-data notices remain |
| Recovery Python | 128/128 PASS | Boundary, provenance, ordering and hash-drift checks |
| Billing source | 97/97 PASS | Source simulations; no provider acceptance |
| Billing baseline Python | 6/6 PASS | Catalog reconstruction tooling |
| Billing focused fail-closed/auth | 28/28 PASS | Overlaps broader source tests |
| Current Stripe source | 20/20 PASS | Signed synthetic webhook, simulated DB/provider transport |
| Exact deployed Stripe v73 | 15 PASS / 5 FAIL | Unchanged assertions; private deployed source; no deployment/API transaction |
| Native foundations | 32/32 PASS | 13 genuine GoTrue users, two tenants, generic probe RLS, signed/expired/invalid/anonymous cases |
| Native billing-role matrix | 26/26 PASS | Actual application role assignments and signed PostgREST; both tenants |
| Public signup / Auth hook | PASS | Actual GoTrue signup creates one application profile |
| Realtime transport | PASS | Signed native public broadcast; not Realtime tenant authorization |
| CRM #193 native workers | 15/15 PASS | Actual DB/auth, enrollment/idempotency, concurrency, scheduling/retries/suppression, signed reply, audit and worker authorization; provider transport simulated |
| Native Stripe financial tests | 13/13 PASS | Actual RPCs, allocations, rollback, concurrent/replayed webhook deduplication and tenant boundaries; synthetic events only |
| Claim/payroll internal RPC ACLs | PASS | Four actual RPCs remain service-only with expected owner/security contract |
| Captured Storage policies | 8 PASS / 10 FAIL | Genuine cross-tenant replacements/deletions reproduced |
| Capability-only signature hardening | 8 PASS / 10 FAIL | Residual foreign-operator isolation flaw retained; not considered resolved |
| Tenant-metadata Storage candidate | 21/21 PASS | Genuine own-tenant writes plus foreign client/operator denials, including object persistence checks |
| Native Stedi/claim-line safety | PASS | Four unknown attempts, six pending events and claim preserved; routes/cron disabled; submitted-line deletion rejected |
| Payroll deployed-v119 orchestration | 13/13 PASS | Mocked DB and deny-default synthetic Mercury transport; authorization, reconciliation, duplicate prevention and retry evidence |
| Nightly claims source | 5/5 PASS | Mocked DB/transport, including retirement/fail-closed behavior |
| Native payroll arithmetic/reconciliation | 15 PASS / 1 reproduced original HTTP-contract FAIL; staged fix 2/2 PASS | Actual rates, inclusive date boundaries, exact decimal totals, signed staff isolation and idempotent failed-attempt reconciliation; no provider transaction ID generated |
| Owned native cleanup | PASS for completed clean runs | Containers and internal networks removed; image cache/private evidence retained |

The five deployed-v73 failures cover missing/mismatched currency, async-success
posting, async-failure audit, and retry after failed audit persistence. Current
source fixes passed; deployed v73 was not changed.

Failed attempts remain private: initial image expansion ran out of vfs disk;
bootstrap/proxy and Auth-fixture mismatches were diagnosed; an expired generated
test JWT was refreshed; original sequence-number capture lost int64 precision and
was recaptured as text. Earlier generic probe runs had one anonymous-denial
failure caused by default table grants; explicit probe ACLs corrected it and the
final 32/32 run passed. Preliminary payroll fixtures incorrectly combined separate
status codes and nested statement fields; they were corrected to the actual
exact-code/top-level contract, with the failed attempt retained. Assertions were not weakened to hide these failures.

Shared-schema source CI passed on `63553e1f`:
[workflow run](https://github.com/LPredmore/valorwell-crm/actions/runs/39639563458).
This is a source gate, not a GitHub-hosted private-schema acceptance run.

## Prerequisites created or recovered

The original named export was not found in the authorized workspace or connected
Drive search. Existing public reconstruction tools were reused to assemble a new
private candidate from 31 catalog categories. It contains all 17 inventoried
namespaces; the six application/import/backup namespaces restore 597 tables and
37 views, plus functions, types, triggers, policies, constraints, indexes and ACLs.
The genuine application Auth hook, 19 Storage policies and two application
publication members are restored.

The capture preserves 966 historical versions, names and source hashes, including
eight bodyless versions, without manufacturing their SQL. Two capture passes had
stable row fingerprints/ledger boundaries; they are not an atomic global snapshot.
Supplemental inventories contain 82 Auth, 74 Storage and 91 Realtime migrations.
All 478 database settings have fingerprints; only required allowlisted values
were exported. Seven extension versions and the PostgreSQL 17.6/aarch64 source
identity are recorded.

The current private candidate manifest SHA256 is
`74cc42947a6cd7320d991e78d43f80c80e49dcca2187ca9e690deba58de06521`.
The candidate, a genuine CLI-generated current-state migration, catalog security
review, supplemental metadata and 118 private artifact hashes are retained under
`/workspace/retest-private`. Raw definitions, runtime keys and test tokens stay
outside GitHub. The candidate has 46 server-redacted rows and is not approved.

Pinned genuine upstream service images, flattened-image preparation for vfs,
locked Resend test dependencies, generated local credentials, synthetic personas,
HTTP/SQL bridges and cleanup automation are now available. Test containers use
only an internal Docker network, cleared proxies, loopback publications, disabled
cron execution and closed-local SMTP; they cannot contact production integrations.

## Remaining acceptance gates and exact reasons

* **Complete production parity: FAIL / review blocked.** The expanded baseline
  reduces strict differences from 6,141 to 1,147. Application definitions/direct
  ACLs match the redacted candidate. Remaining differences include self-hosted
  Realtime control schemas and rolling partitions, Storage/runtime schema changes,
  extension ownership/location and extra pg_graphql, strict ACL/default-ACL
  provenance, managed authority/configuration and the unreplicated historical
  ledger. Every difference has a private review classification; none is approved
  or silently allowlisted. Native PostgreSQL is amd64; source is aarch64. Exact
  hosted service build IDs are not established by migration ledgers alone.
* **Independent schema-owner review: absent.** Review must cover all 46 redactions,
  remaining differences, managed runtime compatibility and asset attribution.
  Automated flags are not approvals: 927 SECURITY DEFINER functions have explicit
  search_path configuration; one constraint is unvalidated, no indexes are invalid,
  and 188 application/import/backup tables have source RLS disabled.
* **Genuine provider acceptance: BLOCKED.** No designated Claim.MD, Stripe or
  payroll sandbox bindings exist in the managed environment. Connected Stripe
  accounts expose live mode only and were excluded. No provider-returned
  acknowledgment or accepted claim was claimed, and no real charge/payment, email
  or payroll transfer was initiated. Native failed-attempt fixtures are not provider
  acceptance. Exact secure configuration is documented in the runner README.
* **Full hosted UAT and Realtime tenant acceptance: BLOCKED.** No approved complete-
  parity hosted application/runtime is established. Source/UI checks, native CRM
  workers and basic Realtime transport do not close this gate.
* **Payroll foreign-staff HTTP contract: reproduced and fixed only in development.**
  Original source denies the foreign staff lookup with HTTP 500/P0002. The private
  hash-bound candidate returns 403/42501, preserves own-staff arithmetic and changes
  neither ownership nor grants. Its complete function body remains private and
  requires independent forward-fix review.
* **Production Storage/Stripe rollout: excluded.** Captured Storage weaknesses and
  deployed-v73 failures remain in production. The candidate/source fixes need
  independent review and a separately authorized forward-only rollout.

Bandit 1.8.6 and manual boundary review ran; no high-severity finding was reported
in the changed tooling. Subprocess, dynamic SQL, bind-address and generated-fixture
flags were retained and assessed within the owned-local/synthetic scope. The
locked SDK npm audit reported zero vulnerabilities. The formal
[Codex Security diff workflow](skill://Plugin_1e648473be9c8191a91ac3947151af55/security-diff-scan/SKILL.md)
could not complete. Its instruction is: “Run the `security_diff_scan` preflight
from `../../references/config-preflight.md` before reviewing files or creating a
goal.” That reference/helper is inaccessible through the exposed skill resources;
no filesystem helper or security scan tool is available here. This report does not claim a completed formal scan.

## Minimum actions for the owner

1. Arrange independent review of the concrete private candidate and
   [owner packet](2026-10-21-native-baseline-owner-review.md), including a supported
   managed-platform version/compatibility specification and legacy asset attribution.
   There is no need to recreate or send the original baseline bundle.
2. Bind designated test environments through the approved secret manager/runtime:
   `CLAIMMD_API_KEY` (and legacy remittance `CLAIM.MD_API_KEY`), Stripe
   `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, payroll `FLY_PROXY_URL` and
   `FLY_INTERNAL_AUTH_TOKEN`, with documented test-account permissions/routing.
   Do not paste credentials into chat or commit them. Provider transactions need
   separate authorization for the exact operations, as excluded in this task.
3. With those prerequisites supplied, the remaining hosted acceptance can continue.
   External provider transactions and production rollout require the separate
   authorization excluded from this task. P6, deployments, migration-history changes
   and deletion of the existing diagnostic hosted branch remain outside this run.

## Reproduction answer

**Native development reproduction: yes, from a clean checkout with the sealed
private candidate and pinned public image/dependency prerequisites.** Multiple
fresh checkouts bootstrapped actual services and executed the recorded suites;
the all-six-schema run restored every stage without manual database repair.
Commands, image provenance, secure configuration and cleanup are in
[the runner README](../../scripts/migration-recovery/native/README.md).

**Complete production-equivalent acceptance from Git alone: no.** Raw schema
artifacts intentionally remain private; independent review, managed-runtime parity,
hosted UAT and genuine sandbox evidence remain open. The runner exits **2**, not
success, while full acceptance/release is unproven, even when development suites
pass. Missing or changed artifacts fail closed before provisioning/database use.
