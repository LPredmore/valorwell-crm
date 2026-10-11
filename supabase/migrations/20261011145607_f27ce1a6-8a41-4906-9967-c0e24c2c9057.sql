-- BTY pre-interview lifecycle (additive).
alter table public.relationship_opportunities drop constraint relationship_opportunities_status_check;
alter table public.relationship_opportunities add constraint relationship_opportunities_status_check check (status = any (array['identified','researching','qualified','ready_for_campaign','contacted','responded','interested','pre_interview_scheduled','pre_interview_completed','recording_planned','booked','declined','nurture','disqualified','completed']::text[]));
alter table public.relationship_opportunity_status_history drop constraint relationship_opportunity_status_history_from_check;
alter table public.relationship_opportunity_status_history add constraint relationship_opportunity_status_history_from_check check (from_status is null or from_status = any (array['identified','researching','qualified','ready_for_campaign','contacted','responded','interested','pre_interview_scheduled','pre_interview_completed','recording_planned','booked','declined','nurture','disqualified','completed']::text[]));
alter table public.relationship_opportunity_status_history drop constraint relationship_opportunity_status_history_to_check;
alter table public.relationship_opportunity_status_history add constraint relationship_opportunity_status_history_to_check check (to_status = any (array['identified','researching','qualified','ready_for_campaign','contacted','responded','interested','pre_interview_scheduled','pre_interview_completed','recording_planned','booked','declined','nurture','disqualified','completed']::text[]));
alter table public.relationship_activity_events drop constraint relationship_activity_events_type_check;
alter table public.relationship_activity_events add constraint relationship_activity_events_type_check check (activity_type = any (array['opportunity_ready_for_campaign','campaign_auto_enrolled','outreach_sent','human_reply_received','automated_reply_received','manual_outbound_email','interest_confirmed','scheduling_started','recording_booked','recording_rescheduled','recording_cancelled','recording_completed','declined','nurture_set','legacy_reconciliation','preinterview_booked','preinterview_rescheduled','preinterview_cancelled']::text[]));

create or replace function private.relationship_opportunity_status_transition_allowed(p_from_status text, p_to_status text)
returns boolean language sql immutable strict set search_path to '' as $$
  select case p_from_status
    when 'identified' then p_to_status = any (array['researching','qualified','nurture','disqualified']::text[])
    when 'researching' then p_to_status = any (array['qualified','nurture','disqualified']::text[])
    when 'qualified' then p_to_status = any (array['ready_for_campaign','contacted','nurture','disqualified']::text[])
    when 'ready_for_campaign' then p_to_status = any (array['contacted','nurture','disqualified']::text[])
    when 'contacted' then p_to_status = any (array['responded','nurture','declined','disqualified']::text[])
    when 'responded' then p_to_status = any (array['interested','nurture','declined']::text[])
    when 'interested' then p_to_status = any (array['pre_interview_scheduled','recording_planned','booked','nurture','declined']::text[])
    when 'pre_interview_scheduled' then p_to_status = any (array['pre_interview_completed','interested','booked','nurture','declined']::text[])
    when 'pre_interview_completed' then p_to_status = any (array['recording_planned','booked','nurture','declined']::text[])
    when 'recording_planned' then p_to_status = any (array['booked','nurture','declined']::text[])
    when 'booked' then p_to_status = any (array['completed','nurture','declined']::text[])
    when 'nurture' then p_to_status = any (array['researching','qualified','contacted','responded','interested','pre_interview_scheduled','disqualified']::text[])
    when 'declined' then p_to_status = any (array['nurture','researching']::text[])
    when 'disqualified' then p_to_status = 'identified'
    when 'completed' then p_to_status = 'nurture'
    else false
  end;
$$;

