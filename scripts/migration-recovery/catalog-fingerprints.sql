-- READ ONLY. No business rows or function text leave the database.
-- MD5 is a catalog comparison aid, not source authenticity/security proof.
WITH application_schema AS (
 SELECT oid,nspname FROM pg_namespace WHERE nspname IN ('public','private','credentialing')
), objects AS (
 SELECT 'schema'::text AS kind,n.nspname::text AS identity,
        md5(jsonb_build_array(pg_get_userbyid(n.nspowner),n.nspacl)::text) AS fingerprint
 FROM pg_namespace n JOIN application_schema s ON s.oid=n.oid
 UNION ALL
 SELECT 'relation',format('%I.%I',n.nspname,c.relname),
        md5(jsonb_build_array(c.relkind,c.relrowsecurity,c.relforcerowsecurity,
             c.reloptions,pg_get_userbyid(c.relowner),c.relacl,
             CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END)::text)
 FROM pg_class c JOIN application_schema n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p','v','m','S','f')
 UNION ALL
 SELECT 'column',format('%I.%I.%I',n.nspname,c.relname,a.attname),
        md5(jsonb_build_array(a.attnum,format_type(a.atttypid,a.atttypmod),a.attnotnull,
             a.attidentity,a.attgenerated,a.attacl,pg_get_expr(d.adbin,d.adrelid))::text)
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
 JOIN application_schema n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f')
 UNION ALL
 SELECT 'constraint',format('%I.%I.%I',n.nspname,c.relname,k.conname),
        md5(jsonb_build_array(pg_get_constraintdef(k.oid,true),k.convalidated,k.condeferrable,k.condeferred)::text)
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
 JOIN application_schema n ON n.oid=c.relnamespace
 UNION ALL
 SELECT 'index',format('%I.%I',n.nspname,c.relname),
        md5(jsonb_build_array(pg_get_indexdef(c.oid),i.indisvalid,i.indisready)::text)
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
 JOIN application_schema n ON n.oid=c.relnamespace
 UNION ALL
 SELECT 'function',format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
        md5(jsonb_build_array(pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),p.proacl,p.proconfig)::text)
 FROM pg_proc p JOIN application_schema n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p')
 UNION ALL
 SELECT 'trigger',format('%I.%I.%I',n.nspname,c.relname,t.tgname),
        md5(jsonb_build_array(pg_get_triggerdef(t.oid,true),t.tgenabled)::text)
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE NOT t.tgisinternal AND n.nspname IN ('public','private','credentialing','auth','storage')
 UNION ALL
 SELECT 'policy',format('%I.%I.%I',schemaname,tablename,policyname),
        md5(jsonb_build_array(permissive,roles,cmd,qual,with_check)::text)
 FROM pg_policies WHERE schemaname IN ('public','private','credentialing','auth','storage')
 UNION ALL
 SELECT 'type',format('%I.%I',n.nspname,t.typname),
        md5(jsonb_build_array(t.typtype,pg_get_userbyid(t.typowner),t.typacl,
             (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid))::text)
 FROM pg_type t JOIN application_schema n ON n.oid=t.typnamespace
 WHERE t.typtype IN ('e','d')
 UNION ALL
 SELECT 'default_acl',format('%s.%s.%s',pg_get_userbyid(d.defaclrole),coalesce(n.nspname,'GLOBAL'),d.defaclobjtype),
        md5(d.defaclacl::text)
 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
 UNION ALL
 SELECT 'extension',e.extname,md5(jsonb_build_array(e.extversion,n.nspname)::text)
 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
 UNION ALL
 SELECT 'role',rolname,md5(jsonb_build_array(rolsuper,rolinherit,rolcreaterole,rolcreatedb,
                 rolcanlogin,rolreplication,rolbypassrls,rolconfig)::text)
 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','postgres','supabase_admin','supabase_auth_admin','supabase_storage_admin')
 UNION ALL
 SELECT 'role_membership',format('%s->%s',pg_get_userbyid(member),pg_get_userbyid(roleid)),
        md5(jsonb_build_array(admin_option,inherit_option,set_option)::text)
 FROM pg_auth_members
 UNION ALL
 SELECT 'publication',pubname,md5(jsonb_build_array(puballtables,pubinsert,pubupdate,pubdelete,pubtruncate)::text)
 FROM pg_publication
 UNION ALL
 SELECT 'publication_table',format('%s:%I.%I',pubname,schemaname,tablename),
        md5(jsonb_build_array(attnames,rowfilter)::text)
 FROM pg_publication_tables
)
SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'identity',identity,'fingerprint',fingerprint)
                        ORDER BY kind,identity),'[]'::jsonb) AS catalog FROM objects;