-- Read-only inspection of the October 2026 shared Supabase security rollout.
-- Run with a privileged SQL read account AFTER controlled migrations, or before
-- them to obtain an explicit FAILED baseline. This script never mutates data,
-- changes session roles, submits claims, posts payments, or sends messages.
-- A PASS is a privilege/catalog result, not signed-JWT application acceptance.
with expected(label, signature, expected_anon, expected_authenticated, expected_service) as (
  values
    ('stripe_payment_post', 'public.process_stripe_checkout_payment(text,text,integer,uuid[],uuid[])', false, false, true),
    ('crm_idempotency_claim', 'public._crm_idempotency_claim(text,text,uuid,uuid)', false, false, true),
    ('crm_idempotency_record', 'public._crm_idempotency_record(text,text,jsonb)', false, false, true),
    ('claim_submission_finalizer', 'public.finalize_claim_submission(uuid,text,jsonb)', false, false, true),
    ('stedi_submission_finalizer', 'public.finalize_stedi_submission_attempt_v2(uuid,text,text,jsonb,text,text,boolean)', false, false, true),
    ('payroll_reconciliation', 'public.reconcile_payroll_line_items_from_attempts(uuid)', false, false, true),
    ('payroll_historical_gap', 'public.payroll_refresh_historical_gap_findings_v1()', false, false, true),
    ('social_publish_enqueue', 'public.social_queue_publish(uuid)', false, false, true),
    ('campaign_trigger_enqueue', 'public.crm_enqueue_campaign_trigger_jobs(uuid)', false, false, true),
    ('email_reply_correlate', 'public.crm_correlate_client_email_reply(uuid)', false, false, true),
    ('campaign_concurrency', 'public.crm_evaluate_campaign_concurrency(uuid,uuid,text,uuid)', false, false, true),
    ('crm_automation_event', 'public.crm_emit_automation_event(uuid,text,text,uuid,text,jsonb,text,uuid,timestamptz)', false, false, true),
    ('crm_internal_tenant_check', 'public._crm_enrollment_tenant_check(uuid)', false, false, false),
    ('crm_manual_enrollment_api', 'public.crm_enroll_clients_in_campaign(uuid,uuid[],text,uuid,text)', false, true, true),
    ('crm_donor_overview_api', 'public.crm_donor_overview()', false, true, true),
    ('crm_legacy_replay_api', 'public.crm_enqueue_donor_transactions(text,boolean,integer)', false, true, true)
),
resolved as (
  select label, signature, expected_anon, expected_authenticated, expected_service,
         to_regprocedure(signature) as function_oid from expected
),
observed as (
  select *, case when function_oid is not null
           then has_function_privilege('anon',function_oid,'EXECUTE') end as actual_anon,
         case when function_oid is not null
           then has_function_privilege('authenticated',function_oid,'EXECUTE') end as actual_authenticated,
         case when function_oid is not null
           then has_function_privilege('service_role',function_oid,'EXECUTE') end as actual_service
    from resolved
)
select label, signature,
       case when function_oid is null then 'MISSING'
            when actual_anon is not distinct from expected_anon
              and actual_authenticated is not distinct from expected_authenticated
              and actual_service is not distinct from expected_service then 'PASS'
            else 'FAIL' end as acl_result,
       actual_anon as anon_execute, actual_authenticated as authenticated_execute,
       actual_service as service_execute,
       expected_anon, expected_authenticated, expected_service
  from observed order by label;

-- For the intentionally authenticated donor replay API, a permitted EXECUTE
-- does not mean it may process historical Givebutter transactions. Assert
-- that the function BODY is fail-closed before making release claims.
select 'legacy_givebutter_replay_fail_closed' as check_name,
       case when pg_get_functiondef(
         to_regprocedure('public.crm_enqueue_donor_transactions(text,boolean,integer)')
       ) like '%LEGACY_DONOR_SOURCE_OWNERSHIP_REQUIRED%'
       then 'PASS' else 'FAIL' end as result;

select 'legacy_donor_overview_explicitly_unavailable' as check_name,
       case when pg_get_functiondef(to_regprocedure('public.crm_donor_overview()'))
              like '%legacy_source_tenant_ownership_unverified%'
       then 'PASS' else 'FAIL' end as result;

select 'title_change_trigger_search_path' as check_name,
       case when exists (
         select 1 from pg_proc p
          where p.oid=to_regprocedure(
            'private.invalidate_ai_operations_video_downstream_on_title_change()'
          )
            and not p.prosecdef
            and coalesce(p.proconfig,array[]::text[]) @> array['search_path=']
       ) then 'PASS' else 'FAIL' end as result;

select 'legacy_donor_transaction_view_browser_denial' as check_name,
       case when to_regclass('public.crm_donor_transactions_v') is null then 'MISSING'
            when not has_table_privilege('anon','public.crm_donor_transactions_v','SELECT')
             and not has_table_privilege('authenticated','public.crm_donor_transactions_v','SELECT')
             and has_table_privilege('service_role','public.crm_donor_transactions_v','SELECT')
            then 'PASS' else 'FAIL' end as result;
