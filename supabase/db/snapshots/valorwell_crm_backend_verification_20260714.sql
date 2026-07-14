-- ValorWell CRM backend verification
-- Safe intent: catalog/read verification. Transactional simulations are rolled back.
-- Target contract: valorwell-crm-contracts@1.0.1+20260714

-- 1. Contract objects and privileges
with functions as (
  select p.proname,
         pg_get_function_identity_arguments(p.oid) as args,
         has_function_privilege('anon',p.oid,'EXECUTE') as anon_exec,
         has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_exec,
         has_function_privilege('service_role',p.oid,'EXECUTE') as service_exec
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in (
      'crm_transition_lifecycle','crm_set_engagement','crm_set_contact_policy',
      'crm_set_service_policy','crm_set_eligibility','crm_set_care_cadence',
      'crm_assign_clinician','crm_close_client','crm_reopen_client',
      'crm_evaluate_communication_policy','crm_apply_remove',
      'claim_pending_campaign_steps','release_campaign_step_claim'
    )
)
select * from functions order by proname,args;

-- 2. Security-invoker views and authenticated privileges
select c.relname,
       c.reloptions,
       has_table_privilege('authenticated',c.oid,'SELECT') as can_select,
       has_table_privilege('authenticated',c.oid,'INSERT') as can_insert,
       has_table_privilege('authenticated',c.oid,'UPDATE') as can_update,
       has_table_privilege('authenticated',c.oid,'DELETE') as can_delete
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in (
    'v_client_canonical_state','v_crm_reports_funnel','v_crm_reports_engagement',
    'v_crm_reports_closure','v_crm_reports_campaigns','v_crm_reports_tasks',
    'v_crm_reports_exceptions'
  )
order by c.relname;

-- 3. Direct canonical-column protection
select
  has_column_privilege('authenticated','public.clients','email','UPDATE') as ordinary_email_update,
  has_column_privilege('authenticated','public.clients','pat_status','UPDATE') as legacy_status_update,
  has_column_privilege('authenticated','public.clients','lifecycle_stage','UPDATE') as lifecycle_update,
  has_column_privilege('authenticated','public.clients','contact_policy','UPDATE') as contact_policy_update,
  has_column_privilege('authenticated','public.clients','service_policy','UPDATE') as service_policy_update,
  has_column_privilege('authenticated','public.clients','primary_staff_id','UPDATE') as clinician_update;

-- 4. Scheduler queue health
select status,count(*) from public.crm_campaign_step_logs group by status order by status;
select
  count(*) filter(where status='processing' and claim_token is null) as processing_without_claim,
  count(*) filter(where status='processing' and claimed_at < now()-interval '30 minutes') as stale_processing
from public.crm_campaign_step_logs;

-- 5. Legacy status/campaign trigger check: expected zero rows
select n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal
  and (
    pg_get_triggerdef(t.oid) ilike '%cancel_campaign_on_status_change%'
    or pg_get_triggerdef(t.oid) ilike '%enroll_campaign_on_status_change%'
  );

-- 6. Policy evaluator read-only checks
select jsonb_build_object(
  'dnc_ordinary',(
    select public.crm_evaluate_communication_policy(id,'email','ordinary_promotional')
    from public.clients where contact_policy='do_not_contact' limit 1
  ),
  'dnc_scheduling',(
    select public.crm_evaluate_communication_policy(id,'sms','necessary_scheduling')
    from public.clients where contact_policy='do_not_contact' and service_policy='normal' limit 1
  ),
  'service_blocked',(
    select public.crm_evaluate_communication_policy(id,'sms','clinical_safety_legal')
    from public.clients where service_policy='service_blocked' limit 1
  ),
  'normal_ordinary',(
    select public.crm_evaluate_communication_policy(id,'email','ordinary_promotional')
    from public.clients
    where contact_policy='normal' and service_policy='normal' and lifecycle_stage<>'closed'
    limit 1
  )
) as policy_results;

