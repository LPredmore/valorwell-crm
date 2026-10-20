# Clean Supabase replay recovery: baseline decision and release gates

**Prepared 2026-10-20. SOURCE PLAN / READ-ONLY CHECKS ONLY.** This does NOT change the production database, the `supabase_migrations` ledger, Supabase Auth settings, active Edge Functions, or published provider workflows. No new paid preview branch was created for this preparation.

## What an actual preview branch revealed

On 2026-10-20, an owner-approved ephemeral Supabase branch was created from Billing Hub (`ahqauomkgflopxgnlndd`) and failed during historical replay. The preview's Postgres logs identified **the first ledger version**, `20251201181524`, invoking `public.set_updated_at()` in a `user_roles` UPDATE trigger before a function definition exists. The function **exists now** on production as a PostgreSQL-owned, PL/pgSQL **SECURITY INVOKER** trigger function that sets `NEW.updated_at = now()`, but its creation is not in that first historical statement. The preview was deleted; no hourly test resources remain.

Further read-only ledger analysis showed that **the next migration, `20251201195701`, also relies on objects absent from the first migration**:

| Referenced in the second migration | Definition in replay history |
| --- | --- |
| `public.tenants` | No earlier `CREATE TABLE` statement found in the ledger |
| `public.profiles` | No earlier `CREATE TABLE` statement found in the ledger |
| `public.staff` | No earlier `CREATE TABLE` statement found in the ledger |
| `public.staff_roles` | Created in **third** migration `20251201200225` |
| `public.staff_role_assignments` | Created in **third** migration `20251201200225` |
| `public.tenant_memberships` | Created in **third** migration `20251201200225` |

The ledger contains **962 versions**, **152 without a name**, and **8 without stored SQL statements** (seven `20260813*` and one `20261015015000`). These are catalog facts, **not** proof all 962 versions are independently replayable, nor proof that versions without stored statements lack SQL in a repository.

The current four application repos' `supabase/migrations` directories do not include a file for `20251201181524`. The live migration ledger is **not a complete source-controlled baseline**.

## Reusable executable evidence

Run `scripts/migration-recovery/20261020_readonly_replay_gate.sql` against the **production catalog in read-only mode**. It checks the specific first/second/third migration dependencies and missing statement bodies, without executing any migration, enumerating PHI, or modifying the ledger.

**Baseline on 2026-10-20:** 1 PASS (first version present) and 8 BLOCKED. It is deliberately a *gate*: a BLOCKED means native preview branching is not proven reproducible. A clean status in this static check also does **not** certify that every subsequent migration will replay.

## Why a one-line historical patch is insufficient

Inserting `set_updated_at` immediately before the trigger fixes **the first visible SQL error only**. It does not create `tenants`, `staff`, `profiles`, or the role-assignment/membership tables before the **second** script, nor reconstruct object ownership, extensions, functions, triggers, RLS, grants, views, or exact Auth schema expectations. A forward-dated additive migration cannot run before broken historical versions in the native branch replay order.

**Do not** apply a quick `CREATE FUNCTION` in production: the function already exists there. **Do not** edit, delete, retroactively mark, or insert history rows into `supabase_migrations.schema_migrations` without a separate migration-history review. Do not `CREATE TABLE` production placeholders, ignore failed migrations, copy patient records to testing, or declare an incomplete branch safe.

## Recommended repair: verified current-schema baseline

Because early migrations already assume an unrecorded initial schema, first pursue a source-controlled **current schema-only baseline** and an explicit, supported migration-history reconciliation strategy. Two viable approaches require investigation:

**A. Reconstruct the true pre-December 2025 bootstrap (only if trustworthy historical sources exist).** Recover the actual original schema from dated SQL/backup artifacts, including Supabase roles, extensions, auth-related dependencies, tenants, staff, profiles, role tables, grants and triggers. Build an ordered initial bootstrap earlier than `20251201181524` and replay subsequent 962 historical versions. Do not invent placeholder tables or insert real tenant/client/staff data from production. Expect additional breakages, including eight statement-less ledger entries requiring source recovery.

