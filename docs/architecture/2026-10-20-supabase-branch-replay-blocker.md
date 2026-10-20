# Supabase preview-branch migration replay blocker — October 20, 2026

**Release gate: BLOCKED before new security migrations.** This is evidence from an actual temporary branch creation, not a hypothetical risk. No production DDL or clinical/provider records were changed.

## Controlled temporary-branch experiment

- Parent production Supabase project: Billing Hub `ahqauomkgflopxgnlndd`.
- User-approved ephemeral branch: `crm-security-20261019-validation`, branch ID `a54f12e9-a442-4f9e-8d5c-6da0bf7ae1f4`, project ref `cqgxnzleojqbyornhici`.
- Supabase quoted recurring branch compute charge: **$0.01344/hour**. User approved this amount before creation.
- Branch created **2026-10-20 01:37:40 UTC** with `with_data=false`. Supabase status progressed to `MIGRATIONS_FAILED` even though the Postgres instance was healthy. No application tables were present, and the branch migration ledger was empty. **None of the ten pending October SQL hardening/correction migrations were applied or tested on the branch.**
- Exact preview Postgres logs at **2026-10-20 01:38:00 UTC** show the earliest replayed schema migration creating `public.app_role`, `public.user_roles`, RLS policies and `public.has_role`, then executing:
  ```sql
  CREATE TRIGGER update_user_roles_updated_at
    BEFORE UPDATE ON public.user_roles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  ```
  This fails with **`function public.set_updated_at() does not exist`**.
- Production ledger confirms the failing migration is the **first** one: `supabase_migrations.schema_migrations.version='20251201181524'`, with its one SQL statement stored in `statements[1]`. The script omits the required function creation. The production instance today does have `public.set_updated_at()`, a PL/pgSQL SECURITY INVOKER trigger returning `NEW` after setting `NEW.updated_at=now()`, owned by `postgres`. This explains why the current live database works while clean replay does not.
- The temporary branch was **deleted** via Supabase and the subsequent branch listing showed only the `main` project. Recurring preview compute resources were not left running.

## What this proves, and does not prove

**Proved:** The existing December 2025 historical migration history cannot successfully reconstruct this project's schema on a fresh Supabase preview branch. The first failure is a function/trigger ordering dependency. The source GitHub CI checks, 361/361 RLS structural findings, and a passing preflight against today's production catalog do not substitute for successful clean replay.

**Not proved:** That the first migration is the only issue among the 962 live history entries; that the ten new hardening migrations fail; or that billing/provider workflows are correct. A branch in `MIGRATIONS_FAILED` with no application tables is **not a usable full-schema acceptance environment**. Retrying branch creation with unchanged migration history will likely reproduce the same early failure and incur compute cost.

## Safe remediation sequence — source and controlled release only

1. **Reconcile the historical migration source and live ledger.** Recover original migration `20251201181524` and compare its exact SQL in `supabase_migrations.schema_migrations.statements` with all checked-in repository migration sources. Inspect any earlier bootstrap/baseline files, timestamp ordering, ownership, and default privilege choices. Capture and preserve the original historical SQL; do not rewrite existing production records or hide a version mismatch.
2. **Prepare a reviewed replay-only bootstrap fix or an accurate production schema baseline**, placing a correctly defined `public.set_updated_at()` trigger function before `update_user_roles_updated_at`. Determine the supported Supabase branching/migration synchronization mechanism; a new forward-dated migration alone cannot satisfy an **earlier** trigger dependency during clean replay. Do not assume that adding a new GitHub file automatically changes Supabase's actual migration ledger.
3. **Verify the repair outside production** by running a full replay in a disposable Postgres/Supabase environment with the actual role, extension, `auth` schema, `pg_cron`, RLS and function dependencies. Stop and capture each new failure; do not silently skip or mark the other 961 versions as passed. Use explicit baseline/reconciliation if numerous historical direct-editor changes make replay impractical.
4. **Review any production migration-history mutation separately.** Preserve all historical claim, payroll, donor, event and audit records. Applying/reordering older versions, changing live ledger statements, or touching the `supabase_migrations` schema is **not authorized by branch-test approval**.
5. **Only after source history is reproducible**, create a new cost-approved ephemeral branch, confirm application schema and role coverage, then validate ten pending October 19 security/claim SQL files **plus** the separate draft Stedi retirement SQL (if approved for the staged test). Run the checked-in RPC ACL gate, signed own/foreign tenant positive/negative cases, worker SDK/PostgREST acceptance, clean GRANT compatibility, and postdeploy Stedi read-only assertions. Keep production deployment, payment, claims, live email and media publishing out of these tests.

### Reference

Supabase troubleshooting: [Branch in MIGRATIONS_FAILED status](https://supabase.com/docs/guides/troubleshooting/branch-in-migrations-failed-status).

**Status:** Historical replay blocker requires a dedicated source/baseline repair work item; all previous October security hardening tasks remain OPEN.
