create or replace function public.ai_ops_ingest_generic_results(
  p_tenant_id uuid,
  p_run_id uuid,
  p_module public.ai_ops_module_enum
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_item record;
  v_result jsonb;
  v_snapshot record;
  v_observed text[] := '{}'::text[];
  v_findings integer := 0;
  v_skipped integer := 0;
  v_fingerprint text;
  v_concern text;
  v_severity public.ai_ops_severity_enum;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  for v_item in
    select w.structured_result
    from private.ai_ops_work_items w
    where w.tenant_id = p_tenant_id
      and w.run_id = p_run_id
      and w.module = p_module
      and w.status = 'completed'
  loop
    for v_result in
      select value from jsonb_array_elements(coalesce(v_item.structured_result->'results', '[]'::jsonb))
    loop
      select s.entity_type, s.entity_id, s.payload
        into v_snapshot
      from private.ai_ops_snapshots s
      where s.tenant_id = p_tenant_id
        and s.snapshot_type = p_module::text || ':' || p_run_id::text
        and s.snapshot_hash = v_result->>'entityKey'
      limit 1;

      if v_snapshot.entity_id is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if coalesce((v_result->>'noConcern')::boolean, false)
         or coalesce(v_result->>'severity', 'low') = 'low' then
        continue;
      end if;

      v_concern := coalesce(nullif(v_result->>'concernType',''), nullif(v_result->>'findingType',''), 'operational_concern');
      v_severity := coalesce(nullif(v_result->>'severity',''), 'medium')::public.ai_ops_severity_enum;
      v_fingerprint := p_module::text || ':' || v_snapshot.entity_type || ':' || v_snapshot.entity_id || ':' || v_concern;
      v_observed := array_append(v_observed, v_fingerprint);

      perform public.ai_ops_upsert_finding(
        p_tenant_id,
        p_run_id,
        p_module,
        v_fingerprint,
        left(coalesce(v_result->>'title', initcap(replace(p_module::text, '_', ' ')) || ' concern'), 300),
        v_severity,
        left(coalesce(v_result->>'summary', ''), 2000),
        left(coalesce(v_result->>'recommendedAction', ''), 1000),
        v_snapshot.entity_type,
        v_snapshot.entity_id,
        nullif(v_result->>'confidence','')::numeric,
        null,
        jsonb_build_array(jsonb_build_object(
          'sourceType', v_snapshot.entity_type,
          'sourceRecordId', v_snapshot.entity_id,
          'sourceTimestamp', v_snapshot.payload->>'sourceTimestamp',
          'excerpt', left(array_to_string(array(select jsonb_array_elements_text(coalesce(v_snapshot.payload->'derivedSignals','[]'::jsonb))), ', '), 500),
          'evidenceHash', md5(v_fingerprint || coalesce(v_snapshot.payload->'derivedSignals','[]'::jsonb)::text)
        ))
      );
      v_findings := v_findings + 1;
    end loop;
  end loop;

  perform public.ai_ops_autoresolve_findings(p_tenant_id, p_module, p_run_id, v_observed);
  return jsonb_build_object('findings', v_findings, 'unmatchedResults', v_skipped);
end;
$function$;

create or replace function public.ai_ops_build_staff_quality_batches(
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
  v_row record;
  v_entities jsonb := '[]'::jsonb;
  v_payload jsonb;
  v_signals text[];
  v_entity_key text;
  v_batch integer := 0;
  v_total integer := 0;
  v_queued integer := 0;
  v_batch_size integer := least(greatest(coalesce(p_batch_size,6),3),8);
begin
  if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501'; end if;

  for v_row in
    select s.id,
      (select count(*)::int from public.crm_tasks t where t.tenant_id=p_tenant_id and t.staff_id=s.id and t.status::text <> 'completed' and t.due_at is not null and t.due_at < p_cutoff_at) as overdue_tasks,
      (select count(*)::int from public.crm_tasks t where t.tenant_id=p_tenant_id and t.staff_id=s.id and t.completed_at between p_cutoff_at-interval '7 days' and p_cutoff_at) as completed_tasks_7d,
      (select count(*)::int from public.appointments a where a.tenant_id=p_tenant_id and a.staff_id=s.id and a.start_at between p_cutoff_at-interval '7 days' and p_cutoff_at and a.status::text='documented') as documented_sessions_7d,
      (select count(*)::int from public.appointments a where a.tenant_id=p_tenant_id and a.staff_id=s.id and a.start_at between p_cutoff_at-interval '30 days' and p_cutoff_at and a.status::text in ('cancelled','late_cancel/noshow')) as cancellations_30d,
      (select count(*)::int from public.appointments a where a.tenant_id=p_tenant_id and a.staff_id=s.id and a.end_at < p_cutoff_at-interval '2 hours' and a.start_at >= p_cutoff_at-interval '7 days' and a.status::text='scheduled') as stale_scheduled_7d,
      (select count(*)::int from public.appointments a left join public.appointment_clinical_notes n on n.appointment_id=a.id and n.tenant_id=a.tenant_id where a.tenant_id=p_tenant_id and a.staff_id=s.id and a.start_at between p_cutoff_at-interval '7 days' and p_cutoff_at-interval '2 hours' and a.status::text='documented' and n.finalized_at is null) as unfinalized_notes_7d
    from public.staff s
    where s.tenant_id=p_tenant_id and s.prov_status::text='Active'
    order by s.id
  loop
    v_total := v_total + 1;
    v_signals := '{}'::text[];
    if v_row.overdue_tasks > 0 then v_signals := array_append(v_signals,'overdueAssignedTasks'); end if;
    if v_row.stale_scheduled_7d > 0 then v_signals := array_append(v_signals,'pastAppointmentsStillScheduled'); end if;
    if v_row.unfinalized_notes_7d > 0 then v_signals := array_append(v_signals,'documentedSessionsWithoutFinalizedNote'); end if;
    if v_row.cancellations_30d >= 3 then v_signals := array_append(v_signals,'elevatedCancellationOrNoShowCount'); end if;

    v_entity_key := 's' || left(md5(v_row.id::text || p_run_id::text),12);
    v_payload := jsonb_build_object(
      'entityKey',v_entity_key,
      'overdueAssignedTasks',v_row.overdue_tasks,
      'completedTasksLast7Days',v_row.completed_tasks_7d,
      'documentedSessionsLast7Days',v_row.documented_sessions_7d,
      'cancellationsOrNoShowsLast30Days',v_row.cancellations_30d,
      'pastAppointmentsStillScheduledLast7Days',v_row.stale_scheduled_7d,
      'documentedSessionsWithoutFinalizedNoteLast7Days',v_row.unfinalized_notes_7d,
      'derivedSignals',to_jsonb(v_signals),
      'sourceTimestamp',p_cutoff_at
    );

    insert into private.ai_ops_snapshots(tenant_id,entity_type,entity_id,snapshot_type,snapshot_hash,evaluation_hash,cutoff_at,payload,expires_at)
    values(p_tenant_id,'staff',v_row.id::text,'staff_quality:'||p_run_id::text,v_entity_key,md5((v_payload-'entityKey')::text),p_cutoff_at,v_payload,now()+interval '14 days');

    v_entities := v_entities || v_payload;
    if jsonb_array_length(v_entities) >= v_batch_size then
      v_batch := v_batch + 1;
      perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'staff_quality','staff_quality:'||p_run_id::text||':'||v_batch,'staff_service_quality_review',jsonb_build_object('entities',v_entities),'1','1',60,'gemini-2.5-pro','{}'::uuid[]);
      v_queued := v_queued + jsonb_array_length(v_entities);
      v_entities := '[]'::jsonb;
    end if;
  end loop;
  if jsonb_array_length(v_entities)>0 then
    v_batch := v_batch+1;
    perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'staff_quality','staff_quality:'||p_run_id::text||':'||v_batch,'staff_service_quality_review',jsonb_build_object('entities',v_entities),'1','1',60,'gemini-2.5-pro','{}'::uuid[]);
    v_queued := v_queued + jsonb_array_length(v_entities);
  end if;
  return jsonb_build_object('sourceItemsTotal',v_total,'itemsQueued',v_queued,'batchesQueued',v_batch,'cutoffAt',p_cutoff_at);
