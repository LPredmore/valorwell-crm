# Shared Supabase baseline recovery

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
- [ ] Exercise ten staged SQL files and separate Stedi draft on verified full-schema Supabase (blocked until complete reviewed baseline and real local stack available).
- [x] Document ordered release and independent signed-worker acceptance path; executable production rollback awaits private originals/full-schema tests.
- [x] Report evidence and blockers; existing Todoist task remains OPEN (no available connection; not updated or duplicated).
- [ ] Production rollout/history changes and paid branch remain blocked by separate explicit approval.