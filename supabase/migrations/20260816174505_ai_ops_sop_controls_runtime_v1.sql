insert into public.ai_operations_sop_controls (
  tenant_id, control_key, domain, source_doc_name, source_doc_locator,
  control_text, evidence_contract, enabled
) values
(
  '00000000-0000-0000-0000-000000000001'::uuid,
  'clinical.documented_session_requires_finalized_ehr_note',
  'clinical_operations',
  '02 Clinical Documentation & EHR Completion SOP',
  'https://app.clickup.com/9013454061/docs/8ckwt7d-2093/8ckwt7d-2973',
  'A session may only be treated as completed/documented after the clinician completes the EHR documentation. An undocumented appointment must not be manually treated as completed.',
  jsonb_build_object(
    'evaluationType','deterministic_sql_summary',
    'windowHours',24,
    'passCondition','violationCount = 0',
    'sourceTables',jsonb_build_array('public.appointments','public.appointment_clinical_notes'),
    'implementationMapping','appointment_clinical_notes.finalized_at is the live-system evidence that EHR documentation is complete'
  ),
  true
),
(
  '00000000-0000-0000-0000-000000000001'::uuid,
  'finance.finalized_note_requires_billing_service_event',
  'finance_billing',
  '03 Claims, ERA, AR & Patient Responsibility',
  'https://app.clickup.com/9013454061/docs/8ckwt7d-1913/8ckwt7d-3113',
  'Once the clinician documents the session, the completed/documented session must automatically enter the insurance claim workflow.',
  jsonb_build_object(
    'evaluationType','deterministic_sql_summary',
    'windowHours',24,
    'technicalGraceMinutes',30,
    'passCondition','violationCount = 0',
    'sourceTables',jsonb_build_array('public.appointment_clinical_notes','public.billing_service_events')
  ),
  true
),
(
  '00000000-0000-0000-0000-000000000001'::uuid,
  'finance.billing_service_event_requires_finalized_note',
  'finance_billing',
  '02 Session Economics & Clinician Pay',
  'https://app.clickup.com/9013454061/docs/8ckwt7d-1913/8ckwt7d-3093',
  'No documentation means no completed session and no financial handoff. A billing service event must not exist as a completed-service financial event without completed EHR documentation.',
  jsonb_build_object(
    'evaluationType','deterministic_sql_summary',
    'windowHours',24,
    'passCondition','violationCount = 0',
    'sourceTables',jsonb_build_array('public.billing_service_events','public.appointment_clinical_notes')
  ),
  true
),
(
  '00000000-0000-0000-0000-000000000001'::uuid,
  'finance.payroll_eligibility_requires_finalized_note',
  'finance_billing',
  '02 Session Economics & Clinician Pay',
  'https://app.clickup.com/9013454061/docs/8ckwt7d-1913/8ckwt7d-3093',
  'No documentation means no clinician pay for that session. Payroll eligibility must only be created from a completed/documented session.',
  jsonb_build_object(
    'evaluationType','deterministic_sql_summary',
    'windowHours',24,
    'passCondition','violationCount = 0',
    'sourceTables',jsonb_build_array('public.billing_service_events','public.appointment_clinical_notes')
  ),
  true
),
(
  '00000000-0000-0000-0000-000000000001'::uuid,
  'finance.finalized_service_event_requires_claim',
  'finance_billing',
  '03 Claims, ERA, AR & Patient Responsibility',
  'https://app.clickup.com/9013454061/docs/8ckwt7d-1913/8ckwt7d-3113',
  'Once the clinician documents the session, the claim automatically submits to insurance. A finalized billing service event must progress to a claim rather than remain unsubmitted.',
  jsonb_build_object(
    'evaluationType','deterministic_sql_summary',
    'windowHours',24,
    'technicalGraceMinutes',120,
    'passCondition','violationCount = 0',
    'sourceTables',jsonb_build_array('public.billing_service_events','public.claims')
  ),
  true
)
on conflict (tenant_id, control_key) do update set
  domain = excluded.domain,
  source_doc_name = excluded.source_doc_name,
  source_doc_locator = excluded.source_doc_locator,
  control_text = excluded.control_text,
  evidence_contract = excluded.evidence_contract,
  enabled = excluded.enabled,
  updated_at = now();