end;
$function$;

create or replace function public.ai_ops_build_appointment_integrity_batches(
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
  v_row record; v_entities jsonb := '[]'::jsonb; v_payload jsonb; v_signals text[]; v_entity_key text;
  v_batch integer:=0; v_seen integer:=0; v_queued integer:=0; v_batch_size integer:=least(greatest(coalesce(p_batch_size,6),3),8);
begin
  if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501'; end if;
  for v_row in
    select a.id,a.client_id,a.staff_id,a.service_id,a.start_at,a.end_at,a.status::text as status,a.is_telehealth,a.videoroom_url,
      exists(select 1 from public.appointment_clinical_notes n where n.tenant_id=p_tenant_id and n.appointment_id=a.id and n.finalized_at is not null) as has_finalized_note,
      (select count(*)::int from public.appointments d where d.tenant_id=p_tenant_id and d.client_id=a.client_id and d.start_at=a.start_at and d.id<>a.id and d.status::text<>'cancelled') as duplicate_count
    from public.appointments a
    where a.tenant_id=p_tenant_id and a.start_at between p_cutoff_at-interval '7 days' and p_cutoff_at+interval '2 days'
    order by a.start_at,a.id
  loop
    v_seen:=v_seen+1; v_signals:='{}'::text[];
    if v_row.client_id is null then v_signals:=array_append(v_signals,'missingClient'); end if;
    if v_row.staff_id is null then v_signals:=array_append(v_signals,'missingStaff'); end if;
    if v_row.service_id is null then v_signals:=array_append(v_signals,'missingService'); end if;
    if v_row.end_at <= v_row.start_at then v_signals:=array_append(v_signals,'invalidTimeRange'); end if;
    if v_row.status='scheduled' and v_row.end_at < p_cutoff_at-interval '2 hours' then v_signals:=array_append(v_signals,'pastAppointmentStillScheduled'); end if;
    if v_row.status='documented' and not v_row.has_finalized_note then v_signals:=array_append(v_signals,'documentedWithoutFinalizedNote'); end if;
    if v_row.status<>'documented' and v_row.has_finalized_note then v_signals:=array_append(v_signals,'finalizedNoteStatusConflict'); end if;
    if v_row.status='scheduled' and v_row.is_telehealth and v_row.start_at between p_cutoff_at and p_cutoff_at+interval '24 hours' and coalesce(v_row.videoroom_url,'')='' then v_signals:=array_append(v_signals,'telehealthRoomMissingWithin24Hours'); end if;
    if v_row.duplicate_count>0 then v_signals:=array_append(v_signals,'duplicateClientStartTime'); end if;
    if cardinality(v_signals)=0 then continue; end if;

    v_entity_key:='a'||left(md5(v_row.id::text||p_run_id::text),12);
    v_payload:=jsonb_build_object('entityKey',v_entity_key,'status',v_row.status,'startAt',v_row.start_at,'hoursFromCutoff',round((extract(epoch from (v_row.start_at-p_cutoff_at))/3600)::numeric,1),'isTelehealth',v_row.is_telehealth,'hasFinalizedNote',v_row.has_finalized_note,'duplicateCount',v_row.duplicate_count,'derivedSignals',to_jsonb(v_signals),'sourceTimestamp',v_row.start_at);
    insert into private.ai_ops_snapshots(tenant_id,entity_type,entity_id,snapshot_type,snapshot_hash,evaluation_hash,cutoff_at,payload,expires_at)
    values(p_tenant_id,'appointment',v_row.id::text,'appointment_integrity:'||p_run_id::text,v_entity_key,md5((v_payload-'entityKey')::text),p_cutoff_at,v_payload,now()+interval '14 days');
    v_entities:=v_entities||v_payload; v_queued:=v_queued+1;
    if jsonb_array_length(v_entities)>=v_batch_size then
      v_batch:=v_batch+1;
      perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'appointment_integrity','appointment_integrity:'||p_run_id::text||':'||v_batch,'appointment_integrity_review',jsonb_build_object('entities',v_entities),'1','1',40,'gemini-2.5-pro','{}'::uuid[]);
      v_entities:='[]'::jsonb;
    end if;
  end loop;
  if jsonb_array_length(v_entities)>0 then v_batch:=v_batch+1; perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'appointment_integrity','appointment_integrity:'||p_run_id::text||':'||v_batch,'appointment_integrity_review',jsonb_build_object('entities',v_entities),'1','1',40,'gemini-2.5-pro','{}'::uuid[]); end if;
  return jsonb_build_object('sourceItemsTotal',v_seen,'itemsQueued',v_queued,'batchesQueued',v_batch,'cutoffAt',p_cutoff_at);
