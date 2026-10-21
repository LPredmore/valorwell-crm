# Private Windows / WSL2 restore and test

This tool is source-only by default. **No full-schema restore has been run in Lovable.**
The operator owns the raw file; do not send it, its contents, failure SQL, keys, or
local stack credentials to Lovable, GitHub, transcripts or artifacts. Report only
reviewed hashes, counts and fixed pass/fail statuses. Do not use CI for this restore.

## Prerequisites

Use Windows with WSL2 Ubuntu and Docker Desktop WSL integration, or Linux.
Use Python 3.11+ and the reviewed pinned Supabase CLI (existing smoke uses 2.58.5).
Execution uses Linux paths and owner-only permissions; native Windows Python
restore is intentionally unsupported. PowerShell delegates to WSL without copying SQL.
Keep the repository and private directory in the WSL Linux filesystem, outside
OneDrive, Windows `/mnt/c`, network shares and source control. Use a dedicated
local Docker daemon/context, not a production or remote Docker host. Configure
that dedicated daemon with `"log-driver": "none"` before starting; the runner
refuses other logging drivers and remote contexts. Do not change a shared daemon
without considering other local containers. No private SQL is passed until
container networking/logging and genuine dependency checks succeed.

Pre-pull the reviewed genuine Supabase images using the smoke procedure in a
separate empty disposable project; never put private application migrations there.
This is only foundation preparation, not restore acceptance. Once the runner
creates its internal network, owned containers must have only that network and
loopback-only ports. The bridge default is loopback; if this CLI/image combination
still publishes `0.0.0.0`, execution refuses it. Do not remove this safeguard.
Edge runtime, SMTP test server and provider workers are excluded; cron is disabled.

The supplied export omits managed Auth/Storage/Vault, roles and extension DDL.
An expert must privately review real managed dependencies, app-owned managed
hooks, owners/default ACLs and grants. Provide a separately reviewed reconciliation
SQL file, **not fake auth/roles/storage functions**. Exact production extensions:
pg_cron 1.6.4, pg_net 0.19.5, pg_stat_statements 1.11, pgcrypto 1.3,
supabase_vault 0.3.1, uuid-ossp 1.1, plpgsql 1.0; server 17.6.
Unavailable exact foundations are a blocker, not permission to substitute versions.
Human review must also exclude dynamic provider calls, audit-log persistence,
embedded credentials and unsafe privileged code from executed reconciliation SQL.
Postgres logging/pg_stat_statements persistence is disabled and checked before
loading the application; Docker logging is disabled for every owned container.

## Private evidence bundle (operator prepares locally)

Create `~/valorwell-private/restore-20261020` with mode 700, files mode 600.
The original export must match **5442397 bytes** and SHA256
`4da55b28809507eaa9438a0cb27a7f4335a884ea92dea87551890c0e6ef8230f`.
A clean recognizable-pattern scan is advisory, not a complete secret review.
No ready-to-approve manifest is generated: all review assertions require real evidence.

Provide `reviewed-cutover.json` with the existing README's required fields plus:

| Field | Private evidence requirement |
| --- | --- |
| `baseline_file` | Relative original schema-only file, exact hash above |
| `baseline_ledger_file`, `ledger_sha256` | Exact ledger metadata **as of the export**, canonical JSON SHA256 |
| `superseded_versions`, `cutover_version` | Sorted exact export-time versions and their maximum |
| `latest_ledger_file`, `latest_ledger_sha256` | Independently captured latest metadata; reported 966 versions ending 20261020214527 |
| `source_catalog_file`, `source_catalog_sha256` | Complete fingerprint catalog **at export time**, not today's post-increment catalog |
| `parity_file`, `reviewed_parity_sha256` | Canonical hash of reviewed `{missing:[],extra:[],changed:[]}` evidence |
| `human_review_receipt_file`, `human_review_receipt_sha256` | Private JSON with named `reviewer`, dated `reviewed_at`, matching `schema_sha256`; hash is file bytes |
| `managed_dependencies_file`, `managed_dependencies_sha256` | Human-reviewed genuine foundation reconciliation SQL; hash is file bytes |
| `postgres_version` | `17.6` |
| `counts_query_sha256` | SHA256 of checked-in `export-counts.sql` |
| `reported_counts` | public: tables361/functions794/views33/policies550/triggers353; private: tables51/functions307/views4/policies1/triggers13; credentialing: tables13/functions21/triggers2 (credentialing views/policies not asserted) |
| `rls_enabled_tables`, `security_definer_count` | 408 and 924 |
| `incremental_sources` | Ordered list of `{version,file,sha256,bytes,human_reviewed:true}` covering **all and only latest minus export-time versions** |

Paths inside the bundle must be relative, not symlinks. Catalog JSON permits only
`kind`, `identity`, `fingerprint` rows, no definitions. Fingerprints use the existing
`catalog-fingerprints.sql`; extension/role/managed-hook differences must be reviewed
and resolved, never filtered out to manufacture parity. Counts are recalculated
immediately after baseline restore, **before** post-export increments. Exact object
parity is also recalculated; count equality alone cannot pass it.

Canonical evidence hash: `recovery.evidence_digest(json_value)`; raw SQL, receipt
and query hashes: SHA256 file bytes. Hashes bind inputs but do not authenticate
origin or confer production approval. All existing human review booleans remain
required. The restrictive scan can reject legitimate function DML; privately review
that blocker rather than disabling the scan.

