# Shared schema recovery tools

These are source/isolated-only tools, not permission to change production or repair its migration ledger. Evidence and execution status: `docs/architecture/2026-10-20-baseline-recovery-execution-receipt.md`.

## Inventory and source checks

```bash
python3 -m unittest discover -s scripts/migration-recovery -p 'test_*.py' -v
bash -n scripts/migration-recovery/capture-application-schema-only.sh
python3 scripts/migration-recovery/recovery.py inventory \
  --repo crm=. --repo clients=/trusted/clients --repo staff=/trusted/staff \
  --repo billing=/trusted/billing --repo onboarding=/trusted/onboarding \
  --ledger /private/ledger-metadata.json --output /private/source-inventory.json
```

Inventory exits 2 on collisions, unresolved filenames or unresolved ledger/bootstrap evidence. Do not rename applied migrations to silence it. A CRM-only source check can pass without ledger input; it never asserts clean replay.

`release` requires the ten unchanged files including `crm-draft193`; `--with-stedi` additionally requires `billing-draft34`. Membership correction bytes must match `89404791b3d91e1d9585c82e4b2ef4bd329f92c67b9da9102322bbc46dab08da` and immediately follow 00310 regardless of timestamp sorting.

## Private operator capture

Run `capture-application-schema-only.sh` only in an authorized trusted operator environment, not sandbox exec access. Supply credentials outside source/commands. No production table rows, vault secrets or role passwords are exported. Function bodies and comments can still contain secrets: keep every result private until human review. Managed Auth/Storage dump is review-only, never replay input. Do not upload raw capture to this repository.

The application dump is **partial**, not a canonical Supabase baseline. Extract only reviewed app-owned managed trigger/policy dependencies, reconcile ownership/extensions/roles/default ACLs and source-supported omissions. Preserve capture provenance and full original history metadata. This task has not produced that complete artifact.

## Required reviewed cutover manifest

The isolated runner deliberately has no permissive sample manifest. Supply genuine reviewed evidence:

- `strategy`: `current-schema-cutover`; `schema_sha256`: complete approved baseline bytes.
- `superseded_versions`: exactly sorted captured ledger versions; `cutover_version`: its maximum. Never copy a snapshot then replay those historic scripts.
- `ledger_sha256`, `source_catalog_sha256`: SHA256 of canonical JSON (`json.dumps(value, sort_keys=True, separators=(',', ':'))` encoded UTF-8). Use `recovery.evidence_digest`; hashes bind supplied evidence but cannot authenticate its origin.
- `human_secret_reviewed`, `managed_dependencies_reviewed`, `owners_and_grants_reviewed`, `storage_auth_integration_reviewed`: true only after recorded human review.
- `catalog_query_sha256` and `acl_query_sha256`: exact tool/14-RPC query bytes reviewed.
- `reviewed_release_sources`: ordered objects containing only `version` and `sha256`, generated from the real sources; optional Stedi first, membership immediately after 00310.
- `supabase_cli_version`, `supabase_database_image`, `required_extensions`: reviewed exact stack/image and extension versions. Production currently PostgreSQL 17.6; never use dummy Auth/Storage/role functions to manufacture parity.
- Attach capture origin, reviewer and approved cutover semantics separately; automatic booleans are not authorization.

`--reviewed-parity-diff` must contain exactly `missing`, `extra`, `changed` arrays, all empty. Full actual parity is recalculated after baseline restore; the preliminary diff cannot bypass it.

## Isolated runner

```bash
python3 scripts/migration-recovery/isolated-replay.py \
  --baseline /private/reviewed-baseline.sql \
  --cutover-manifest /private/reviewed-cutover.json \
  --ledger /private/ledger-metadata.json \
  --source-catalog /private/catalog.json \
  --reviewed-parity-diff /private/parity.json \
  --repo crm=. --repo billing=/trusted/billing --repo crm-draft193=/trusted/crm-draft193 \
  --output-dir /private/new-isolated-results
```

Requires a functioning Docker daemon, pinned genuine local Supabase CLI/image, complete reviewed baseline and full sources. The CLI creates a unique owned project/internal network; verifies all owned containers have only that network and loopback-only published ports; excludes Edge runtime and disables cron before SQL. Unsupported local port binding fails closed before loading application SQL. Do not relax the check to allow provider egress. Results and private failures must be outside project source.

Status `SQL_CATALOG_PASS_SIGNED_ACCEPTANCE_PENDING` means only SQL/catalog passed. The runner has not been executed with a full baseline here; no success is claimed. No job activates workers, reorders live history or calls Claim.MD/Stripe/YouTube/email.

Run independent CRM PR #193 SDK/PostgREST and Billing PR #40 twenty-case suites on that exact complete isolated stack with synthetic tenants and genuine signed sessions before release. Existing Python lifecycle fixture and embedded Postgres tests are narrower and must not replace them. Do not use production credentials or fabricate accepted provider results. Destroy only the owned stack; if cleanup fails, results retain its workdir/identifier and command returns nonzero for operator recovery.