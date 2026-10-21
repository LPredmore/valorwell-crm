# Shared Supabase baseline recovery

## Storage write ACL hardening — issue #201 (October 21, source-only)
- [x] Trace org-logos/training-covers/email-signatures call sites: only email-signatures is CRM-owned; the other two have no call sites or policies in this repo.
- [x] Stage forward-only email-signatures hardening (capability-gated writes, public read preserved, flat paths kept) plus 9 offline regressions and a 6-check operator catalog contract; all pass, build OK.
- [ ] org-logos/training-covers fix (blocked: owning app and path conventions are outside this repo; blind policy would break unknown uploaders).
- [ ] Apply staged SQL and run signed-user allow/deny reproduction (blocked: explicit production release approval per issue #201).

## Updated branch receipt and acceptance preparation (October 21, 03:41 UTC)
- [x] Preserve the earlier receipt; add versioned updated operator metadata, pinned available source/cutover checks and 33 new regressions.
- [x] Document native bootstrap recovery and synthetic signed-JWT/provider acceptance with mandatory server-side egress prerequisites; no live runner or execution.
- [x] Run local source checks: 113 recovery tests and 44 existing network-denied worker tests PASS; source gates pass, no Supabase calls.
- [ ] Open review PR and verify hosted CI (blocked: no repository write/PR integration exposed; no merge authorized).
- [ ] Execute independent actual-schema signed-JWT and Stedi synthetic history acceptance (blocked: private reviewed boundary/catalog/dependencies, external Billing suites, genuine isolated Docker stack and proven server-side egress denial).

## Branch recovery follow-up (October 21)
- [x] Record operator-reported branch reconstruction, parity, ACL checks and unresolved drift as sanitized evidence, not production acceptance.
- [x] Add offline receipt validation/regressions: 80 recovery tests pass (30 new); receipt CLI, shell syntax, CLI help, source inventory and real boundary gate pass; preserve #198/#199.
- [ ] Create reviewable source PR (blocked: no repository write/PR integration available here); no merge until hosted checks are green.
- [ ] Independent signed-JWT cross-tenant and real provider/worker acceptance remain blocked on operator-run suites; no production release authorized.

## Private local restore phase (October 21)
- [x] Implement Windows/WSL2 operator wrapper and hash-bound private cutover/catalog checks.
- [x] Run 50 source regression tests and preserve merged #198/#199 CI safeguards; boundary fixture test is sandbox-blocked, real gate passes.
- [ ] Run complete isolated restore and independent signed-JWT suites (blocked: operator-only SQL, reviewed dependency/boundary evidence, local Docker and private suites).
- [x] Observe integration-generated source checkpoint 5540494; remote PR/CI proof unavailable (no manual commit or auto-merge).

## Applicant source UI
- [ ] Add read-only source badges, counted filters and review details to existing applicant surfaces.
- [ ] Test parsing, complete applicant traversal and source filtering; verify available live evidence.
- [ ] Surface origin/review fields from authorized API (blocked: existing RPC omits them; SQL changes forbidden).
- [ ] Manual Cold/Indeed intake option (blocked: entry form is in separate Staff app).

- [x] Inspect five application consumers, available GitHub provenance, and read-only live contracts; private Billing drafts unavailable.
- [x] Generate collision-aware source/hash inventory and known dependency/release manifest; full history unresolved.
- [x] Implement private schema capture review/parity tooling and explicit baseline cutover gate.
- [x] Implement fail-closed isolated replay CLI and source CI; 967 CRM and 18 recovery tests pass.
- [ ] Produce reviewed canonical baseline/parity artifact (blocked: operator-only raw export, authoritative export-time ledger/catalog, complete managed reconciliation and human review; do not request raw SQL).
- [x] Record earlier operator-reported ten-file branch SQL application; later 03:41 receipt separately reports branch-only Stedi retirement, with independent workflow/history-fixture acceptance still pending.
- [x] Document ordered release and independent signed-worker acceptance path; executable production rollback awaits private originals/full-schema tests.
- [x] Report evidence and blockers; existing Todoist task remains OPEN (no available connection; not updated or duplicated).
- [ ] Production rollout/history changes remain blocked by separate explicit approval; existing operator-authorized paid branch is not managed here.