**B. Create a complete, reviewed current-state schema-only baseline (likely more practical).** Generate a **schema-only** snapshot with a current compatible Supabase CLI/`pg_dump` against the authorized parent schema and explicitly compare:
- schemas, extensions, table/column/constraint and index definitions;
- function signature, ownership, SECURITY DEFINER/INVOKER, search_path and trigger dependencies;
- views with security_invoker and policies/grants for anon/authenticated/service_role;
- public, private, auth and other exposed schemas, storage policies and actual role model;
- actual applied migration ledger versions and missing SQL bodies;
- retained immutable claim, payroll, donor, identity and audit schemas **without any production row data**.

This is a **new baseline cutover decision**, not an instruction to automatically replay all 962 legacy SQL scripts *after* a current schema snapshot (doing so would duplicate or corrupt objects). Establish a documented version boundary and a verified mapping between the baseline and the previously applied historical migrations, then test the chosen strategy in isolated PostgreSQL with authentic Supabase roles/extensions. Follow [Supabase guidance on branches missing schema](https://supabase.com/docs/guides/troubleshooting/new-branch-doesnt-copy-database) and [MIGRATIONS_FAILED](https://supabase.com/docs/guides/troubleshooting/branch-in-migrations-failed-status). Official guidance mentions `supabase db pull --linked`, `supabase migration fetch` and `supabase migration repair`; **the exact commands and any remote migration-history updates require independent approval and a dry-run plan**. A `migration repair --status applied` entry is not an actual SQL execution and is not a substitute for correctness checks.

The current Supabase connector does not provide a schema-only dump or remote CLI. Preparing and committing a baseline from it cannot be represented as complete until an authorized operator executes the supported export and catalog comparison.

A prepared operator-only helper now exists at `scripts/migration-recovery/capture-application-schema-only.sh`. Run it in a trusted environment with `PGHOST`, `PGDATABASE`, `PGUSER` and a private password source: it invokes `pg_dump --schema-only` for public/private/credentialing, saves a private mode-0600 file outside the repository, and prints its SHA-256 without showing credentials or selecting table rows. It captures **only application schemas**, not all Supabase-built-in objects/roles, and function source could still embed secrets. Never upload its unreviewed output or treat it as a finished replayable baseline.

## Next verifiable milestones

1. Export and verify the original first three ledger migration bodies and the **8 bodyless entries**, reconciling them with all four repos. Preserve source hashes; do not quietly rewrite original versions.
2. Choose A or B based on actual pre-December source availability; for B, stage a non-PHI schema-only baseline in a **review-only PR**, with object-by-object diff and explicit exclusions. This stage is deliberately not a `supabase/migrations` file eligible for automatic production rollout.
3. Run clean replay against local/disposable PostgreSQL with the correct Supabase extensions, role ownership, Auth objects and `pg_cron`; capture each error and fix the baseline, not clinical data. Confirm 361 public tables' RLS contract and all `security_invoker` public views. Never rely on a static text scan alone.
4. After **a successful full clean replay**, request separate approval for any changes to Supabase's official branch/replay configuration or production migration history. Prepare rollback and pre/post structural evidence.
5. Only then create a separately cost-approved disposable branch and apply the **10** pending October security/claim migrations in their reviewed order, plus the independent draft Stedi routing retirement migration if accepted. Use the checked-in 14-RPC read-only ACL gate, signed GoTrue/PostgREST two-tenant tests, provider worker regressions, clean-grant behavior and rollback. Never test by sending live claims, payments or emails.
6. Keep the Todoist `02 CRM` security release tasks **OPEN** until post-approval production verification.

**Current scope:** Recovery planning, verified live read-only SQL and source CI only; no changes to historical production objects or artifacts containing clinical rows.