create or replace function public.ai_ops_refresh_sop_observations(
  p_tenant_id uuid,
  p_cutoff_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_source_prefix constant text := 'ai_ops_sop_runtime_v1:';
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  delete from public.ai_operations_sop_observations o
  where o.tenant_id = p_tenant_id
    and o.source_reference like v_source_prefix || '%'
    and o.observed_at >= p_cutoff_at - interval '48 hours';

  insert into public.ai_operations_sop_observations (
    tenant_id, control_key, observed_at, entity_type, entity_id, evidence, source_reference
  )
  with evaluated as (
    select
      a.id,
      (
        a.documented_at is null
        or not exists (
          select 1
          from public.appointment_clinical_notes n
          where n.tenant_id = a.tenant_id
            and n.appointment_id = a.id
            and n.finalized_at is not null
        )
      ) as violation
    from public.appointments a
    where a.tenant_id = p_tenant_id
      and a.end_at >= p_cutoff_at - interval '24 hours'
      and a.end_at < p_cutoff_at
      and a.status::text = 'documented'
  )
  select
    p_tenant_id,
    'clinical.documented_session_requires_finalized_ehr_note',
    p_cutoff_at,
    'sop_control_summary',
    'clinical.documented_session_requires_finalized_ehr_note',
    jsonb_build_object(
      'evaluationStatus', case when count(*) = 0 then 'no_activity' when count(*) filter (where violation) = 0 then 'compliant' else 'deviation' end,
      'evaluatedRecords', count(*),
      'violationCount', count(*) filter (where violation),
      'windowStart', p_cutoff_at - interval '24 hours',
      'windowEnd', p_cutoff_at,
      'ruleEvidence', 'documented appointment requires documented_at and a finalized EHR note'
    ),
    v_source_prefix || 'appointments+clinical_notes'
  from evaluated;

  insert into public.ai_operations_sop_observations (
    tenant_id, control_key, observed_at, entity_type, entity_id, evidence, source_reference
  )
  with evaluated as (
    select
      n.id,
      not exists (
        select 1
        from public.billing_service_events b
        where b.tenant_id = n.tenant_id
          and (b.clinical_note_id = n.id or b.appointment_id = n.appointment_id)
      ) as violation
    from public.appointment_clinical_notes n
    where n.tenant_id = p_tenant_id
      and n.finalized_at >= p_cutoff_at - interval '24 hours'
      and n.finalized_at <= p_cutoff_at - interval '30 minutes'
  )
  select
    p_tenant_id,
    'finance.finalized_note_requires_billing_service_event',
    p_cutoff_at,
    'sop_control_summary',
    'finance.finalized_note_requires_billing_service_event',
    jsonb_build_object(
      'evaluationStatus', case when count(*) = 0 then 'no_activity' when count(*) filter (where violation) = 0 then 'compliant' else 'deviation' end,
      'evaluatedRecords', count(*),
      'violationCount', count(*) filter (where violation),
      'windowStart', p_cutoff_at - interval '24 hours',
      'windowEnd', p_cutoff_at,
      'technicalGraceMinutes', 30,
      'ruleEvidence', 'finalized EHR note should create a billing service event'
    ),
    v_source_prefix || 'clinical_notes+billing_service_events'
  from evaluated;

  insert into public.ai_operations_sop_observations (
    tenant_id, control_key, observed_at, entity_type, entity_id, evidence, source_reference
  )
  with evaluated as (
    select
      b.id,
      (
        b.clinical_note_id is null
        or not exists (
          select 1
          from public.appointment_clinical_notes n
          where n.tenant_id = b.tenant_id
            and n.id = b.clinical_note_id
            and n.finalized_at is not null
        )
      ) as violation
    from public.billing_service_events b
    where b.tenant_id = p_tenant_id
      and greatest(b.created_at, b.updated_at) >= p_cutoff_at - interval '24 hours'
      and greatest(b.created_at, b.updated_at) < p_cutoff_at
  )
  select
    p_tenant_id,
    'finance.billing_service_event_requires_finalized_note',
    p_cutoff_at,
    'sop_control_summary',
    'finance.billing_service_event_requires_finalized_note',
    jsonb_build_object(
      'evaluationStatus', case when count(*) = 0 then 'no_activity' when count(*) filter (where violation) = 0 then 'compliant' else 'deviation' end,
      'evaluatedRecords', count(*),
      'violationCount', count(*) filter (where violation),
      'windowStart', p_cutoff_at - interval '24 hours',
      'windowEnd', p_cutoff_at,
      'ruleEvidence', 'billing service event requires a finalized clinical note'
    ),
    v_source_prefix || 'billing_service_events+clinical_notes'
  from evaluated;

  insert into public.ai_operations_sop_observations (
    tenant_id, control_key, observed_at, entity_type, entity_id, evidence, source_reference
  )
  with evaluated as (
    select
      b.id,
      (
        b.clinical_note_id is null
        or not exists (
          select 1
          from public.appointment_clinical_notes n
          where n.tenant_id = b.tenant_id
            and n.id = b.clinical_note_id
            and n.finalized_at is not null
        )
      ) as violation
    from public.billing_service_events b
    where b.tenant_id = p_tenant_id
      and b.payroll_eligible = true
      and greatest(b.created_at, b.updated_at) >= p_cutoff_at - interval '24 hours'
      and greatest(b.created_at, b.updated_at) < p_cutoff_at
  )
  select
    p_tenant_id,
    'finance.payroll_eligibility_requires_finalized_note',
    p_cutoff_at,
    'sop_control_summary',
    'finance.payroll_eligibility_requires_finalized_note',
    jsonb_build_object(
      'evaluationStatus', case when count(*) = 0 then 'no_activity' when count(*) filter (where violation) = 0 then 'compliant' else 'deviation' end,
      'evaluatedRecords', count(*),
      'violationCount', count(*) filter (where violation),
      'windowStart', p_cutoff_at - interval '24 hours',
      'windowEnd', p_cutoff_at,
      'ruleEvidence', 'payroll eligibility requires a finalized clinical note'
    ),
    v_source_prefix || 'payroll_eligibility+clinical_notes'
  from evaluated;

  insert into public.ai_operations_sop_observations (
    tenant_id, control_key, observed_at, entity_type, entity_id, evidence, source_reference
  )
  with evaluated as (
    select
      b.id,
      (b.claim_id is null) as violation
    from public.billing_service_events b
    where b.tenant_id = p_tenant_id
      and b.finalized_at is not null
      and b.finalized_at >= p_cutoff_at - interval '24 hours'
      and b.finalized_at <= p_cutoff_at - interval '2 hours'
  )
  select
    p_tenant_id,
    'finance.finalized_service_event_requires_claim',
    p_cutoff_at,
    'sop_control_summary',
    'finance.finalized_service_event_requires_claim',
    jsonb_build_object(
      'evaluationStatus', case when count(*) = 0 then 'no_activity' when count(*) filter (where violation) = 0 then 'compliant' else 'deviation' end,
      'evaluatedRecords', count(*),
      'violationCount', count(*) filter (where violation),
      'windowStart', p_cutoff_at - interval '24 hours',
      'windowEnd', p_cutoff_at,
      'technicalGraceMinutes', 120,
      'ruleEvidence', 'finalized billing service event should have a linked claim'
    ),
    v_source_prefix || 'billing_service_events+claims'
  from evaluated;

  return jsonb_build_object('controlsRefreshed', 5, 'observationsInserted', 5, 'cutoffAt', p_cutoff_at);
end;
$function$;

revoke all on function public.ai_ops_refresh_sop_observations(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.ai_ops_refresh_sop_observations(uuid,timestamptz) to service_role;

create or replace function public.ai_ops_build_sop_compliance_batches(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamptz default now(),
  p_batch_size integer default 6
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_controls int;
  v_observations int;
  v_entities jsonb := '[]'::jsonb;
  v_row record;
  v_key text;
  v_batch int := 0;
  v_batch_size int := least(greatest(coalesce(p_batch_size,6),3),8);
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode='42501';
  end if;

  perform public.ai_ops_refresh_sop_observations(p_tenant_id, p_cutoff_at);

  select count(*) into v_controls
  from public.ai_operations_sop_controls
  where tenant_id=p_tenant_id and enabled;

  if v_controls=0 then
    return jsonb_build_object('sourceAvailable',false,'unavailableReason','no_runtime_sop_controls_mirrored','sourceItemsTotal',0,'itemsQueued',0,'batchesQueued',0);
  end if;

  select count(*) into v_observations
  from public.ai_operations_sop_observations
  where tenant_id=p_tenant_id and observed_at>=p_cutoff_at-interval '24 hours';

  if v_observations=0 then
    return jsonb_build_object('sourceAvailable',false,'unavailableReason','no_sop_observation_contracts_emitting','controlsAvailable',v_controls,'sourceItemsTotal',0,'itemsQueued',0,'batchesQueued',0);
  end if;

  for v_row in
    select
      c.control_key,c.domain,c.source_doc_name,c.control_text,c.evidence_contract,
      o.entity_type,o.entity_id,o.observed_at,o.evidence,o.source_reference
    from public.ai_operations_sop_controls c
    join public.ai_operations_sop_observations o
      on o.tenant_id=c.tenant_id and o.control_key=c.control_key
    where c.tenant_id=p_tenant_id
      and c.enabled
      and o.observed_at>=p_cutoff_at-interval '24 hours'
    order by c.control_key,o.observed_at
  loop
    v_key := 'sop'||left(md5(v_row.control_key||coalesce(v_row.entity_id,'')||p_run_id::text),12);
    v_entities := v_entities || jsonb_build_object(
      'entityKey',v_key,
      'controlKey',v_row.control_key,
      'domain',v_row.domain,
      'sourceDocument',v_row.source_doc_name,
      'control',v_row.control_text,
      'evidenceContract',v_row.evidence_contract,
      'observedEvidence',v_row.evidence,
      'sourceReference',v_row.source_reference,
      'sourceTimestamp',v_row.observed_at
    );
    if jsonb_array_length(v_entities)>=v_batch_size then
      v_batch:=v_batch+1;
      perform public.ai_ops_enqueue_work(
        p_tenant_id,p_run_id,'sop_compliance',
        'sop_compliance:'||p_run_id::text||':'||v_batch,
        'sop_compliance_review',
        jsonb_build_object('entities',v_entities),
        '1','1',55,'gemini-2.5-pro','{}'::uuid[]
      );
      v_entities:='[]'::jsonb;
    end if;
  end loop;

  if jsonb_array_length(v_entities)>0 then
    v_batch:=v_batch+1;
    perform public.ai_ops_enqueue_work(
      p_tenant_id,p_run_id,'sop_compliance',
      'sop_compliance:'||p_run_id::text||':'||v_batch,
      'sop_compliance_review',
      jsonb_build_object('entities',v_entities),
      '1','1',55,'gemini-2.5-pro','{}'::uuid[]
    );
  end if;

  return jsonb_build_object(
    'sourceAvailable',true,
    'controlsAvailable',v_controls,
    'observationsAvailable',v_observations,
    'sourceItemsTotal',v_observations,
    'itemsQueued',v_observations,
    'batchesQueued',v_batch
  );
end;
$function$;