-- 7. Claim/release simulation. All changes roll back.
begin;
update public.crm_campaign_step_logs
set scheduled_for=now()-interval '1 minute',updated_at=now()
where id=(
  select id from public.crm_campaign_step_logs
  where status='scheduled'
  order by scheduled_for
  limit 1
);

create temporary table crm_claim_verification on commit drop as
select * from public.claim_pending_campaign_steps(1);

select public.release_campaign_step_claim(
  id,claim_token,'scheduled','verification_release',now()+interval '15 minutes'
)
from crm_claim_verification;

select
  l.id,l.status,l.claim_token,l.scheduled_for,
  (l.claim_token is null) as claim_cleared,
  (l.scheduled_for>now()) as rescheduled_future
from public.crm_campaign_step_logs l
join crm_claim_verification v on v.id=l.id;
rollback;


-- 8. Authenticated staff contract checks and idempotent replay.
-- Chooses an existing admin/staff identity and rolls back the mutation.
begin;
select set_config(
  'request.jwt.claim.sub',
  (
    select ur.user_id::text
    from public.user_roles ur
    join public.tenant_memberships tm on tm.profile_id=ur.user_id
    where ur.role::text in ('admin','staff')
    limit 1
  ),
  true
);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

create temporary table crm_engagement_replay_verification on commit drop as
select client_id,concurrency_token,gen_random_uuid() as idempotency_key
from public.v_client_canonical_state
where engagement='Normal'
order by client_id
limit 1;

select jsonb_build_object(
  'wrong_contract',
  (
    select public.crm_set_engagement(
      client_id,'Unresponsive Warm','verification only',concurrency_token,
      gen_random_uuid(),'wrong-version'
    )
    from crm_engagement_replay_verification
  ),
  'auto_token',
  (
    select public.crm_set_engagement(
      client_id,'Unresponsive Warm','verification only','auto',
      gen_random_uuid(),'valorwell-crm-contracts@1.0.1+20260714'
    )
    from crm_engagement_replay_verification
  )
) as rejected_contract_requests;

select public.crm_set_engagement(
  client_id,'Unresponsive Warm','rollback verification',concurrency_token,
  idempotency_key,'valorwell-crm-contracts@1.0.1+20260714'
) as first_result
from crm_engagement_replay_verification;

-- Uses the original token intentionally. A correct idempotent replay returns
-- the cached first result before stale-concurrency evaluation.
select public.crm_set_engagement(
  client_id,'Unresponsive Warm','rollback verification',concurrency_token,
  idempotency_key,'valorwell-crm-contracts@1.0.1+20260714'
) as replay_result
from crm_engagement_replay_verification;
rollback;

-- 9. Client-role isolation.
begin;
select set_config(
  'request.jwt.claim.sub',
  (
    select ur.user_id::text
    from public.user_roles ur
    where ur.role::text='client'
    limit 1
  ),
  true
);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

select jsonb_build_object(
  'staff_role',
  public.crm_has_role(
    auth.uid(),
    array['admin','staff'],
    (select tenant_id from public.tenant_memberships where profile_id=auth.uid() limit 1)
  ),
  'canonical_rows_visible',(select count(*) from public.v_client_canonical_state),
  'activity_rows_visible',(select count(*) from public.crm_activity_events),
  'funnel_rows_visible',(select count(*) from public.v_crm_reports_funnel)
) as client_isolation;
rollback;

-- 10. Service-only REMOVE command. This is a rollback-only database test and
-- does not invoke RingCentral or Help Scout.
begin;
set local role service_role;
select public.crm_apply_remove(
  c.tenant_id,
  c.id,
  'rollback_verification',
  gen_random_uuid()::text
) as remove_result
from public.clients c
where c.contact_policy='normal'
  and not exists (
    select 1
    from public.crm_campaign_enrollments e
    where e.client_id=c.id and e.status='active'
  )
limit 1;
rollback;

-- 11. Activity taxonomy and canonical guard definitions.
select conname,pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid='public.crm_activity_events'::regclass
  and conname='crm_activity_events_event_type_check';

select pg_get_functiondef(
  'public.enforce_canonical_client_state_write()'::regprocedure
) as canonical_guard_definition;
