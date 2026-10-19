# Explicit public-schema grants for new Supabase migrations

**Effective preparation target: October 30, 2026.** [Supabase guidance](https://supabase.com/docs/guides/api/securing-your-api) separates Postgres GRANT (may the role reach an object?) from RLS (which rows may that role access?). The shift in platform defaults means new public tables/functions may not automatically be reachable by `anon`, `authenticated`, or `service_role`. Conversely, current Billing Hub default privileges still auto-grant broad public access. Never rely on either default.

## Required object-level review
1. Every `CREATE TABLE public.*` must have `ENABLE ROW LEVEL SECURITY` and an explicit access decision in the **same migration**, even when the object is intended only for a trusted worker. The CI guard accepts either explicit `GRANT ... TO service_role`, or an `@no-data-api` comment documenting why Data API grants are intentionally omitted.
2. For any browser-exposed table, enumerate each allowed role and operation: `SELECT`, `INSERT`, `UPDATE`, `DELETE`. Write tenant/role-specific RLS policies with both `USING` and `WITH CHECK` on UPDATE. A `GRANT` to `authenticated` alone is **not tenant isolation**. Do **not** automatically grant `anon`.
3. For server-only tables in an exposed schema, explicitly `REVOKE` public/anon/authenticated as needed, and `GRANT` only the required operations to `service_role`. Prefer a dedicated unexposed private schema when feasible.
4. For each function in `public`, review `EXECUTE` for `PUBLIC`, `anon`, `authenticated`, and `service_role`; a SECURITY DEFINER RPC requires explicit authorization checks and an audited search_path. Beware implicit EXECUTE grants to PUBLIC.
5. Handle sequences, views and SECURITY DEFINER functions separately. Views are RLS bypasses by default unless `security_invoker=true` (Postgres 15+). Sequence access may require `USAGE` for approved insert callers. Review actual table references, triggers, and Edge/service-role consumers.
6. Test on a clean new database with restrictive defaults **and** against the current production default-grant model. Do not deploy a blanket `ALTER DEFAULT PRIVILEGES ... REVOKE` to the shared Billing Hub without completed impact analysis and separately authorized rollout.

## Example: tenant-isolated browser table (adapt to your actual schema)
```sql
create table public.example_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  item_name text not null
);
alter table public.example_items enable row level security;
revoke all on table public.example_items from public, anon, authenticated;
grant select, insert, update on table public.example_items to authenticated;
grant select, insert, update, delete on table public.example_items to service_role;
create policy example_items_select on public.example_items
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy example_items_insert on public.example_items
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy example_items_update on public.example_items
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
```
The example is **not** a real ValorWell tenant-policy template: copy the verified tenant capability contract, not the illustrative per-user ownership pattern.

## Example: intentionally unexposed table
```sql
-- @no-data-api public.example_internal_queue
create table public.example_internal_queue (id uuid primary key);
alter table public.example_internal_queue enable row level security;
revoke all on table public.example_internal_queue from public, anon, authenticated, service_role;
-- Only trusted owner-side SECURITY DEFINER code may access this table;
-- confirm exact database owner privileges, caller authorization and search_path.
```

## Read-only verification
```sql
select c.oid::regclass as table_name, c.relrowsecurity as rls,
       has_table_privilege('anon',c.oid,'select') as anon_select,
       has_table_privilege('authenticated',c.oid,'select') as auth_select,
       has_table_privilege('service_role',c.oid,'select') as server_select
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p')
 order by c.relname;
```

## Local migration guard
`node scripts/validate-public-table-grants.mjs --self-test` verifies parser fixtures. The CI check runs this script against SQL migration files added or modified in a PR. It catches simple `CREATE TABLE public.*` definitions lacking RLS or a documented/granted API access decision. **Static scanning is not a SQL parser, permission proof, or replacement for production grants and signed-JWT tests.** Its bypass convention (`@no-data-api`) is a documentation claim that still needs review.