end;
$function$;

create or replace function public.ai_ops_build_billing_claims_batches(
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
  v_row record; v_entities jsonb:='[]'::jsonb; v_payload jsonb; v_signals text[]; v_entity_key text;
  v_batch integer:=0; v_seen integer:=0; v_queued integer:=0; v_batch_size integer:=least(greatest(coalesce(p_batch_size,6),3),8);
begin
  if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501'; end if;
  for v_row in
    select c.id,c.claim_status,c.created_at,c.updated_at,c.total_charge,c.source_service_event_id,
      (select count(*)::int from public.claim_status_events e where e.tenant_id=p_tenant_id and e.claim_id=c.id) as status_events,
      (select count(*)::int from public.billing_reconciliation_findings f where f.tenant_id=p_tenant_id and f.claim_id=c.id and coalesce(f.status,'open') not in ('resolved','closed')) as open_reconciliation,
      (select max(e.created_at) from public.claim_status_events e where e.tenant_id=p_tenant_id and e.claim_id=c.id) as last_status_at
    from public.claims c
    where c.tenant_id=p_tenant_id and c.claim_status not in ('paid','void','cancelled')
    order by c.updated_at,c.id
  loop
    v_seen:=v_seen+1; v_signals:='{}'::text[];
    if lower(coalesce(v_row.claim_status,'')) in ('rejected','denied') then v_signals:=array_append(v_signals,'claimRejectedOrDenied'); end if;
    if lower(coalesce(v_row.claim_status,''))='accepted' and coalesce(v_row.last_status_at,v_row.updated_at) < p_cutoff_at-interval '14 days' then v_signals:=array_append(v_signals,'acceptedClaimNoMovement14Days'); end if;
    if v_row.status_events=0 then v_signals:=array_append(v_signals,'noClaimStatusHistory'); end if;
    if v_row.open_reconciliation>0 then v_signals:=array_append(v_signals,'openBillingReconciliationFinding'); end if;
    if cardinality(v_signals)=0 then continue; end if;
    v_entity_key:='b'||left(md5(v_row.id::text||p_run_id::text),12);
    v_payload:=jsonb_build_object('entityKey',v_entity_key,'claimStatus',v_row.claim_status,'ageDays',floor(extract(epoch from (p_cutoff_at-v_row.created_at))/86400)::int,'daysSinceLastStatus',floor(extract(epoch from (p_cutoff_at-coalesce(v_row.last_status_at,v_row.updated_at)))/86400)::int,'totalCharge',v_row.total_charge,'statusEventCount',v_row.status_events,'openReconciliationFindings',v_row.open_reconciliation,'hasSourceServiceEvent',v_row.source_service_event_id is not null,'derivedSignals',to_jsonb(v_signals),'sourceTimestamp',coalesce(v_row.last_status_at,v_row.updated_at));
    insert into private.ai_ops_snapshots(tenant_id,entity_type,entity_id,snapshot_type,snapshot_hash,evaluation_hash,cutoff_at,payload,expires_at)
    values(p_tenant_id,'claim',v_row.id::text,'billing_claims:'||p_run_id::text,v_entity_key,md5((v_payload-'entityKey')::text),p_cutoff_at,v_payload,now()+interval '30 days');
    v_entities:=v_entities||v_payload; v_queued:=v_queued+1;
    if jsonb_array_length(v_entities)>=v_batch_size then v_batch:=v_batch+1; perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'billing_claims','billing_claims:'||p_run_id::text||':'||v_batch,'billing_claims_review',jsonb_build_object('entities',v_entities),'1','1',30,'gemini-2.5-pro','{}'::uuid[]); v_entities:='[]'::jsonb; end if;
  end loop;
  if jsonb_array_length(v_entities)>0 then v_batch:=v_batch+1; perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'billing_claims','billing_claims:'||p_run_id::text||':'||v_batch,'billing_claims_review',jsonb_build_object('entities',v_entities),'1','1',30,'gemini-2.5-pro','{}'::uuid[]); end if;
  return jsonb_build_object('sourceItemsTotal',v_seen,'itemsQueued',v_queued,'batchesQueued',v_batch,'cutoffAt',p_cutoff_at);
