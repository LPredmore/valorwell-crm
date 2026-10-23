-- Operator-only read-only evidence. Never select OAuth/runtime credentials or mail bodies.
SELECT now() AS observed_at,
 c.id AS connection_id,c.status,s.gmail_history_id,s.last_successful_sync_at,
 s.last_notification_at,s.gmail_watch_expiration,s.last_error_code,
 CASE WHEN s.last_error_reason LIKE '%record_relationship_gmail_retrieval_failure%'
   THEN 'missing_retrieval_failure_rpc' WHEN s.last_error_reason LIKE '%schema cache%'
   THEN 'schema_contract_error' ELSE NULL END AS error_class,
 extract(epoch FROM(now()-s.last_successful_sync_at))::bigint AS sync_age_seconds
FROM private.relationship_google_connections c
JOIN private.relationship_google_sync_state s ON s.connection_id=c.id
WHERE c.tenant_id='00000000-0000-0000-0000-000000000001'
 AND c.connection_type='gmail' AND c.google_account_email='info@valorwell.org';

SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS signature,
 p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) AS owner,p.proacl,
 md5(pg_get_functiondef(p.oid)) AS definition_md5
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','private') AND p.proname IN (
 'record_relationship_gmail_source_receipt','record_relationship_gmail_retrieval_failure',
 'get_relationship_gmail_runtime_contract','get_relationship_google_sync_state',
 'update_relationship_google_sync_state','ingest_relationship_gmail_message',
 'match_relationship_gmail_message','claim_relationship_gmail_backfill',
 'checkpoint_relationship_gmail_backfill','release_relationship_gmail_backfill');

SELECT version,name,md5(statements::text) AS body_md5 FROM supabase_migrations.schema_migrations
WHERE version>='20261022190000' ORDER BY version;

SELECT count(*) AS open_sync_issues,
 count(*) FILTER(WHERE details->>'requires_historical_backfill'='true') AS historical_gaps
FROM public.relationship_reconciliation_issues
WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND status='open' AND source='gmail' AND issue_type='sync_error';

-- Cron result alone is not a function outcome. These are global transport aggregates;
-- they cannot be attributed to Gmail without a dispatch request-id receipt.
SELECT status_code,timed_out,count(*) FROM net._http_response
WHERE created>now()-interval '6 hours' GROUP BY status_code,timed_out;