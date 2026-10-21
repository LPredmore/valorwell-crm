-- Metadata only; never returns names, function definitions or business rows.
SELECT jsonb_build_object(
  'counts', (SELECT jsonb_object_agg(nspname, counts) FROM (
    SELECT n.nspname, jsonb_build_object(
      'tables', (SELECT count(*) FROM pg_class c WHERE c.relnamespace=n.oid AND c.relkind IN ('r','p')),
      'functions', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace=n.oid AND p.prokind IN ('f','p')),
      'views', (SELECT count(*) FROM pg_class c WHERE c.relnamespace=n.oid AND c.relkind='v'),
      'policies', (SELECT count(*) FROM pg_policies p WHERE p.schemaname=n.nspname),
      'triggers', (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
                   WHERE c.relnamespace=n.oid AND NOT t.tgisinternal)) AS counts
    FROM pg_namespace n WHERE n.nspname IN ('public','private','credentialing')
  ) s),
  'rls_enabled_tables', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                        WHERE n.nspname IN ('public','private','credentialing')
                        AND c.relkind IN ('r','p') AND c.relrowsecurity),
  'security_definer_count', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                           WHERE n.nspname IN ('public','private','credentialing') AND p.prosecdef));