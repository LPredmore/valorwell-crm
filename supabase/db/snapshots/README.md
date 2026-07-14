# Supabase DB Snapshots

This directory records **live-applied** database state that was deployed
directly to the shared Supabase project `ahqauomkgflopxgnlndd` outside the
`supabase/migrations/` history.

## 2026-07-14 — CRM backend hardening (contract `valorwell-crm-contracts@1.0.1+20260714`)

- `valorwell_crm_backend_hardening_20260714.sql` — consolidated final-state SQL
  representing what is **already live**. It is idempotent (`CREATE OR REPLACE`,
  `IF NOT EXISTS`, guarded `DO` blocks), but it is intentionally NOT placed
  under `supabase/migrations/` so the Supabase migration runner does not re-run
  it against production. Use it as the authoritative source-controlled record
  or when standing up a staging/DR clone.
- `valorwell_crm_backend_verification_20260714.sql` — rollback-only catalog
  and behavior verification. Not a migration.
- `README_CRM_BACKEND_HARDENING.md` — full delivery README from the backend
  hardening package (July 14, 2026).
- `SHA256SUMS.txt` — integrity hashes for the packaged files.

The CRM frontend has adopted this contract as of the accompanying commit;
`CONTRACT_VERSION` in `src/lib/crm/contracts/v1/index.ts` is pinned to
`valorwell-crm-contracts@1.0.1+20260714`.

## Do not

- Do not move these files into `supabase/migrations/`. Doing so would attempt
  to re-execute already-live SQL against production.
- Do not modify these snapshot files in place. If the live DB is changed
  again, capture a fresh snapshot in a new dated file.