-- Surgical, idempotent status-list updates inside existing functions (bodies otherwise unchanged).
do $$
declare r record; v_def text; v_new text;
begin
  for r in select p.oid, n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname,p.proname) in (('private','transition_relationship_opportunity_status'),('private','evaluate_relationship_import_normalized'),
      ('private','evaluate_relationship_safety_values'),('public','list_relationship_orchestration_integrity'),('private','apply_relationship_activity'))
  loop
    v_def:=pg_get_functiondef(r.oid);
    if position('pre_interview_scheduled' in v_def)>0 then continue; end if;
    v_new:=replace(v_def,'''interested'',''recording_planned''','''interested'',''pre_interview_scheduled'',''pre_interview_completed'',''recording_planned''');
    if r.proname='apply_relationship_activity' then
      v_new:=replace(v_new,'''responded'',''interested'']::text[]) then ''recording_planned''','''responded'',''interested'',''pre_interview_completed'']::text[]) then ''recording_planned''');
      v_new:=replace(v_new,'when ''recording_booked'' then case',
        'when ''preinterview_booked'' then case when v_opportunity.status=any(array[''contacted'',''responded'',''interested'',''nurture'']::text[]) then ''pre_interview_scheduled'' end
    when ''preinterview_rescheduled'' then case when v_opportunity.status=any(array[''contacted'',''responded'',''interested'',''nurture'']::text[]) then ''pre_interview_scheduled'' end
    when ''preinterview_cancelled'' then case when v_opportunity.status=''pre_interview_scheduled'' then ''interested'' end
    when ''recording_booked'' then case');
      if position('preinterview_cancelled' in v_new)=0 or position('''pre_interview_completed'']::text[]) then ''recording_planned''' in v_new)=0 then
        raise exception 'apply_relationship_activity shape changed; refusing partial update';
      end if;
    end if;
    if v_new=v_def then raise exception 'Expected status list not found in %.%', r.nspname, r.proname; end if;
    execute v_new;
  end loop;
end $$;

create or replace function public.ingest_relationship_calendar_event(p_tenant_id uuid, p_connection_id uuid, p_calendar_id text, p_external_event_id text, p_ical_uid text, p_event_status text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_attendee_emails text[], p_streamyard_url text, p_summary text, p_updated_at timestamp with time zone, p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_meeting public.relationship_meetings%rowtype;
  v_old_start timestamptz;
  v_candidates uuid[];
  v_opportunity public.relationship_opportunities%rowtype;
  v_activity_type text;
  v_activity jsonb;
  v_purpose text;
  v_emails text[]:=array(select lower(btrim(x)) from unnest(coalesce(p_attendee_emails,'{}'::text[])) x);
begin
  if not private.relationship_flag_enabled(p_tenant_id,'relationship_calendar_observation_enabled') then
    return jsonb_build_object('observed',false,'reason','relationship_calendar_observation_disabled');
  end if;
  if p_event_status<>all(array['confirmed','tentative','cancelled']::text[]) then
    return jsonb_build_object('observed',false,'reason','unsupported_event_status');
  end if;
  select * into v_meeting from public.relationship_meetings
  where tenant_id=p_tenant_id and calendar_id=p_calendar_id and external_event_id=p_external_event_id
  for update;
  if found then
    v_old_start:=v_meeting.starts_at;
    update public.relationship_meetings set ical_uid=coalesce(p_ical_uid,ical_uid),
      starts_at=p_starts_at,ends_at=p_ends_at,event_status=p_event_status,last_synced_at=now(),
      metadata=coalesce(p_metadata,'{}'::jsonb),updated_at=now()
    where id=v_meeting.id returning * into v_meeting;
    if v_meeting.purpose='bty_preinterview' then
      v_activity_type:=case when p_event_status='cancelled' then 'preinterview_cancelled'
        when v_old_start is distinct from p_starts_at then 'preinterview_rescheduled' else 'preinterview_booked' end;
    else
      v_activity_type:=case when p_event_status='cancelled' then 'recording_cancelled'
        when v_old_start is distinct from p_starts_at then 'recording_rescheduled' else 'recording_booked' end;
    end if;
  else
    if p_event_status='cancelled' then
      return jsonb_build_object('observed',false,'reason','unlinked_cancelled_event');
    end if;
    v_purpose:=case when p_streamyard_url='https://streamyard.com/frr4zf8e3s' then 'bty_recording'
      when coalesce(p_metadata->>'bty_classification','')='bty_preinterview' then 'bty_preinterview' end;
    if v_purpose is null then
      return jsonb_build_object('observed',false,'reason','streamyard_room_not_present');
    end if;
    if v_purpose='bty_recording' then
      select array_agg(distinct o.id order by o.id) into v_candidates
      from public.relationship_opportunities o
      join public.relationship_contacts c on c.tenant_id=o.tenant_id and c.id=o.primary_contact_id
      where o.tenant_id=p_tenant_id and lower(c.email)=any(v_emails)
        and o.status<>all(array['completed','declined','disqualified']::text[]);
    else
      -- Strongest evidence first: the verified intro event id recorded on the opportunity.
      select array_agg(distinct o.id order by o.id) into v_candidates
      from public.relationship_opportunities o
      where o.tenant_id=p_tenant_id and o.metadata->'bty_intro'->>'event_id'=p_external_event_id
        and o.status<>all(array['completed','declined','disqualified']::text[]);
      if coalesce(cardinality(v_candidates),0)=0 then
        select array_agg(distinct o.id order by o.id) into v_candidates
        from public.relationship_opportunities o
        join public.relationship_contacts c on c.tenant_id=o.tenant_id and c.id=o.primary_contact_id
        where o.tenant_id=p_tenant_id and lower(c.email)=any(v_emails)
          and o.status=any(array['contacted','responded','interested','nurture','pre_interview_scheduled']::text[]);
      end if;
    end if;
    if coalesce(cardinality(v_candidates),0)<>1 then
      if coalesce(cardinality(v_candidates),0)>1 or v_purpose='bty_preinterview' then
        perform private.open_relationship_reconciliation_issue(
          p_tenant_id,'ambiguous_calendar_event','google_calendar',
          case when coalesce(cardinality(v_candidates),0)>1
            then format('%s Calendar event matched more than one viable BTY opportunity.',case when v_purpose='bty_preinterview' then 'Pre-interview' else 'StreamYard' end)
            else 'Pre-interview Calendar event did not match any BTY opportunity. Review before creating one.' end,
          p_external_event_id,null,null,jsonb_build_object('calendar_id',p_calendar_id,'purpose',v_purpose,
            'candidate_opportunity_ids',to_jsonb(coalesce(v_candidates,'{}'::uuid[])),'summary',left(coalesce(p_summary,''),500),
            'starts_at',p_starts_at,'attendee_emails',to_jsonb(v_emails))
        );
      end if;
      return jsonb_build_object('observed',false,'matched',false,'purpose',v_purpose,'ambiguous',coalesce(cardinality(v_candidates),0)>1);
    end if;
    select * into v_opportunity from public.relationship_opportunities where id=v_candidates[1];
    if v_purpose='bty_preinterview' and exists(select 1 from public.relationship_meetings m
      where m.tenant_id=p_tenant_id and m.organization_id=v_opportunity.organization_id and m.purpose='bty_preinterview'
        and m.event_status=any(array['confirmed','tentative']::text[])) then
      perform private.open_relationship_reconciliation_issue(
        p_tenant_id,'ambiguous_calendar_event','google_calendar',
        'A second active pre-interview event was found for an organization that already has one.',
        p_external_event_id,v_opportunity.id,null,jsonb_build_object('calendar_id',p_calendar_id,'summary',left(coalesce(p_summary,''),500),'starts_at',p_starts_at));
      return jsonb_build_object('observed',false,'matched',true,'reason','duplicate_active_preinterview');
    end if;
    insert into public.relationship_meetings(
      tenant_id,opportunity_id,organization_id,contact_id,purpose,connection_id,calendar_id,
      external_event_id,ical_uid,starts_at,ends_at,event_status,streamyard_url,last_synced_at,metadata
    ) values (
      p_tenant_id,v_opportunity.id,v_opportunity.organization_id,v_opportunity.primary_contact_id,
      v_purpose,p_connection_id,p_calendar_id,p_external_event_id,p_ical_uid,p_starts_at,p_ends_at,
      p_event_status,case when v_purpose='bty_recording' then 'https://streamyard.com/frr4zf8e3s' end,now(),coalesce(p_metadata,'{}'::jsonb)
    ) returning * into v_meeting;
    v_activity_type:=case when v_purpose='bty_preinterview' then 'preinterview_booked' else 'recording_booked' end;
  end if;
  v_activity:=private.apply_relationship_activity(
    p_tenant_id,v_activity_type,'google_calendar',
    format('calendar:%s:%s:%s',p_calendar_id,p_external_event_id,coalesce(p_updated_at,now())),
    p_external_event_id,v_meeting.organization_id,v_meeting.contact_id,v_meeting.opportunity_id,
    null,null,null,coalesce(p_updated_at,now()),
    jsonb_build_object('meeting_id',v_meeting.id,'calendar_id',p_calendar_id,'purpose',v_meeting.purpose,
      'external_event_id',p_external_event_id,'starts_at',p_starts_at,'event_status',p_event_status),null
  );
  return jsonb_build_object('observed',true,'matched',true,'meetingId',v_meeting.id,'purpose',v_meeting.purpose,
    'activityType',v_activity_type,'activity',v_activity);
end;
$function$;

-- Connected BTY pipeline board stages (idempotent).
do $$
declare v_pipeline uuid:='47b4a6ab-da71-414b-9d50-e70d20f23198'; v_tenant uuid; v_pos int;
begin
  select tenant_id into v_tenant from public.crm_pipelines where id=v_pipeline;
  if v_tenant is null then return; end if;
  if exists(select 1 from public.crm_pipeline_stages where pipeline_id=v_pipeline and source_stage_key='pre_interview_scheduled') then return; end if;
  select position into v_pos from public.crm_pipeline_stages where pipeline_id=v_pipeline and source_stage_key='interested';
  update public.crm_pipeline_stages set position=position+1000 where pipeline_id=v_pipeline and position>v_pos;
  update public.crm_pipeline_stages set position=position-998 where pipeline_id=v_pipeline and position>v_pos+1000-1;
  insert into public.crm_pipeline_stages(tenant_id,pipeline_id,name,position,source_stage_key,is_terminal) values
    (v_tenant,v_pipeline,'Pre-Interview Scheduled',v_pos+1,'pre_interview_scheduled',false),
    (v_tenant,v_pipeline,'Pre-Interview Completed',v_pos+2,'pre_interview_completed',false);
end $$;