# Shared Supabase recovery execution receipt

Verified October 20, 2026, 03:39 UTC. **Recovery and production release remain BLOCKED.** Source work and regression results below are real; no full-schema replay, signed-JWT acceptance, production migration, worker deployment, branch creation or provider operation occurred.

## Ordered executable checklist and outcomes

1. **Inspect five apps and authoritative sources — performed.** CRM main is `68412f50a16a8dd4471973d53342e521dd80e7f7`; PRs #196/#197/#192 are merged. PR #193 remains open at `566b912f4b29d497703cae0737bd29a9f744afe5`. Preparation, reconciliation and ACL source files match CRM main. Existing linked source has not been overwritten with an external branch.
2. **Inventory immutable SQL bytes — performed.** Checked-in evidence contains all five snapshot inventories, candidate hashes, ledger metadata, and ordered ten-file release. No business rows or function bodies are in these evidence files.
3. **Recover/bootstrap baseline — blocked.** None of the inspected migration folders supplies the earliest core bootstrap. No authorized connection capable of private schema capture is present. The capture/review/parity tools are implemented, but there is **no reviewed canonical baseline artifact**.
4. **Deterministic isolated execution — tooling implemented, full execution blocked.** Supabase CLI 2.58.5 initializes locally; actual `supabase start` fails because Docker daemon is unavailable. No substitute embedded database is represented as Supabase. New runner has not executed against a complete schema.
5. **Ten-file and separate Stedi acceptance — NOT RUN.** Source/hash/order checks pass; all ten SQL outcomes are explicitly `NOT_RUN_FULL_SCHEMA`. PR #34 Stedi draft and PR #40 acceptance source are inaccessible through available private-repository access. These remain independent gates.
6. **Release/rollback preparation — documented below, not authorization.** Actual production and history cutover are separate approvals.

## Source and live evidence

| App | Inspected snapshot/head | Main migration files | Relevant dependency |
| --- | --- | ---: | --- |
| CRM | `68412f50a16a8dd4471973d53342e521dd80e7f7` | 339 | Campaign enrollment/idempotency, donor overview, automation emitter, social workers; membership must use `profile_id` |
| Clients | `c40335303c6fa5eb24dde302b6e79370771c7d6f` | 245 | Stripe posting source; qualifying sessions, relationships and Auth/core tables |
| Staff | `9bf4717bd7ae21b45c81d58cec053de3909f29a2` | 223 | Membership/provisioning, clinical completion triggers and core helpers |
| Billing | `ff33c920265b6bed6e4fe636e4440f67449f7c3a` | 49 | Claim finalization, payroll, Stripe webhook, public billing role checker |
| Onboarding | `15910787ddf48c36fba37f930b14df849a4a1c5f` | 1 | RLS uses `tenant_memberships.tenant_role` |

Billing/Clients/Staff are read-only Lovable snapshots; their current private GitHub main/draft heads could not be independently fetched (404). Snapshot inspection is not a claim that private PR #34/#40 was reviewed. Changes to those projects cannot be pushed from this chat.

