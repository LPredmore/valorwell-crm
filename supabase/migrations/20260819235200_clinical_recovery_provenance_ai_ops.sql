-- Keep live CRM communication side effects separate from historical clinical recovery,
-- and surface the recovery backlog as an explicit AI Ops control.

create or replace function private.crm_stop_client_campaigns_on_lifecycle_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_enrollment record; v_count integer:=0;
begin
  if new.state_dimension::text<>'lifecycle_stage'
     or coalesce(new.source,'') in ('migration_backfill','legacy_clinical_reconciliation')
     or new.old_status is not distinct from new.new_status then
    return new;
  end if;

  for v_enrollment in
    select e.id,e.campaign_id,e.status
    from public.crm_campaign_enrollments e
    where e.tenant_id=new.tenant_id and e.client_id=new.client_id and e.status in ('active','paused')
    for update
  loop
    update public.crm_campaign_step_logs
    set status='skipped',skip_reason='lifecycle_changed',claimed_at=null,claim_token=null,updated_at=clock_timestamp()
    where enrollment_id=v_enrollment.id and status in ('scheduled','processing');
    update public.crm_campaign_enrollments
    set status='cancelled',completed_at=coalesce(completed_at,new.changed_at,clock_timestamp()),
        paused_at=coalesce(paused_at,new.changed_at,clock_timestamp()),pause_reason='lifecycle_changed',updated_at=clock_timestamp()
    where id=v_enrollment.id;
    v_count:=v_count+1;
  end loop;

  if v_count>0 then
    insert into public.crm_activity_events(tenant_id,client_id,event_type,old_value,new_value,metadata)
    values(new.tenant_id,new.client_id,'campaign_auto_cancelled',new.old_status,new.new_status,
      jsonb_build_object('triggered_by','lifecycle_change','stopped_enrollments',v_count,'source',new.source,'reason',new.reason));
  end if;
  return new;
end;
$function$;

insert into public.ai_operations_sop_controls(
  tenant_id,control_key,domain,source_doc_name,source_doc_locator,control_text,evidence_contract,enabled,updated_at
)
select
  t.id,
  'clinical.legacy_reconciliation_backlog',
  'clinical_operations',
  '02 Clinical Documentation & EHR Completion SOP',
  'https://app.clickup.com/9013454061/docs/8ckwt7d-2093/8ckwt7d-2973',
  'Historical or anomalous clinical records must remain explicitly classified and financially held until clinical and financial reconciliation is complete.',
  jsonb_build_object(
    'evaluationType','deterministic_sql_summary',
    'sourceTables',jsonb_build_array('private.clinical_recovery_cases','public.billing_service_events'),
    'passCondition','no stale unresolved recovery cases outside operational SLA',
    'implementationMapping','clinical_recovery_cases + billing_service_events.financial_hold'
  ),
  true,clock_timestamp()
from public.tenants t
on conflict(tenant_id,control_key) do update
set control_text=excluded.control_text,evidence_contract=excluded.evidence_contract,enabled=true,updated_at=clock_timestamp();

create or replace function public.ai_ops_refresh_clinical_recovery_observation_v1(
  p_tenant_id uuid,
  p_cutoff_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_total integer;
  v_held integer;
  v_review integer;
  v_stale integer;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode='42501';
  end if;

  select count(*),
         count(*) filter(where financial_state in ('held','manual_review')),
         count(*) filter(where clinical_state in ('needs_clinician_review','lifecycle_review_required')),
         count(*) filter(where financial_state in ('held','manual_review','unreconciled') and updated_at<p_cutoff_at-interval '72 hours')
  into v_total,v_held,v_review,v_stale
  from private.clinical_recovery_cases
  where tenant_id=p_tenant_id
    and financial_state<>'historically_complete';

  delete from public.ai_operations_sop_observations
  where tenant_id=p_tenant_id
    and control_key='clinical.legacy_reconciliation_backlog'
    and source_reference='ai_ops_clinical_recovery_v1';

  insert into public.ai_operations_sop_observations(
    tenant_id,control_key,observed_at,entity_type,entity_id,evidence,source_reference
  ) values(
    p_tenant_id,'clinical.legacy_reconciliation_backlog',p_cutoff_at,
    'sop_control_summary','clinical.legacy_reconciliation_backlog',
    jsonb_build_object(
      'evaluationStatus',case when v_stale>0 then 'deviation' when v_total=0 then 'no_activity' else 'compliant' end,
      'recoveryCases',v_total,'financialHolds',v_held,'clinicalReviewCases',v_review,
      'staleOver72Hours',v_stale,'cutoffAt',p_cutoff_at
    ),
    'ai_ops_clinical_recovery_v1'
  );

  return jsonb_build_object('recoveryCases',v_total,'financialHolds',v_held,'clinicalReviewCases',v_review,'staleOver72Hours',v_stale);
end;
$function$;

-- Add the recovery observation to the existing SOP-compliance refresh without
-- replacing the current five deterministic controls.
do $patch$
declare
  v_sql text;
  v_old text:='perform public.ai_ops_refresh_sop_observations(p_tenant_id, p_cutoff_at);';
  v_new text:=v_old||E'\n  perform public.ai_ops_refresh_clinical_recovery_observation_v1(p_tenant_id, p_cutoff_at);';
begin
  select pg_get_functiondef('public.ai_ops_build_sop_compliance_batches(uuid,uuid,timestamptz,integer)'::regprocedure) into v_sql;
  if position(v_new in v_sql)>0 then return; end if;
  if position(v_old in v_sql)=0 then raise exception 'Unexpected AI Ops SOP batch baseline'; end if;
  execute replace(v_sql,v_old,v_new);
end;
$patch$;

comment on function public.ai_ops_refresh_clinical_recovery_observation_v1(uuid,timestamptz) is
  'AI Ops provenance control for governed historical clinical recovery. Historical records are tracked separately instead of being misrepresented as modern Final Sign defects.';