end;
$function$;

create or replace function public.ai_ops_build_data_quality_batches(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_checks jsonb := '[]'::jsonb; v_entity jsonb; v_key text; v_count integer; v_index integer:=0;
begin
  if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501'; end if;

  for v_entity in select * from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('check','appointments_missing_core_links','count',(select count(*) from public.appointments a where a.tenant_id=p_tenant_id and (a.client_id is null or a.staff_id is null or a.service_id is null)),'description','Appointments missing client, staff, or service references'),
    jsonb_build_object('check','appointments_invalid_time_range','count',(select count(*) from public.appointments a where a.tenant_id=p_tenant_id and a.end_at<=a.start_at),'description','Appointments whose end time is not after start time'),
    jsonb_build_object('check','duplicate_client_start_times','count',(select count(*) from (select a.client_id,a.start_at from public.appointments a where a.tenant_id=p_tenant_id and a.status::text<>'cancelled' group by a.client_id,a.start_at having count(*)>1) d),'description','Duplicate non-cancelled appointments for the same client and start time'),
    jsonb_build_object('check','claims_missing_core_links','count',(select count(*) from public.claims c where c.tenant_id=p_tenant_id and (c.client_id is null or c.rendering_staff_id is null)),'description','Claims missing client or rendering staff references'),
    jsonb_build_object('check','duplicate_relationship_emails','count',(select count(*) from (select lower(trim(c.email)) from public.relationship_contacts c where c.tenant_id=p_tenant_id and coalesce(trim(c.email),'')<>'' group by lower(trim(c.email)) having count(*)>1) d),'description','Duplicate relationship contact email identities'),
    jsonb_build_object('check','active_staff_missing_profile','count',(select count(*) from public.staff s where s.tenant_id=p_tenant_id and s.prov_status::text='Active' and s.profile_id is null),'description','Active staff records missing a linked profile'),
    jsonb_build_object('check','overdue_tasks_missing_owner','count',(select count(*) from public.crm_tasks t where t.tenant_id=p_tenant_id and t.status::text<>'completed' and t.due_at<p_cutoff_at and t.owner_id is null and t.staff_id is null),'description','Overdue CRM tasks with no owner or staff assignment'),
    jsonb_build_object('check','orphan_billing_service_events','count',(select count(*) from public.billing_service_events b left join public.appointments a on a.id=b.appointment_id and a.tenant_id=b.tenant_id where b.tenant_id=p_tenant_id and a.id is null),'description','Billing service events whose appointment no longer exists')
  )) loop
    v_count:=coalesce((v_entity->>'count')::int,0);
    if v_count=0 then continue; end if;
    v_index:=v_index+1; v_key:='dq'||left(md5((v_entity->>'check')||p_run_id::text),12);
    v_entity:=v_entity||jsonb_build_object('entityKey',v_key,'derivedSignals',jsonb_build_array(v_entity->>'check'),'sourceTimestamp',p_cutoff_at);
    insert into private.ai_ops_snapshots(tenant_id,entity_type,entity_id,snapshot_type,snapshot_hash,evaluation_hash,cutoff_at,payload,expires_at)
    values(p_tenant_id,'data_quality_check',v_entity->>'check','data_quality:'||p_run_id::text,v_key,md5((v_entity-'entityKey')::text),p_cutoff_at,v_entity,now()+interval '14 days');
    v_checks:=v_checks||v_entity;
  end loop;

  if jsonb_array_length(v_checks)>0 then
    perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'data_quality','data_quality:'||p_run_id::text,'data_quality_review',jsonb_build_object('entities',v_checks),'1','1',20,'gemini-2.5-pro','{}'::uuid[]);
  end if;
  return jsonb_build_object('sourceItemsTotal',8,'itemsQueued',jsonb_array_length(v_checks),'batchesQueued',case when jsonb_array_length(v_checks)>0 then 1 else 0 end,'cutoffAt',p_cutoff_at);