**Source inventory:** 857 SQL files, 725 recognized unique versions, 127 identical duplicate version groups, zero same-version/different-content collisions. Five files use unresolved eight-digit timestamps (two duplicated Clients/Staff pairs plus Billing's BTY render routing). They are retained with byte hashes, not renamed or assigned invented versions. Applied migration files remain unchanged.

**Live ledger:** 962 rows; latest `20261019232604`; 152 unnamed; eight bodyless. Of those rows, 627 versions have no recognized source candidate, 204 have candidates but nonmatching concatenated-ledger/body MD5, 123 match that MD5 comparison, and eight have recovered candidates but no applied-body proof. Nonmatching MD5 is not proof of schema drift: SQL statement splitting, serialization and absent sources require review. MD5 is only an equality aid, not cryptographic provenance. Raw source SHA256/Git blob hashes are separately recorded.

**Dependency graph (known edges only, not a complete 962-version graph):**

```text
missing pre-Dec bootstrap: tenants, staff, profiles, set_updated_at
  -> 20251201181524 user_roles trigger needs set_updated_at
  -> 20251201195701 seed references six unavailable core tables
       -> staff_roles/staff_role_assignments/tenant_memberships only created in third version
20261019000310 campaign authorization
  -> 20261019165842 exact profile_id correction (must immediately follow)
  -> subsequent campaign internal/helper ACL changes
reviewed current-state baseline + exact 962-version cutover mapping
  -> ten ordered security files
  -> SQL/catalog gate
  -> independent CRM #193 and Billing #40 signed acceptance
  -> approved production release (NOT authorized)
```

**Live catalog reconfirmed:** PostgreSQL 17.6; public 361 base tables, all RLS enabled; 33 public views, **32 security-invoker** after normalizing `on`/`true` representations; eight anonymous-selectable public views. The earlier 26 count was a query representation error, not six unsafe views. Private 51 base tables and credentialing 13 base tables. Structural RLS does not prove tenant isolation.

**Live ACL gate:** 2/14 PASS, 12 FAIL_AUTH; passing functions are Stripe posting and the intentionally authenticated claim-status wrapper. Do not blindly revoke `has_billing_role`: its dependent functions/policies still require full behavioral coverage.

## Actual source fixes

- Removed the fictitious `tenant_memberships.user_id` fixture column from campaign lifecycle acceptance. The harness now requires the unchanged hash-verified PR #193 `profile_id` correction immediately after 00310. The existing applied 00310 migration was not edited.
- Added collision-aware source reconciliation, conservative private SQL scanning, evidence hash binding, explicit historical cutover/version coverage, complete parity-shape checks, and exact fourteen-signature ACL output checking.
- Extended private operator capture with application/catalog/ledger metadata and managed Auth/Storage review-only export. TLS applies to capture commands. Managed schema exports are never automatically replayed.
- Added isolated genuine-Supabase runner with reviewed image/CLI/extension checks, owned internal-network/no-external-port checks, scheduler disabling before application SQL, ordered hash-verified release execution and fail-closed cleanup. **This is unexecuted tooling, not acceptance evidence.**
- Added GitHub Actions source gates and inventory artifact; this is not a full-schema CI job and has not run on GitHub here.
- Corrected an existing CRM task repository type to the columns its query actually selects; current generated table types include an unselected field. No task behavior/schema change.

Private scans are advisory, deliberately conservative and can reject legitimate DDL-function text. They cannot prove absence of hidden credentials or dynamic data writes. Human review of every executed SQL artifact remains mandatory. Catalog fingerprints now include domain definitions/constraints, sequence parameters and collations, but exact managed-role/extension parity remains unverified until real capture and restore.

## Verification actually run

| Check | Outcome | Limit |
| --- | --- | --- |
| Full existing CRM Vitest suite | **967/967 PASS**, 172 files | Existing embedded/synthetic tests do not equal signed Supabase acceptance |
| New Python recovery rules | **18/18 PASS** | Source-only negative/ordering/hash tests |
| Capture shell syntax | PASS | Capture itself refuses absent PG credentials; no dump performed |
| CRM-only CI inventory command | PASS | No cross-repo/full-history acceptance implied |
| Five-app inventory | Expected BLOCKED | Missing bootstrap, unresolved filenames/history remain |
| Campaign migration sequence-only check | PASS | No DB connection or migrations executed |
| Campaign missing correction gate | Expected refusal | Cannot silently fabricate membership column |
| Public table GRANT source fixtures | 9 PASS | Not live grants/RLS acceptance |
| Clinical recovery provenance | 6 invariants PASS | Existing source gate |
| Preview diagnostic | Latest `build OK` | No manual build/typecheck was run |
| Local Supabase start | BLOCKED, no Docker daemon | No full baseline/replay/SQL acceptance |

## Baseline cutover contract and isolated procedure

See `scripts/migration-recovery/README.md`. A current-state snapshot must supersede exactly the captured historical version set at a documented boundary, rather than replaying all 962 scripts after the snapshot. Historical production SQL bodies/ledger entries remain immutable pending separately approved reconciliation. The local runner does not mark fabricated ledger entries as applied.

The reviewed manifest binds baseline bytes, canonical ledger/catalog hashes, verification-query hashes, ordered SQL hashes, CLI/database image, extension versions and human review flags. A manifest boolean is not independent approval evidence; attach reviewer identity and review receipt outside raw-secret capture. An empty parity object and duplicate ACL PASS rows are explicitly rejected.

## Exact release and rollback gates

**Preflight:** fresh ledger/ACL/catalog read; verified private schema snapshot and existing backups; controlled restore; exact managed roles/ownership/default grants; successful baseline parity; independently passing CRM #193 and Billing #40 signed own/foreign/missing-tenant and worker suites; read-only Stedi preflight. Validate immutability of claims/lines/events and payroll, campaign duplicate/retry/cancel paths, social queue roles, donor fail-closed, Stripe signature/amount/allocation and role-checker dependencies across all five apps. Never generate provider accepted results.

**Order:** separate optional Stedi `20261018235900` only if independently reviewed for isolated inclusion; then 00200 → 00300 → 00310 → **165842** → 00400 → 00410 → 00500 → 00600 → 00800 → Billing 085103. Full filenames/SHA256 appear in the ordered manifest. **Do not reapply Stripe 00100**, already live under `20261019232604`. Source/version reconciliation is its own reviewed decision.

**Production deployment:** no approval conveyed. First approve the exact SQL artifacts/order and worker source deployments; separately approve any live-history/branch-cutover mutation. CRM PR #192 source tenant fix is merged but reported live v146 is old; deployed source/worker version was not revalidated or deployed here. Do not activate workers before signed positive/negative cases pass. No emails, payments, claims, payroll writes or media publication are authorized.

**Rollback:** local rollback destroys only the owned isolated stack and retains private diagnostics; cleanup failure is BLOCKED/nonzero. Before production, capture exact prior function bodies/grants/search paths and prepare reviewed compensating forward SQL per changed object (not wholesale reapplication of historic migrations). Do not restore insecure public grants blindly, revert ledger history, or destroy business/audit data. No executable production rollback artifact is claimed: private original bodies and full acceptance are still missing. A restore from backup requires a separate operational approval.

## Tracking, sync and remaining blockers

- Existing Todoist task `6hpQ7fqCwVRmqRPM`, parent `6hhmhxFPmjgCQJJq`, remains the authoritative OPEN blocker. Connector discovery found no Todoist connection, so it was not updated and no duplicate was created.
- Lovable manages repository sync; this agent cannot operate synced branches, manually commit/push or verify a new GitHub commit/PR SHA. Source changes are available in this project; no new PR, commit SHA, merge or remote CI success is claimed.
- Required next inputs: trusted private schema-only capture and human review; genuine Docker/Supabase runtime; private Billing #34/#40 source and CRM draft acceptance access; full-schema signed-role tests; separate exact production approval. New paid compute is not needed for the prepared local route and has not been requested or created.

**DONE criteria are not met.** No baseline/parity artifact, replay log, ten-file full-schema result, signed acceptance or approved production release exists yet.