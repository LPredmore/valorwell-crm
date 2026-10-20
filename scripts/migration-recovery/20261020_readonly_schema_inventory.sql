-- Read-only Supabase schema-only baseline catalog inventory.
-- No table rows, clinical data, migration changes, or provider/worker calls.
-- Compare AFTER an approved baseline reconstruction, not as a replacement
-- for schema definitions, grants, signed tenant tests or historical replay.
WITH selected(schema_name) AS (
 VALUES ('public'::text),('private'::text),('credentialing'::text)
)
SELECT s.schema_name,
 (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=s.schema_name AND c.relkind IN ('r','p')) AS base_tables,
 (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=s.schema_name AND c.relkind IN ('r','p') AND c.relrowsecurity) AS rls_enabled,
 (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=s.schema_name AND c.relkind='v') AS views,
 (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=s.schema_name AND c.relkind='v'
     AND array_to_string(c.reloptions,',') ILIKE '%security_invoker%') AS invoker_views,
 (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname=s.schema_name AND p.prokind='f') AS functions,
 (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname=s.schema_name AND p.prokind='f' AND p.prosecdef) AS definer_functions,
 (SELECT COUNT(*) FROM pg_policies p WHERE p.schemaname=s.schema_name) AS policies,
 (SELECT COUNT(*) FROM pg_indexes i WHERE i.schemaname=s.schema_name) AS indexes,
 (SELECT COUNT(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=s.schema_name
   AND NOT t.tgisinternal) AS application_triggers
FROM selected s ORDER BY s.schema_name;