end;
$function$;

create or replace function public.ai_ops_autoresolve_findings(p_tenant_id uuid, p_module public.ai_ops_module_enum, p_run_id uuid, p_observed_fingerprints text[])
returns integer language plpgsql security definer set search_path to '' as $function$
declare v_count integer:=0; v_row record; v_deterministic boolean := (p_module in ('system_integrity','appointment_integrity','data_quality'));
begin
  if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501'; end if;
  for v_row in select id,status from public.ai_operations_findings where tenant_id=p_tenant_id and module=p_module and status in ('open','snoozed') and not (fingerprint=any(coalesce(p_observed_fingerprints,'{}'::text[]))) loop
    if v_deterministic then
      update public.ai_operations_findings set status='resolved',resolved_at=now(),snoozed_until=null,last_run_id=p_run_id,updated_at=now() where id=v_row.id;
      insert into public.ai_operations_finding_events(finding_id,tenant_id,event_type,actor_kind,previous_value,new_value,reason) values(v_row.id,p_tenant_id,'deterministically_resolved','system',jsonb_build_object('status',v_row.status),jsonb_build_object('status','resolved','runId',p_run_id),'Deterministic evidence shows the underlying condition no longer exists.');
      v_count:=v_count+1;
    else
      insert into public.ai_operations_finding_events(finding_id,tenant_id,event_type,actor_kind,previous_value,new_value,reason) values(v_row.id,p_tenant_id,'not_observed','system',jsonb_build_object('status',v_row.status),jsonb_build_object('status',v_row.status,'runId',p_run_id),'Not returned by this analysis. Absence is not proof of resolution, so the finding stays open.');
    end if;
  end loop;
  return v_count;
end;
$function$;

insert into private.ai_ops_flags(tenant_id,flag_name,enabled)
values
 ('00000000-0000-0000-0000-000000000001','staff_quality_ai_enabled',true),
 ('00000000-0000-0000-0000-000000000001','appointment_integrity_ai_enabled',true),
 ('00000000-0000-0000-0000-000000000001','billing_claims_ai_enabled',true),
 ('00000000-0000-0000-0000-000000000001','data_quality_ai_enabled',true)
on conflict (tenant_id,flag_name) do update set enabled=excluded.enabled,updated_at=now();