The receipt must also explicitly set each of the four human-review flags to JSON
`true` and bind `ledger_sha256`, `latest_ledger_sha256`, `source_catalog_sha256`
and `managed_dependencies_sha256` to the manifest. String values such as `"false"`
cannot count as approval. No reviewer, approval or export-time boundary is supplied
by this tool.

**Boundary is not inferred.** Do not assume 965 versions at export because today's
ledger has 966. Obtain authoritative export-time metadata and the full delta. The
known incremental source is 20261020214527,
`staff_applicant_contact_and_provisional_license_20261020`, 4771 bytes, SHA256
`a87ad8a61a2e78674df7b757e499d24097b34f6181c167325d4b0df47d9af01f`.
Its checked-in CRM bytes were verified, not applied. Copy it locally into the
private bundle along with any other reviewed delta files. No old migration is
replayed after the baseline; no migration ledger rows are inserted. If the latest
ledger changes, stop and review a new pinned boundary rather than bypassing 966.

## Exact operator commands

WSL/Linux, with this repository cloned at `~/src/valorwell-crm`:

```bash
chmod 700 "$HOME/valorwell-private/restore-20261020"
# Set each input file to 600, including nested incremental SQL; do not publish them.
python3 "$HOME/src/valorwell-crm/scripts/migration-recovery/private-local-restore.py" \
  --private-root "$HOME/valorwell-private/restore-20261020"

# Explicit user-operated restore only; retain the exact stack for independent tests.
python3 "$HOME/src/valorwell-crm/scripts/migration-recovery/private-local-restore.py" \
  --private-root "$HOME/valorwell-private/restore-20261020" \
  --execute --keep-stack-for-signed-tests
```

Windows PowerShell (replace `operator` with the WSL account name):

```powershell
& .\scripts\migration-recovery\private-local-restore.ps1 `
  -Distribution Ubuntu -RepositoryRoot /home/operator/src/valorwell-crm `
  -PrivateRoot /home/operator/valorwell-private/restore-20261020

& .\scripts\migration-recovery\private-local-restore.ps1 `
  -Distribution Ubuntu -RepositoryRoot /home/operator/src/valorwell-crm `
  -PrivateRoot /home/operator/valorwell-private/restore-20261020 `
  -Execute -KeepStackForSignedTests
```

Results go only to the fresh private `isolated-results` directory; repeated runs
require a newly prepared private bundle/output directory. No raw failure SQL or
command stderr is saved or printed. Failures are metadata-only and conservative;
an expert may investigate locally without creating SQL logs/transcripts. Unless
explicit retention is requested, the stack is destroyed. Failures always attempt
owned cleanup; failed cleanup retains only ownership metadata for recovery.

Optional **isolated** security-release testing uses the Python entry point with
`--security-release --repo crm=/trusted/crm --repo billing=/trusted/billing
--repo crm-draft193=/trusted/crm-draft193`, and optionally
`--with-stedi --repo billing-draft34=/trusted/billing-draft34`.
Existing ten-file hashes/order/human review still apply; versions already covered
by the latest ledger are refused. This mode is not permission to change production.

## Mandatory independent acceptance / cleanup

`SQL_CATALOG_PASS_SIGNED_ACCEPTANCE_PENDING` is **not release approval**. Restore-only
does not run the 14-RPC release gate. Retained private results identify the exact
owned stack and its identity hash. On that complete stack, run independent CRM
#193 and Billing #40 signed-JWT SDK/PostgREST suites using synthetic tenants and
genuine own/foreign/missing-tenant sessions, real `profile_id` membership, revoked
roles, duplicate/retry/cancellation and worker authorization checks. Keep local
credentials/results private and bind acceptance to the recorded stack identity,
source revisions, baseline hash and incremental/release hashes. No dummy auth,
production users, provider calls or fabricated accepted Claim.MD results.
These suites are operator-supplied; this wrapper cannot claim they ran. No worker
deployment or production release is authorized by a restored database.

Security boundary: run only on an operator-controlled machine with no other process
modifying the private bundle. SQL byte hashes are rechecked at execution, but this
is not a defense against a compromised local account. Genuine image/object/version
checks are prerequisites, not proof of all grants or privileged code safety;
full catalog parity and independent human review remain mandatory. Managed
reconciliation SQL is executable privileged code, not automatically proven safe
by a receipt. Source tests exercise synthetic network/logging/cleanup refusals,
not actual Docker startup, Windows PowerShell execution or full SQL restore.

After those suites, execute the exact owned `cleanup_commands` in private results
(Supabase stop with `--no-backup`, then remove only the recorded internal network).
Remove the recorded owned workdir after successful cleanup. Do not use global
Docker prune/stop-all, production history repair, paid preview branches or auto-merge.

## Source verification and proof

Source tests use synthetic fixtures only. Existing PR #198 smoke and #199 CI fixes
remain unchanged. Local Git includes #198 `b7999dbfff02346543ec63f524dc705b50f50b29`
and #199 `7d195b69cbdf5e116dcfaa96359f57ea2f1e93f3`; remote CI status is user-provided,
not independently queried here. Lovable manages new commit/PR sync; no new commit,
remote CI success or live replay should be claimed until that evidence is available.