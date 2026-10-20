-- READ-ONLY PREVIEW REPLAY GATE / Billing Hub Supabase
-- Does NOT execute migrations, modify the ledger, or access business/PHI records.
-- This checks known early ordering failures only, not every migration's SQL.
WITH history AS (
 SELECT version, COALESCE(array_to_string(statements, E'\n'),'') AS sql_text
 FROM supabase_migrations.schema_migrations
), first_three AS (
 SELECT MAX(sql_text) FILTER(WHERE version='20251201181524') AS first_sql,
        MAX(sql_text) FILTER(WHERE version='20251201195701') AS second_sql
 FROM history
), checks AS (
 SELECT 'first migration available'::text AS check_name,
        (first_sql IS NOT NULL) AS okay,
        'version=20251201181524'::text AS observation FROM first_three
 UNION ALL SELECT 'trigger function defined before first use',
    first_sql IS NOT NULL AND first_sql ILIKE '%EXECUTE FUNCTION public.set_updated_at()%'
    AND (first_sql ILIKE '%CREATE FUNCTION public.set_updated_at()%'
         OR first_sql ILIKE '%CREATE OR REPLACE FUNCTION public.set_updated_at()%'),
    '20251201181524 invokes set_updated_at without declaring it' FROM first_three
 UNION ALL SELECT 'core tenants table created before second migration',
    second_sql IS NOT NULL AND EXISTS(SELECT 1 FROM history h
     WHERE h.version<'20251201195701' AND
     (h.sql_text ILIKE '%CREATE TABLE public.tenants %' OR
      h.sql_text ILIKE '%CREATE TABLE IF NOT EXISTS public.tenants %')),
    'second migration INSERT INTO public.tenants' FROM first_three
 UNION ALL SELECT 'staff_roles table created before second migration',
    second_sql IS NOT NULL AND EXISTS(SELECT 1 FROM history h
     WHERE h.version<'20251201195701' AND
     (h.sql_text ILIKE '%CREATE TABLE public.staff_roles %' OR
      h.sql_text ILIKE '%CREATE TABLE IF NOT EXISTS public.staff_roles %')),
    'second migration INSERT INTO public.staff_roles; third creates table' FROM first_three
 UNION ALL SELECT 'staff_role_assignments table created before second migration',
    second_sql IS NOT NULL AND EXISTS(SELECT 1 FROM history h
     WHERE h.version<'20251201195701' AND
     (h.sql_text ILIKE '%CREATE TABLE public.staff_role_assignments %' OR
      h.sql_text ILIKE '%CREATE TABLE IF NOT EXISTS public.staff_role_assignments %')),
    'second migration INSERT INTO public.staff_role_assignments; third creates table' FROM first_three
 UNION ALL SELECT 'tenant_memberships table created before second migration',
    second_sql IS NOT NULL AND EXISTS(SELECT 1 FROM history h
     WHERE h.version<'20251201195701' AND
     (h.sql_text ILIKE '%CREATE TABLE public.tenant_memberships %' OR
      h.sql_text ILIKE '%CREATE TABLE IF NOT EXISTS public.tenant_memberships %')),
    'second migration INSERT INTO public.tenant_memberships; third creates table' FROM first_three
 UNION ALL SELECT 'profiles table created before second migration',
    second_sql IS NOT NULL AND EXISTS(SELECT 1 FROM history h
     WHERE h.version<'20251201195701' AND
     (h.sql_text ILIKE '%CREATE TABLE public.profiles %' OR
      h.sql_text ILIKE '%CREATE TABLE IF NOT EXISTS public.profiles %')),
    'second migration INSERT INTO public.profiles' FROM first_three
 UNION ALL SELECT 'staff table created before second migration',
    second_sql IS NOT NULL AND EXISTS(SELECT 1 FROM history h
     WHERE h.version<'20251201195701' AND
     (h.sql_text ILIKE '%CREATE TABLE public.staff %' OR
      h.sql_text ILIKE '%CREATE TABLE IF NOT EXISTS public.staff %')),
    'second migration INSERT INTO public.staff' FROM first_three
), summary AS (
 SELECT 'ledger versions without SQL bodies'::text AS check_name, COUNT(*)=0 AS okay,
        COUNT(*)::text || ' versions missing SQL in ledger' AS observation
 FROM supabase_migrations.schema_migrations
 WHERE statements IS NULL OR cardinality(statements)=0
)
SELECT check_name, CASE WHEN okay THEN 'PASS' ELSE 'BLOCKED' END AS verdict, observation
FROM (SELECT * FROM checks UNION ALL SELECT * FROM summary) audit
ORDER BY check_name;
