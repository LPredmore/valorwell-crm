-- Catalog evidence only: no patient records, role switching, or external requests.
-- Run after the ordered release. Current production is expected to fail pending gates.
BEGIN READ ONLY;
WITH internal(signature) AS (VALUES
 ('public._crm_idempotency_claim(text,text,uuid,uuid)'),
 ('public._crm_idempotency_record(text,text,jsonb)'),
 ('public.finalize_claim_submission(uuid,text,jsonb)'),
 ('public.finalize_stedi_submission_attempt_v2(uuid,text,text,jsonb,text,text,boolean)'),
 ('public.reconcile_payroll_line_items_from_attempts(uuid)'),
 ('public.payroll_refresh_historical_gap_findings_v1()'),
 ('public.social_queue_publish(uuid)'),
 ('public.crm_enqueue_campaign_trigger_jobs(uuid)'),
 ('public.crm_correlate_client_email_reply(uuid)'),
 ('public.crm_evaluate_campaign_concurrency(uuid,uuid,text,uuid)'),
 ('public.crm_emit_automation_event(uuid,text,text,uuid,text,jsonb,text,uuid,timestamptz)'),
 ('public._crm_enrollment_tenant_check(uuid)'))
SELECT jsonb_build_object(
 'missing_internal_functions',(SELECT count(*) FROM internal WHERE to_regprocedure(signature) IS NULL),
 'browser_callable_internal_functions',(SELECT count(*) FROM internal WHERE has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE')),
 'anonymous_callable_internal_functions',(SELECT count(*) FROM internal WHERE has_function_privilege('anon',to_regprocedure(signature),'EXECUTE')),
 'service_callable_internal_functions',(SELECT count(*) FROM internal WHERE has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE')),
 'payroll_corrected_hash',encode(sha256(convert_to(pg_get_functiondef('public.staff_get_payroll_statement_v2(date,date,uuid)'::regprocedure),'UTF8')),'hex')='1da469903a9bcd8fea465ff98622b7e89078840ea4affa81115b3c109e617436',
 'private_claim_invariant_installed',to_regprocedure('private.claim_is_externally_submitted_internal_v1(uuid)') IS NOT NULL,
 'campaign_profile_contract',position(E'where profile_id = v_actor\n       and tenant_id = v_campaign_tenant_id' IN pg_get_functiondef('public.crm_enroll_clients_in_campaign(uuid,uuid[],text,uuid,text)'::regprocedure))>0,
 'legacy_donor_fail_closed',position('LEGACY_DONOR_SOURCE_OWNERSHIP_REQUIRED' IN pg_get_functiondef('public.crm_enqueue_donor_transactions(text,boolean,integer)'::regprocedure))>0,
 'tenant_storage_write_policies',(SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname IN ('crm_public_assets_tenant_insert','crm_public_assets_tenant_update','crm_public_assets_tenant_delete')),
 'active_stedi_jobs',(SELECT count(*) FROM cron.job WHERE active AND (jobname ILIKE '%stedi%' OR command ILIKE '%stedi%')),
 'enabled_stedi_routes',(SELECT count(*) FROM public.claim_clearinghouse_routes WHERE lower(clearinghouse)='stedi' AND enabled),
 'stedi_no_reactivation_constraint',EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.claim_clearinghouse_routes'::regclass AND conname='claim_clearinghouse_routes_no_active_stedi' AND convalidated)
) AS catalog_evidence;
-- Expected: missing/browser/anonymous = 0; service = 12; policies = 3;
-- active jobs/routes = 0; all boolean fields true. Still not runtime acceptance.
SELECT policyname,cmd,roles,qual,with_check FROM pg_policies
WHERE schemaname='storage' AND tablename='objects'
AND (coalesce(qual,'')||coalesce(with_check,'')) ~ '(org-logos|training-covers|email-signatures)'
ORDER BY policyname;
COMMIT;
