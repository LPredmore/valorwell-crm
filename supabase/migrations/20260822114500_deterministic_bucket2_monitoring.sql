-- Bucket 2 deterministic monitoring cutover.
-- Objective operational rules write directly to the existing AI Operations finding lifecycle.
-- No Gemini call is required for these modules.

create or replace function public.ai_ops_autoresolve_deterministic_findings(
  p_tenant_id uuid,
  p_module public.ai_ops_module_enum,
  p_run_id uuid,
  p_observed_fingerprints text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer := 0;
  v_row record;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode='42501';
  end if;

  for v_row in
    select id, status
    from public.ai_operations_findings
    where tenant_id = p_tenant_id
      and module = p_module
      and status in ('open','snoozed')
      and fingerprint like 'det:%'
      and not (fingerprint = any(coalesce(p_observed_fingerprints, '{}'::text[])))
  loop
    update public.ai_operations_findings
       set status = 'resolved',
           resolved_at = now(),
           snoozed_until = null,
           last_run_id = p_run_id,
           updated_at = now()
     where id = v_row.id;

    insert into public.ai_operations_finding_events(
      finding_id, tenant_id, event_type, actor_kind, previous_value, new_value, reason
    ) values (
      v_row.id, p_tenant_id, 'deterministically_resolved', 'system',
      jsonb_build_object('status', v_row.status),
      jsonb_build_object('status', 'resolved', 'runId', p_run_id),
      'Deterministic evidence shows the monitored condition no longer exists.'
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.ai_ops_autoresolve_deterministic_findings(uuid, public.ai_ops_module_enum, uuid, text[]) from public, anon, authenticated;
grant execute on function public.ai_ops_autoresolve_deterministic_findings(uuid, public.ai_ops_module_enum, uuid, text[]) to service_role;

create or replace function public.ai_ops_evaluate_appointment_integrity_deterministic(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_rule text;
  v_fp text;
  v_observed text[] := '{}'::text[];
  v_seen integer := 0;
  v_findings integer := 0;
  v_resolved integer := 0;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode='42501';
  end if;

  for v_row in
    select a.id,a.client_id,a.staff_id,a.service_id,a.start_at,a.end_at,a.status::text as status,
           a.is_telehealth,a.videoroom_url,
           exists(select 1 from public.appointment_clinical_notes n
                  where n.tenant_id=p_tenant_id and n.appointment_id=a.id and n.finalized_at is not null) as has_finalized_note,
           (select count(*)::int from public.appointments d
             where d.tenant_id=p_tenant_id and d.client_id=a.client_id and d.start_at=a.start_at
               and d.id<>a.id and d.status::text<>'cancelled') as duplicate_count
      from public.appointments a
     where a.tenant_id=p_tenant_id
       and a.start_at between p_cutoff_at-interval '7 days' and p_cutoff_at+interval '2 days'
     order by a.start_at,a.id
  loop
    v_seen := v_seen + 1;
    for v_rule in
      select rule from (values
        (case when v_row.client_id is null then 'missing_client' end),
        (case when v_row.staff_id is null then 'missing_staff' end),
        (case when v_row.service_id is null then 'missing_service' end),
        (case when v_row.end_at <= v_row.start_at then 'invalid_time_range' end),
        (case when v_row.status='scheduled' and v_row.end_at < p_cutoff_at-interval '2 hours' then 'past_appointment_still_scheduled' end),
        (case when v_row.status='documented' and not v_row.has_finalized_note then 'documented_without_finalized_note' end),
        (case when v_row.status<>'documented' and v_row.has_finalized_note then 'finalized_note_status_conflict' end),
        (case when v_row.status='scheduled' and v_row.is_telehealth and v_row.start_at between p_cutoff_at and p_cutoff_at+interval '24 hours'
                    and coalesce(v_row.videoroom_url,'')='' then 'telehealth_room_missing_within_24h' end),
        (case when v_row.duplicate_count>0 then 'duplicate_client_start_time' end)
      ) as rules(rule)
      where rule is not null
    loop
      v_fp := 'det:appointment_integrity:'||v_rule||':'||v_row.id::text;
      v_observed := array_append(v_observed, v_fp);
      v_findings := v_findings + 1;

      perform public.ai_ops_upsert_finding(
        p_tenant_id, p_run_id, 'appointment_integrity', v_fp,
        case v_rule
          when 'missing_client' then 'Appointment is missing a client'
          when 'missing_staff' then 'Appointment is missing assigned staff'
          when 'missing_service' then 'Appointment is missing a service'
          when 'invalid_time_range' then 'Appointment has an invalid time range'
          when 'past_appointment_still_scheduled' then 'Past appointment is still marked scheduled'
          when 'documented_without_finalized_note' then 'Documented appointment has no finalized clinical note'
          when 'finalized_note_status_conflict' then 'Finalized clinical note conflicts with appointment status'
          when 'telehealth_room_missing_within_24h' then 'Telehealth appointment is missing a room within 24 hours'
          else 'Duplicate active appointment exists for the same client and start time'
        end,
        case when v_rule='past_appointment_still_scheduled'
             then 'medium'::public.ai_ops_severity_enum
             else 'high'::public.ai_ops_severity_enum end,
        case v_rule
          when 'past_appointment_still_scheduled' then format('Appointment ended before the monitoring cutoff but status is still scheduled. Start: %s.', v_row.start_at)
          when 'telehealth_room_missing_within_24h' then format('Telehealth appointment starts at %s and has no videoroom URL.', v_row.start_at)
          when 'duplicate_client_start_time' then format('%s other non-cancelled appointment(s) share this client and start time.', v_row.duplicate_count)
          else format('Deterministic appointment-integrity rule %s is currently true.', v_rule)
        end,
        'Review the source appointment and correct the owning workflow if the source state is wrong.',
        'appointment', v_row.id::text, null, null,
        jsonb_build_object(
          'rule',v_rule,'status',v_row.status,'startAt',v_row.start_at,'endAt',v_row.end_at,
          'hasFinalizedNote',v_row.has_finalized_note,'duplicateCount',v_row.duplicate_count,'cutoffAt',p_cutoff_at
        )
      );
    end loop;
  end loop;

  v_resolved := public.ai_ops_autoresolve_deterministic_findings(p_tenant_id,'appointment_integrity',p_run_id,v_observed);
  return jsonb_build_object(
    'sourceItemsTotal',v_seen,'itemsAnalyzed',v_seen,'findingsObserved',v_findings,
    'findingsResolved',v_resolved,'itemsFailed',0,'mode','deterministic','cutoffAt',p_cutoff_at
  );
end;
$function$;

revoke all on function public.ai_ops_evaluate_appointment_integrity_deterministic(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.ai_ops_evaluate_appointment_integrity_deterministic(uuid,uuid,timestamptz) to service_role;

create or replace function public.ai_ops_evaluate_billing_claims_deterministic(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_rule text;
  v_fp text;
  v_observed text[] := '{}'::text[];
  v_seen integer:=0;
  v_findings integer:=0;
  v_resolved integer:=0;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode='42501';
  end if;

  for v_row in
    select c.id,c.claim_status,c.created_at,c.updated_at,c.total_charge,c.source_service_event_id,
      (select count(*)::int from public.claim_status_events e where e.tenant_id=p_tenant_id and e.claim_id=c.id) as status_events,
      (select count(*)::int from public.billing_reconciliation_findings f
        where f.tenant_id=p_tenant_id and f.claim_id=c.id and coalesce(f.status,'open') not in ('resolved','closed')) as open_reconciliation,
      (select max(e.created_at) from public.claim_status_events e where e.tenant_id=p_tenant_id and e.claim_id=c.id) as last_status_at
    from public.claims c
    where c.tenant_id=p_tenant_id and c.claim_status not in ('paid','void','cancelled')
    order by c.updated_at,c.id
  loop
    v_seen:=v_seen+1;
    for v_rule in
      select rule from (values
        (case when lower(coalesce(v_row.claim_status,'')) in ('rejected','denied') then 'rejected_or_denied' end),
        (case when lower(coalesce(v_row.claim_status,''))='accepted'
                    and coalesce(v_row.last_status_at,v_row.updated_at) < p_cutoff_at-interval '14 days'
               then 'accepted_no_movement_14d' end),
        (case when v_row.status_events=0 then 'no_status_history' end),
        (case when v_row.open_reconciliation>0 then 'open_reconciliation' end)
      ) rules(rule)
      where rule is not null
    loop
      v_fp:='det:billing_claims:'||v_rule||':'||v_row.id::text;
      v_observed:=array_append(v_observed,v_fp);
      v_findings:=v_findings+1;
      perform public.ai_ops_upsert_finding(
        p_tenant_id,p_run_id,'billing_claims',v_fp,
        case v_rule
          when 'rejected_or_denied' then 'Claim is rejected or denied'
          when 'accepted_no_movement_14d' then 'Accepted claim has had no movement for 14 days'
          when 'no_status_history' then 'Claim has no status-event history'
          else 'Claim has an open billing reconciliation finding'
        end,
        case when v_rule in ('rejected_or_denied','open_reconciliation')
             then 'high'::public.ai_ops_severity_enum
             else 'medium'::public.ai_ops_severity_enum end,
        case v_rule
          when 'accepted_no_movement_14d' then format('Claim has remained accepted without a newer status event since %s.',coalesce(v_row.last_status_at,v_row.updated_at))
          when 'open_reconciliation' then format('%s open reconciliation finding(s) are linked to this claim.',v_row.open_reconciliation)
          else format('Claim status is %s; deterministic billing rule %s is currently true.',v_row.claim_status,v_rule)
        end,
        'Review the claim in Billing and resolve the underlying revenue-cycle exception.',
        'claim',v_row.id::text,null,null,
        jsonb_build_object(
          'rule',v_rule,'claimStatus',v_row.claim_status,'statusEventCount',v_row.status_events,
          'openReconciliationFindings',v_row.open_reconciliation,'lastStatusAt',v_row.last_status_at,
          'sourceServiceEventPresent',v_row.source_service_event_id is not null,'cutoffAt',p_cutoff_at
        )
      );
    end loop;
  end loop;

  v_resolved:=public.ai_ops_autoresolve_deterministic_findings(p_tenant_id,'billing_claims',p_run_id,v_observed);
  return jsonb_build_object(
    'sourceItemsTotal',v_seen,'itemsAnalyzed',v_seen,'findingsObserved',v_findings,
    'findingsResolved',v_resolved,'itemsFailed',0,'mode','deterministic','cutoffAt',p_cutoff_at
  );
end;
$function$;

revoke all on function public.ai_ops_evaluate_billing_claims_deterministic(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.ai_ops_evaluate_billing_claims_deterministic(uuid,uuid,timestamptz) to service_role;

create or replace function public.ai_ops_evaluate_data_quality_deterministic(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_check jsonb;
  v_key text;
  v_count integer;
  v_fp text;
  v_observed text[]:='{}'::text[];
  v_findings integer:=0;
  v_resolved integer:=0;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode='42501';
  end if;

  for v_check in
    select * from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('key','appointments_missing_core_links','count',(select count(*) from public.appointments a where a.tenant_id=p_tenant_id and (a.client_id is null or a.staff_id is null or a.service_id is null)),'title','Appointments are missing core references','severity','high'),
      jsonb_build_object('key','appointments_invalid_time_range','count',(select count(*) from public.appointments a where a.tenant_id=p_tenant_id and a.end_at<=a.start_at),'title','Appointments have invalid time ranges','severity','high'),
      jsonb_build_object('key','duplicate_client_start_times','count',(select count(*) from (select a.client_id,a.start_at from public.appointments a where a.tenant_id=p_tenant_id and a.status::text<>'cancelled' group by a.client_id,a.start_at having count(*)>1) d),'title','Duplicate active appointment times exist','severity','high'),
      jsonb_build_object('key','claims_missing_core_links','count',(select count(*) from public.claims c where c.tenant_id=p_tenant_id and (c.client_id is null or c.rendering_staff_id is null)),'title','Claims are missing core references','severity','high'),
      jsonb_build_object('key','duplicate_relationship_emails','count',(select count(*) from (select lower(trim(c.email)) from public.relationship_contacts c where c.tenant_id=p_tenant_id and coalesce(trim(c.email),'')<>'' group by lower(trim(c.email)) having count(*)>1) d),'title','Duplicate relationship contact email identities exist','severity','medium'),
      jsonb_build_object('key','active_staff_missing_profile','count',(select count(*) from public.staff s where s.tenant_id=p_tenant_id and s.prov_status::text='Active' and s.profile_id is null),'title','Active staff records are missing linked profiles','severity','high'),
      jsonb_build_object('key','overdue_tasks_missing_owner','count',(select count(*) from public.crm_tasks t where t.tenant_id=p_tenant_id and t.status::text<>'completed' and t.due_at<p_cutoff_at and t.owner_id is null and t.staff_id is null),'title','Overdue CRM tasks have no owner','severity','medium'),
      jsonb_build_object('key','orphan_billing_service_events','count',(select count(*) from public.billing_service_events b left join public.appointments a on a.id=b.appointment_id and a.tenant_id=b.tenant_id where b.tenant_id=p_tenant_id and a.id is null),'title','Billing service events reference missing appointments','severity','high')
    ))
  loop
    v_count:=coalesce((v_check->>'count')::int,0);
    if v_count=0 then continue; end if;
    v_key:=v_check->>'key';
    v_fp:='det:data_quality:'||v_key;
    v_observed:=array_append(v_observed,v_fp);
    v_findings:=v_findings+1;
    perform public.ai_ops_upsert_finding(
      p_tenant_id,p_run_id,'data_quality',v_fp,v_check->>'title',
      (v_check->>'severity')::public.ai_ops_severity_enum,
      format('%s record(s) currently violate the deterministic check %s.',v_count,v_key),
      'Open the affected source records and correct the data integrity violation.',
      'data_quality_check',v_key,null,null,
      jsonb_build_object('rule',v_key,'violationCount',v_count,'cutoffAt',p_cutoff_at)
    );
  end loop;

  v_resolved:=public.ai_ops_autoresolve_deterministic_findings(p_tenant_id,'data_quality',p_run_id,v_observed);
  return jsonb_build_object(
    'sourceItemsTotal',8,'itemsAnalyzed',8,'findingsObserved',v_findings,
    'findingsResolved',v_resolved,'itemsFailed',0,'mode','deterministic','cutoffAt',p_cutoff_at
  );
end;
$function$;

revoke all on function public.ai_ops_evaluate_data_quality_deterministic(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.ai_ops_evaluate_data_quality_deterministic(uuid,uuid,timestamptz) to service_role;

create or replace function public.ai_ops_evaluate_staff_workflow_deterministic(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_rule text;
  v_fp text;
  v_observed text[]:='{}'::text[];
  v_seen integer:=0;
  v_findings integer:=0;
  v_resolved integer:=0;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode='42501';
  end if;

  for v_row in
    select s.id,
      (select count(*)::int from public.crm_tasks t where t.tenant_id=p_tenant_id and t.staff_id=s.id and t.status::text <> 'completed' and t.due_at is not null and t.due_at < p_cutoff_at) as overdue_tasks,
      (select count(*)::int from public.appointments a where a.tenant_id=p_tenant_id and a.staff_id=s.id and a.start_at between p_cutoff_at-interval '30 days' and p_cutoff_at and a.status::text in ('cancelled','late_cancel/noshow','no_show')) as cancellations_30d,
      (select count(*)::int from public.appointments a where a.tenant_id=p_tenant_id and a.staff_id=s.id and a.end_at < p_cutoff_at-interval '2 hours' and a.start_at >= p_cutoff_at-interval '7 days' and a.status::text='scheduled') as stale_scheduled_7d,
      (select count(*)::int from public.appointments a left join public.appointment_clinical_notes n on n.appointment_id=a.id and n.tenant_id=a.tenant_id where a.tenant_id=p_tenant_id and a.staff_id=s.id and a.start_at between p_cutoff_at-interval '7 days' and p_cutoff_at-interval '2 hours' and a.status::text='documented' and n.finalized_at is null) as unfinalized_notes_7d
    from public.staff s
    where s.tenant_id=p_tenant_id and s.prov_status::text='Active'
    order by s.id
  loop
    v_seen:=v_seen+1;
    for v_rule in
      select rule from (values
        (case when v_row.overdue_tasks>0 then 'overdue_assigned_tasks' end),
        (case when v_row.stale_scheduled_7d>0 then 'past_appointments_still_scheduled' end),
        (case when v_row.unfinalized_notes_7d>0 then 'documented_sessions_without_finalized_note' end),
        (case when v_row.cancellations_30d>=3 then 'elevated_cancellation_or_no_show_count' end)
      ) rules(rule)
      where rule is not null
    loop
      v_fp:='det:staff_quality:'||v_rule||':'||v_row.id::text;
      v_observed:=array_append(v_observed,v_fp);
      v_findings:=v_findings+1;
      perform public.ai_ops_upsert_finding(
        p_tenant_id,p_run_id,'staff_quality',v_fp,
        case v_rule
          when 'overdue_assigned_tasks' then 'Staff member has overdue assigned tasks'
          when 'past_appointments_still_scheduled' then 'Staff member has past appointments still marked scheduled'
          when 'documented_sessions_without_finalized_note' then 'Staff member has documented sessions without finalized notes'
          else 'Staff member has three or more cancellations/no-shows in 30 days'
        end,
        case when v_rule in ('past_appointments_still_scheduled','documented_sessions_without_finalized_note')
             then 'high'::public.ai_ops_severity_enum
             else 'medium'::public.ai_ops_severity_enum end,
        case v_rule
          when 'overdue_assigned_tasks' then format('%s assigned task(s) are overdue.',v_row.overdue_tasks)
          when 'past_appointments_still_scheduled' then format('%s appointment(s) from the last 7 days are past but still scheduled.',v_row.stale_scheduled_7d)
          when 'documented_sessions_without_finalized_note' then format('%s documented session(s) from the last 7 days do not have a finalized note.',v_row.unfinalized_notes_7d)
          else format('%s cancellation/no-show appointment(s) occurred in the last 30 days.',v_row.cancellations_30d)
        end,
        'Review the underlying staff workflow records. This is an operational signal, not a judgment of clinical competence.',
        'staff',v_row.id::text,null,null,
        jsonb_build_object(
          'rule',v_rule,'overdueTasks',v_row.overdue_tasks,'pastScheduledLast7Days',v_row.stale_scheduled_7d,
          'documentedWithoutFinalizedNoteLast7Days',v_row.unfinalized_notes_7d,
          'cancellationsOrNoShowsLast30Days',v_row.cancellations_30d,'cutoffAt',p_cutoff_at
        )
      );
    end loop;
  end loop;

  v_resolved:=public.ai_ops_autoresolve_deterministic_findings(p_tenant_id,'staff_quality',p_run_id,v_observed);
  return jsonb_build_object(
    'sourceItemsTotal',v_seen,'itemsAnalyzed',v_seen,'findingsObserved',v_findings,
    'findingsResolved',v_resolved,'itemsFailed',0,'mode','deterministic','cutoffAt',p_cutoff_at
  );
end;
$function$;

revoke all on function public.ai_ops_evaluate_staff_workflow_deterministic(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.ai_ops_evaluate_staff_workflow_deterministic(uuid,uuid,timestamptz) to service_role;

create or replace function public.ai_ops_evaluate_relationship_followup_deterministic(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_rule text;
  v_fp text;
  v_entity_type text;
  v_entity_id text;
  v_observed text[]:='{}'::text[];
  v_seen integer:=0;
  v_findings integer:=0;
  v_resolved integer:=0;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode='42501';
  end if;

  for v_row in
    select * from (
      select 'reply'::text record_type,q.id::text record_id,q.received_at source_at,q.follow_up_due_at due_at,q.status,
             q.organization_id,q.contact_id,q.opportunity_id,q.owner_profile_id
      from public.relationship_reply_queue_v q
      where q.tenant_id=p_tenant_id and q.resolved_at is null
      union all
      select 'opportunity',o.id::text,o.updated_at,o.next_action_due_at,o.status,
             o.organization_id,o.primary_contact_id,o.id,o.owner_profile_id
      from public.relationship_opportunities o
      where o.tenant_id=p_tenant_id and o.closed_at is null and o.next_action_due_at is not null and o.next_action_due_at<=p_cutoff_at
      union all
      select 'contact',c.id::text,c.updated_at,c.next_action_due_at,c.outreach_status,
             null::uuid,c.id,null::uuid,c.owner_profile_id
      from public.relationship_contacts c
      where c.tenant_id=p_tenant_id and not c.do_not_contact and c.next_action_due_at is not null and c.next_action_due_at<=p_cutoff_at
      union all
      select 'organization',o.id::text,o.updated_at,o.next_action_due_at,o.outreach_status,
             o.id,null::uuid,null::uuid,o.owner_profile_id
      from public.relationship_organizations o
      where o.tenant_id=p_tenant_id and not o.do_not_contact and o.next_action_due_at is not null and o.next_action_due_at<=p_cutoff_at
    ) x
    order by due_at nulls last,source_at
  loop
    v_seen:=v_seen+1;
    v_entity_type:=case
      when v_row.opportunity_id is not null then 'relationship_opportunity'
      when v_row.contact_id is not null then 'relationship_contact'
      when v_row.organization_id is not null then 'relationship_organization'
      else 'relationship_'||v_row.record_type end;
    v_entity_id:=coalesce(v_row.opportunity_id::text,v_row.contact_id::text,v_row.organization_id::text,v_row.record_id);

    for v_rule in
      select rule from (values
        (case when v_row.record_type='reply' then 'inbound_reply_needs_review' end),
        (case when v_row.due_at is not null and v_row.due_at<p_cutoff_at then 'followup_overdue' end),
        (case when v_row.due_at is not null and v_row.due_at<p_cutoff_at-interval '3 days' then 'followup_overdue_more_than_3d' end),
        (case when v_row.owner_profile_id is null then 'no_owner_assigned' end)
      ) rules(rule)
      where rule is not null
    loop
      v_fp:='det:relationship_followup:'||v_rule||':'||v_row.record_type||':'||v_row.record_id;
      v_observed:=array_append(v_observed,v_fp);
      v_findings:=v_findings+1;
      perform public.ai_ops_upsert_finding(
        p_tenant_id,p_run_id,'relationship_followup',v_fp,
        case v_rule
          when 'inbound_reply_needs_review' then 'Inbound relationship reply needs review'
          when 'followup_overdue' then 'Relationship follow-up is overdue'
          when 'followup_overdue_more_than_3d' then 'Relationship follow-up is more than 3 days overdue'
          else 'Relationship follow-up item has no owner'
        end,
        case when v_rule='followup_overdue_more_than_3d'
             then 'high'::public.ai_ops_severity_enum
             else 'medium'::public.ai_ops_severity_enum end,
        case when v_row.due_at is not null
          then format('Record type %s has a due time of %s. Current status: %s.',v_row.record_type,v_row.due_at,v_row.status)
          else format('Unresolved inbound relationship reply received at %s.',v_row.source_at) end,
        'Review the relationship record and complete or reassign the outstanding next action.',
        v_entity_type,v_entity_id,null,null,
        jsonb_build_object(
          'rule',v_rule,'recordType',v_row.record_type,'recordId',v_row.record_id,
          'sourceAt',v_row.source_at,'dueAt',v_row.due_at,'status',v_row.status,
          'hasOwner',v_row.owner_profile_id is not null,'cutoffAt',p_cutoff_at
        )
      );
    end loop;
  end loop;

  v_resolved:=public.ai_ops_autoresolve_deterministic_findings(p_tenant_id,'relationship_followup',p_run_id,v_observed);
  return jsonb_build_object(
    'sourceItemsTotal',v_seen,'itemsAnalyzed',v_seen,'findingsObserved',v_findings,
    'findingsResolved',v_resolved,'itemsFailed',0,'mode','deterministic','cutoffAt',p_cutoff_at
  );
end;
$function$;

revoke all on function public.ai_ops_evaluate_relationship_followup_deterministic(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.ai_ops_evaluate_relationship_followup_deterministic(uuid,uuid,timestamptz) to service_role;

create or replace function public.ai_ops_evaluate_client_journey_deterministic(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_exc record;
  v_rule text;
  v_fp text;
  v_observed text[]:='{}'::text[];
  v_seen integer:=0;
  v_findings integer:=0;
  v_resolved integer:=0;
  v_upcoming integer;
  v_recent_cancellations integer;
  v_open_support integer;
  v_appointments_since_at_risk integer;
  v_match_expires timestamptz;
  v_self_schedule boolean;
  v_therapist_no_move boolean;
  v_self_no_move boolean;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode='42501';
  end if;

  for v_row in
    select c.id,c.lifecycle_stage::text lifecycle_stage,c.engagement_state::text engagement_state,
           c.eligibility_state::text eligibility_state,c.care_cadence::text care_cadence,
           c.at_risk,c.at_risk_since,c.primary_staff_id,c.closed_at,c.last_contact_at,c.lifecycle_stage_changed_at
      from public.clients c
     where c.tenant_id=p_tenant_id
       and (coalesce(c.lifecycle_stage::text,'')<>'closed'
            or (c.closed_at is not null and c.closed_at>=p_cutoff_at-interval '24 hours'))
     order by c.id
  loop
    v_seen:=v_seen+1;

    select count(*)::int into v_upcoming
      from public.appointments a
     where a.client_id=v_row.id and a.start_at>p_cutoff_at and a.status::text not in ('cancelled','no_show');

    select count(*)::int into v_recent_cancellations
      from public.appointments a
     where a.client_id=v_row.id
       and a.start_at between p_cutoff_at-interval '30 days' and p_cutoff_at
       and a.status::text in ('cancelled','no_show','late_cancel/noshow');

    select count(*)::int into v_open_support
      from public.client_support_requests r
     where r.client_id=v_row.id and coalesce(r.status,'open') not in ('resolved','closed');

    select m.expires_at into v_match_expires
      from public.client_therapist_matches m
     where m.client_id=v_row.id and m.resolved_at is null
     order by m.created_at desc limit 1;

    select s.prov_self_scheduling_enabled into v_self_schedule
      from public.staff s
     where s.id=v_row.primary_staff_id and s.tenant_id=p_tenant_id
     limit 1;

    select count(*)::int into v_appointments_since_at_risk
      from public.appointments a
     where a.client_id=v_row.id and v_row.at_risk_since is not null and a.created_at>=v_row.at_risk_since;

    v_therapist_no_move := v_row.lifecycle_stage='matched'
      and v_row.lifecycle_stage_changed_at is not null
      and v_row.lifecycle_stage_changed_at<=p_cutoff_at-interval '24 hours'
      and coalesce(v_self_schedule,false)=false
      and not exists(select 1 from public.appointments a where a.client_id=v_row.id and a.created_at>=v_row.lifecycle_stage_changed_at);

    v_self_no_move := v_row.lifecycle_stage='matched'
      and v_row.lifecycle_stage_changed_at is not null
      and v_row.lifecycle_stage_changed_at<=p_cutoff_at-interval '3 days'
      and coalesce(v_self_schedule,false)=true
      and not exists(select 1 from public.appointments a where a.client_id=v_row.id and a.created_at>=v_row.lifecycle_stage_changed_at);

    for v_rule in
      select rule from (values
        (case when v_row.lifecycle_stage='matching' and v_match_expires is not null and v_match_expires<p_cutoff_at then 'therapist_match_expired_unresolved' end),
        (case when v_therapist_no_move then 'therapist_led_scheduling_no_movement_24h' end),
        (case when v_self_no_move then 'self_scheduling_no_movement_3d' end),
        (case when v_row.lifecycle_stage='scheduled' and v_upcoming=0 then 'scheduled_without_future_appointment' end),
        (case when v_row.lifecycle_stage in ('early_care','established_care') and v_row.care_cadence='regular' and v_row.at_risk and v_upcoming=0 then 'regular_care_continuity_at_risk' end),
        (case when v_recent_cancellations>0 and v_upcoming=0 and v_row.lifecycle_stage in ('scheduled','early_care','established_care') then 'cancelled_without_reschedule' end),
        (case when v_recent_cancellations>=2 and v_row.lifecycle_stage in ('scheduled','early_care','established_care') then 'recent_repeated_cancellation_or_no_show' end),
        (case when v_row.lifecycle_stage in ('matched','scheduled','early_care','established_care') and v_row.primary_staff_id is null then 'unassigned_clinician' end),
        (case when v_row.engagement_state in ('unresponsive_warm','unresponsive_cold','went_dark') then 'engagement_state_unresponsive' end),
        (case when v_open_support>0 then 'open_support_request' end),
        (case when v_row.at_risk and v_row.at_risk_since is not null and v_appointments_since_at_risk=0
                    and (v_row.last_contact_at is null or v_row.last_contact_at<v_row.at_risk_since) then 'at_risk_without_recent_progress' end),
        (case when v_row.lifecycle_stage='closed'
                    and (v_open_support>0 or exists(select 1 from public.client_journey_exceptions e
                      where e.tenant_id=p_tenant_id and e.client_id=v_row.id and e.resolution_state in ('open','in_progress')))
               then 'closed_with_unresolved_items' end),
        (case when ((v_row.lifecycle_stage in ('registration','intake','matching') and v_upcoming>0)
                    or (v_row.lifecycle_stage='closed' and v_upcoming>0)) then 'lifecycle_appointment_conflict' end),
        (case when v_row.eligibility_state in ('coverage_issue','manual_review') and v_row.lifecycle_stage<>'closed' then 'eligibility_blocking_progress' end)
      ) rules(rule)
      where rule is not null
    loop
      v_fp:='det:client_journey:'||v_rule||':'||v_row.id::text;
      v_observed:=array_append(v_observed,v_fp);
      v_findings:=v_findings+1;

      perform public.ai_ops_upsert_finding(
        p_tenant_id,p_run_id,'client_journey',v_fp,
        case v_rule
          when 'therapist_match_expired_unresolved' then 'Therapist match expired without resolution'
          when 'therapist_led_scheduling_no_movement_24h' then 'Therapist-led scheduling has had no movement after 24 hours'
          when 'self_scheduling_no_movement_3d' then 'Self-scheduling has had no movement after 3 days'
          when 'scheduled_without_future_appointment' then 'Client is Scheduled but has no future appointment'
          when 'regular_care_continuity_at_risk' then 'Regular-care client is At Risk with no future appointment'
          when 'cancelled_without_reschedule' then 'Client had a cancellation/no-show and has no rescheduled appointment'
          when 'recent_repeated_cancellation_or_no_show' then 'Client has repeated recent cancellations/no-shows'
          when 'unassigned_clinician' then 'Active-care client has no assigned clinician'
          when 'engagement_state_unresponsive' then 'Client engagement state indicates unresponsiveness'
          when 'open_support_request' then 'Client has an unresolved support request'
          when 'at_risk_without_recent_progress' then 'At Risk client has no recent scheduling or contact progress'
          when 'closed_with_unresolved_items' then 'Closed client still has unresolved operational items'
          when 'lifecycle_appointment_conflict' then 'Client lifecycle stage conflicts with appointment state'
          else 'Eligibility state is blocking client progress'
        end,
        case when v_rule in (
          'therapist_led_scheduling_no_movement_24h','scheduled_without_future_appointment',
          'regular_care_continuity_at_risk','unassigned_clinician','lifecycle_appointment_conflict',
          'eligibility_blocking_progress'
        ) then 'high'::public.ai_ops_severity_enum else 'medium'::public.ai_ops_severity_enum end,
        format(
          'Rule %s is true. Lifecycle=%s, engagement=%s, eligibility=%s, future appointments=%s, cancellations/no-shows in 30d=%s, open support requests=%s.',
          v_rule,v_row.lifecycle_stage,v_row.engagement_state,v_row.eligibility_state,
          v_upcoming,v_recent_cancellations,v_open_support
        ),
        'Review the client record and the owning journey exception. Do not change lifecycle state merely to clear this finding.',
        'client',v_row.id::text,null,null,
        jsonb_build_object(
          'rule',v_rule,'lifecycleStage',v_row.lifecycle_stage,'engagementState',v_row.engagement_state,
          'eligibilityState',v_row.eligibility_state,'atRisk',v_row.at_risk,'atRiskSince',v_row.at_risk_since,
          'upcomingAppointments',v_upcoming,'recentCancellationsOrNoShows',v_recent_cancellations,
          'openSupportRequests',v_open_support,'matchExpiresAt',v_match_expires,'cutoffAt',p_cutoff_at
        )
      );
    end loop;

    for v_exc in
      select e.id,e.reason_code,e.category,e.exception_type,e.reason_detail,e.next_action,e.resolution_state,
             e.owner_profile_id,e.review_due_at,e.created_at
      from public.client_journey_exceptions e
      where e.tenant_id=p_tenant_id and e.client_id=v_row.id and e.resolution_state in ('open','in_progress')
    loop
      v_fp:='det:client_journey:source_exception:'||v_exc.id::text;
      v_observed:=array_append(v_observed,v_fp);
      v_findings:=v_findings+1;
      perform public.ai_ops_upsert_finding(
        p_tenant_id,p_run_id,'client_journey',v_fp,
        'Active Client Journey exception: '||coalesce(v_exc.reason_code,v_exc.category,v_exc.exception_type,'unclassified'),
        case when v_exc.review_due_at is not null and v_exc.review_due_at<p_cutoff_at
             then 'high'::public.ai_ops_severity_enum
             else 'medium'::public.ai_ops_severity_enum end,
        format(
          'Source exception is %s. Review due: %s. Owner assigned: %s. Next action: %s',
          v_exc.resolution_state,v_exc.review_due_at,(v_exc.owner_profile_id is not null),coalesce(v_exc.next_action,'not recorded')
        ),
        'Resolve the authoritative Client Journey exception or update its owner, next action, and review date.',
        'client',v_row.id::text,null,v_exc.id,
        jsonb_build_object(
          'rule','active_source_exception','exceptionId',v_exc.id,'reasonCode',v_exc.reason_code,
          'category',v_exc.category,'exceptionType',v_exc.exception_type,'reviewDueAt',v_exc.review_due_at,
          'ownerAssigned',v_exc.owner_profile_id is not null,'createdAt',v_exc.created_at,'cutoffAt',p_cutoff_at
        )
      );
    end loop;
  end loop;

  v_resolved:=public.ai_ops_autoresolve_deterministic_findings(p_tenant_id,'client_journey',p_run_id,v_observed);
  return jsonb_build_object(
    'sourceItemsTotal',v_seen,'clientsChecked',v_seen,'itemsAnalyzed',v_seen,
    'findingsObserved',v_findings,'findingsResolved',v_resolved,'itemsFailed',0,
    'mode','deterministic','modelExecutionEnabled',false,'cutoffAt',p_cutoff_at
  );
end;
$function$;

revoke all on function public.ai_ops_evaluate_client_journey_deterministic(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.ai_ops_evaluate_client_journey_deterministic(uuid,uuid,timestamptz) to service_role;

create or replace function public.ai_ops_evaluate_sop_compliance_deterministic(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_fp text;
  v_violation integer;
  v_observed text[]:='{}'::text[];
  v_controls integer:=0;
  v_findings integer:=0;
  v_resolved integer:=0;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode='42501';
  end if;

  perform public.ai_ops_refresh_sop_observations(p_tenant_id,p_cutoff_at);
  perform public.ai_ops_refresh_clinical_recovery_observation_v1(p_tenant_id,p_cutoff_at);

  for v_row in
    select distinct on (c.control_key)
      c.control_key,c.domain,c.source_doc_name,c.control_text,c.evidence_contract,
      o.observed_at,o.evidence,o.source_reference
    from public.ai_operations_sop_controls c
    join public.ai_operations_sop_observations o
      on o.tenant_id=c.tenant_id and o.control_key=c.control_key
    where c.tenant_id=p_tenant_id and c.enabled
    order by c.control_key,o.observed_at desc
  loop
    v_controls:=v_controls+1;
    if coalesce(v_row.evidence_contract->>'evaluationType','') <> 'deterministic_sql_summary' then
      continue;
    end if;
    v_violation:=coalesce(
      (v_row.evidence->>'violationCount')::int,
      (v_row.evidence->>'staleOver72Hours')::int,
      0
    );
    if v_violation<=0
       and coalesce(v_row.evidence->>'evaluationStatus','') not in ('deviation','violation','failing') then
      continue;
    end if;

    v_fp:='det:sop_compliance:'||v_row.control_key;
    v_observed:=array_append(v_observed,v_fp);
    v_findings:=v_findings+1;
    perform public.ai_ops_upsert_finding(
      p_tenant_id,p_run_id,'sop_compliance',v_fp,
      'SOP control deviation: '||v_row.control_key,
      'high'::public.ai_ops_severity_enum,
      format('%s violation(s) detected for control: %s',v_violation,v_row.control_text),
      'Review the source records identified by the control evidence and correct the owning workflow.',
      'sop_control',v_row.control_key,null,null,
      jsonb_build_object(
        'rule','sop_control_violation','controlKey',v_row.control_key,'domain',v_row.domain,
        'sourceDocument',v_row.source_doc_name,'evidence',v_row.evidence,
        'sourceReference',v_row.source_reference,'observedAt',v_row.observed_at,'cutoffAt',p_cutoff_at
      )
    );
  end loop;

  v_resolved:=public.ai_ops_autoresolve_deterministic_findings(p_tenant_id,'sop_compliance',p_run_id,v_observed);
  return jsonb_build_object(
    'sourceItemsTotal',v_controls,'itemsAnalyzed',v_controls,'findingsObserved',v_findings,
    'findingsResolved',v_resolved,'itemsFailed',0,'mode','deterministic','cutoffAt',p_cutoff_at
  );
end;
$function$;

revoke all on function public.ai_ops_evaluate_sop_compliance_deterministic(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.ai_ops_evaluate_sop_compliance_deterministic(uuid,uuid,timestamptz) to service_role;

create or replace function public.ai_ops_publish_deterministic_daily_summary(
  p_tenant_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_date date;
  v_sections jsonb;
  v_normal jsonb;
  v_coverage jsonb;
  v_open integer;
  v_new integer;
  v_reopened integer;
  v_resolved integer;
  v_high integer;
  v_critical integer;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode='42501';
  end if;

  select business_date into v_date
  from public.ai_operations_runs
  where id=p_run_id and tenant_id=p_tenant_id;

  if v_date is null then
    raise exception 'AI Operations run not found.';
  end if;

  select count(*)::int,
         count(*) filter (where (first_detected_at at time zone 'America/Chicago')::date=v_date)::int,
         count(*) filter (where severity='critical')::int,
         count(*) filter (where severity='high')::int
    into v_open,v_new,v_critical,v_high
    from public.ai_operations_findings
   where tenant_id=p_tenant_id and status='open' and fingerprint like 'det:%';

  select count(*)::int into v_reopened
    from public.ai_operations_finding_events e
    join public.ai_operations_findings f on f.id=e.finding_id
   where e.tenant_id=p_tenant_id and e.event_type='reopened'
     and (e.created_at at time zone 'America/Chicago')::date=v_date
     and f.fingerprint like 'det:%';

  select count(*)::int into v_resolved
    from public.ai_operations_finding_events e
    join public.ai_operations_findings f on f.id=e.finding_id
   where e.tenant_id=p_tenant_id and e.event_type='deterministically_resolved'
     and (e.created_at at time zone 'America/Chicago')::date=v_date
     and f.fingerprint like 'det:%';

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'key',module,
      'heading',module,
      'body',format('%s open deterministic finding(s).',cnt),
      'severity',case when criticals>0 then 'critical' when highs>0 then 'high' when mediums>0 then 'medium' else 'low' end,
      'itemCount',cnt
    ) order by case when criticals>0 then 0 when highs>0 then 1 when mediums>0 then 2 else 3 end,module
  ),'[]'::jsonb)
  into v_sections
  from (
    select module::text module,count(*)::int cnt,
           count(*) filter(where severity='critical')::int criticals,
           count(*) filter(where severity='high')::int highs,
           count(*) filter(where severity='medium')::int mediums
    from public.ai_operations_findings
    where tenant_id=p_tenant_id and status='open' and fingerprint like 'det:%'
    group by module
  ) s;

  select coalesce(jsonb_agg(m.module::text order by m.module::text),'[]'::jsonb)
  into v_normal
  from public.ai_operations_module_runs m
  where m.run_id=p_run_id and m.status='success' and m.model='deterministic'
    and not exists (
      select 1 from public.ai_operations_findings f
      where f.tenant_id=p_tenant_id and f.module=m.module and f.status='open' and f.fingerprint like 'det:%'
    );

  select jsonb_build_object(
    'modules',coalesce(jsonb_agg(
      jsonb_build_object('module',module::text,'status',status::text,'model',model,'coverage',coverage)
      order by module::text
    ),'[]'::jsonb),
    'openDeterministicFindings',v_open,
    'newToday',v_new,
    'reopenedToday',v_reopened,
    'resolvedToday',v_resolved,
    'criticalOpen',v_critical,
    'highOpen',v_high
  )
  into v_coverage
  from public.ai_operations_module_runs
  where run_id=p_run_id;

  insert into public.ai_operations_briefs(
    run_id,tenant_id,business_date,is_partial,status,sections,coverage_manifest,everything_normal,
    generated_at,published_at,email_status,prompt_version,model,updated_at
  ) values (
    p_run_id,p_tenant_id,v_date,false,'published',coalesce(v_sections,'[]'::jsonb),coalesce(v_coverage,'{}'::jsonb),
    coalesce(v_normal,'[]'::jsonb),now(),now(),'not_sent','deterministic-v1','deterministic',now()
  )
  on conflict (tenant_id,business_date) do update set
    run_id=excluded.run_id,
    is_partial=false,
    status='published',
    sections=excluded.sections,
    coverage_manifest=excluded.coverage_manifest,
    everything_normal=excluded.everything_normal,
    generated_at=excluded.generated_at,
    published_at=excluded.published_at,
    email_status='not_sent',
    prompt_version='deterministic-v1',
    model='deterministic',
    updated_at=now();

  update public.ai_operations_runs
  set publication_status='published',updated_at=now()
  where id=p_run_id;

  return jsonb_build_object(
    'status','published','businessDate',v_date,'openFindings',v_open,
    'newToday',v_new,'reopenedToday',v_reopened,'resolvedToday',v_resolved,
    'criticalOpen',v_critical,'highOpen',v_high,'model','deterministic'
  );
end;
$function$;

revoke all on function public.ai_ops_publish_deterministic_daily_summary(uuid,uuid) from public, anon, authenticated;
grant execute on function public.ai_ops_publish_deterministic_daily_summary(uuid,uuid) to service_role;

-- Keep the audit history, but remove legacy AI interpretations from the active Bucket 2 queue.
-- Dismissed means superseded by architecture, not factually resolved.
with superseded as (
  update public.ai_operations_findings f
     set status='dismissed',dismissed_at=now(),updated_at=now()
   where f.module in (
     'client_journey','staff_quality','appointment_integrity','billing_claims',
     'data_quality','relationship_followup','sop_compliance'
   )
     and f.status in ('open','snoozed')
     and f.fingerprint not like 'det:%'
  returning f.id,f.tenant_id
)
insert into public.ai_operations_finding_events(
  finding_id,tenant_id,event_type,actor_kind,reason,new_value
)
select id,tenant_id,'architecture_superseded','system',
       'Superseded by the deterministic Bucket 2 monitoring architecture; this does not assert that the former AI observation was factually resolved.',
       jsonb_build_object('status','dismissed','architecture','deterministic_bucket2_v1')
from superseded;
