-- Authorized operator only, exact preview identity verified outside this query.
-- Catalog summaries only. No SQL/function bodies, credentials or data exported.
-- These observations do not resolve parity or authenticate the remote receipt.
BEGIN TRANSACTION READ ONLY;
SELECT extname, extversion, n.nspname AS extension_schema
FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
WHERE extname IN ('pg_net','pg_cron') ORDER BY extname;

-- Owner/schema/kind counts only: not reconstruction of the 12 omitted statements.
SELECT r.rolname AS acl_owner, coalesce(n.nspname,'(global)') AS scope,
       d.defaclobjtype AS object_kind, count(*) AS catalog_entries
FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole
LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
WHERE r.rolname='supabase_admin'
GROUP BY r.rolname,n.nspname,d.defaclobjtype
ORDER BY scope,object_kind;

-- Missing pg_cron must fail rather than look like an empty scheduler.
SELECT count(*) AS cron_jobs, count(*) FILTER (WHERE active) AS active_jobs
FROM cron.job;
ROLLBACK;
