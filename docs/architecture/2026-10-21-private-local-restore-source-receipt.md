# Private local restore — source execution receipt

## Implemented

- Windows PowerShell entry point delegates to WSL2; Python defaults to private source checks and requires explicit `--execute` for restore.
- Exact operator-reported original export SHA256/5442397 bytes, schema counts, 408 enabled RLS tables and 924 SECURITY DEFINER definitions are bound without possessing or reproducing the export.
- Separate baseline-time and latest ledger metadata, latest 966-row boundary, exact reviewed post-export delta, receipt/catalog/query hashes and all human-review scopes are mandatory. Baseline-time version count is not inferred. No historical ledger entries are manufactured.
- Known 20261020214527 checked-in source is 4771 bytes, SHA256 `a87ad8a61a2e78674df7b757e499d24097b34f6181c167325d4b0df47d9af01f`; not applied here.
- Genuine Supabase foundations and exact seven extension versions required; private reviewed dependency reconciliation runs before original application baseline, then counts/catalog parity, then incremental SQL. No dummy dependencies.
- Owned internal network/loopback ports, disabled Docker logging, PostgreSQL statement persistence controls, excluded workers/SMTP, disabled cron, ambient credential filtering, hash rechecks, metadata-only failures and fail-closed owned cleanup.
- Explicit successful-stack retention supports independent signed-JWT suites on the same complete isolated stack. SQL-only success never becomes production authorization.

## Touched source

`scripts/migration-recovery/`: `private_restore.py`, `private-local-restore.py`,
`private-local-restore.ps1`, `isolated-replay.py`, `recovery.py`, `export-counts.sql`,
`test_private_restore.py`, `PRIVATE-LOCAL-RESTORE.md`, `README.md`.
Also `.github/workflows/schema-recovery-source-gates.yml`, `AGENTS.md`, `roadmap.md`
and this receipt. No application UI, production migration, worker source or provider operations changed.

## Verification actually run

| Check | Result |
| --- | --- |
| Recovery source suite | **50 tests PASS** (18 existing + 32 private-wrapper tests) |
| Synthetic private bundle flow | PASS; original private export NOT accessed |
| Network/logging refusal + partial-start cleanup rules | PASS with synthetic Docker metadata/mock commands; actual Docker NOT run |
| CLI help entry points | PASS |
| Capture and preserved Docker smoke shell syntax | PASS |
| CRM-only source inventory | PASS; no full-history acceptance implied |
| Real repository Billing Hub boundary gate | PASS |
| Existing #199 boundary fixture test | Cannot run here: its temporary-repository `git add` is blocked by sandbox policy; file left unchanged |
| Source whitespace | `git diff --check` PASS |
| Preview signal | Latest available entry `build OK` |
| Actual restore / Windows PowerShell / signed-JWT suites | **NOT RUN**; Docker/Supabase/PowerShell commands unavailable locally and private inputs deliberately operator-only |

## Commit / PR evidence

Preserved local Git commits #198 `b7999dbfff02346543ec63f524dc705b50f50b29` and
#199 `7d195b69cbdf5e116dcfaa96359f57ea2f1e93f3`. No diff to #198 Docker smoke source/workflow.
Lovable generated source checkpoint `5540494` was observed after implementation;
it is not proof of a GitHub PR, remote merge or green hosted CI. New PR/remote CI
proof is unavailable here. No manual commit/push/auto-merge was performed.

## Operator next step / remaining blockers

Use the exact WSL2 or PowerShell commands in
`scripts/migration-recovery/PRIVATE-LOCAL-RESTORE.md` after privately preparing the
reviewed bundle, genuine managed reconciliation and exact local stack. Keep the
raw original SQL exclusively in the operator's possession. Missing authoritative
export-time ledger/catalog evidence must be resolved privately, not inferred from
counts or today's ledger. Independent CRM #193 and Billing #40 signed-JWT
own/foreign/missing-tenant acceptance on the complete retained stack is mandatory
before any separately authorized production release. No paid compute, production
write, external provider operation or live replay occurred.