-- Reuse the existing CRM activity-event vocabulary instead of widening the event-type contract.

create or replace function private.crm_stop_client_campaigns_on_lifecycle_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_enrollment record; v_count integer := 0;
begin
  if new.state_dimension::text <> 'lifecycle_stage'
     or coalesce(new.source, '') = 'migration_backfill'
     or new.old_status is not distinct from new.new_status then return new; end if;

  for v_enrollment in
    select e.id, e.campaign_id, e.status from public.crm_campaign_enrollments e
    where e.tenant_id = new.tenant_id and e.client_id = new.client_id and e.status in ('active','paused') for update
  loop
    update public.crm_campaign_step_logs
    set status='skipped', skip_reason='lifecycle_changed', claimed_at=null, claim_token=null, updated_at=clock_timestamp()
    where enrollment_id=v_enrollment.id and status in ('scheduled','processing');

    update public.crm_campaign_enrollments
    set status='cancelled', completed_at=coalesce(completed_at,new.changed_at,clock_timestamp()),
        paused_at=coalesce(paused_at,new.changed_at,clock_timestamp()), pause_reason='lifecycle_changed', updated_at=clock_timestamp()
    where id=v_enrollment.id;
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    insert into public.crm_activity_events (tenant_id,client_id,event_type,old_value,new_value,metadata)
    values(new.tenant_id,new.client_id,'campaign_auto_cancelled',new.old_status,new.new_status,
      jsonb_build_object('triggered_by','lifecycle_change','stopped_enrollments',v_count,'source',new.source,'reason',new.reason));
  end if;
  return new;
end;
$function$;

create or replace function private.crm_handle_client_campaign_response(
  p_tenant_id uuid,p_client_id uuid,p_channel text,p_received_at timestamptz,p_correlation_id text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_enrollment_ids uuid[] := '{}'::uuid[];
  v_campaign_id uuid;
  v_creator uuid;
  v_stopped integer := 0;
  v_task_id uuid;
  v_previous_context jsonb;
  v_current_engagement public.client_engagement_state_enum;
  v_received_at timestamptz := coalesce(p_received_at,clock_timestamp());
  v_channel text := lower(btrim(coalesce(p_channel,'')));
begin
  if v_channel not in ('email','sms') then raise exception 'Unsupported campaign response channel: %',p_channel using errcode='22023'; end if;
  if not exists(select 1 from public.clients c where c.id=p_client_id and c.tenant_id=p_tenant_id) then
    return jsonb_build_object('handled',false,'reason','client_not_found');
  end if;

  select coalesce(array_agg(e.id order by e.enrolled_at),'{}'::uuid[]),
         (array_agg(e.campaign_id order by e.enrolled_at desc))[1],
         (array_agg(c.created_by_profile_id order by e.enrolled_at desc))[1]
  into v_enrollment_ids,v_campaign_id,v_creator
  from public.crm_campaign_enrollments e
  join public.crm_campaigns c on c.id=e.campaign_id and c.tenant_id=e.tenant_id
  where e.tenant_id=p_tenant_id and e.client_id=p_client_id and e.status in ('active','paused');

  v_stopped := coalesce(cardinality(v_enrollment_ids),0);
  if v_stopped=0 then return jsonb_build_object('handled',false,'reason','no_open_campaign'); end if;

  update public.crm_campaign_step_logs
  set status='skipped',skip_reason='client_responded',claimed_at=null,claim_token=null,updated_at=clock_timestamp()
  where enrollment_id=any(v_enrollment_ids) and status in ('scheduled','processing');

  update public.crm_campaign_enrollments
  set status='responded',completed_at=coalesce(completed_at,v_received_at),paused_at=coalesce(paused_at,v_received_at),
      pause_reason=v_channel||'_response',updated_at=clock_timestamp()
  where id=any(v_enrollment_ids) and status in ('active','paused');

  select c.engagement_state into v_current_engagement
  from public.clients c where c.id=p_client_id and c.tenant_id=p_tenant_id for update;

  if v_current_engagement is distinct from 'normal'::public.client_engagement_state_enum then
    v_previous_context := public.client_state_engine_begin_context(
      'campaign_response',format('Inbound %s response stopped automated client campaign messaging.',v_channel),null);
    begin
      update public.clients set engagement_state='normal'::public.client_engagement_state_enum
      where id=p_client_id and tenant_id=p_tenant_id;
      perform public.client_state_engine_restore_context(v_previous_context);
    exception when others then
      perform public.client_state_engine_restore_context(v_previous_context);
      raise;
    end;
  end if;

  select t.id into v_task_id
  from public.crm_tasks t
  where t.tenant_id=p_tenant_id and t.client_id=p_client_id
    and t.type='client_follow_up'::public.crm_task_type_enum
    and t.status in ('not_started','in_progress','waiting','blocked')
    and 'personalized-response-required'=any(t.tags)
  order by t.created_at desc limit 1;

  if v_creator is null then
    select cap.profile_id into v_creator from public.crm_user_capabilities cap
    where cap.tenant_id=p_tenant_id and cap.crm_role::text in ('crm_admin','crm_operator')
    order by case cap.crm_role::text when 'crm_admin' then 0 else 1 end,cap.granted_at limit 1;
  end if;

  if v_task_id is null and v_creator is not null then
    insert into public.crm_tasks (
      tenant_id,title,description,client_id,campaign_id,type,priority,status,created_by_profile_id,start_at,due_at,tags
    ) values (
      p_tenant_id,'Needs Personalized Response',
      format('Client sent an inbound %s while enrolled in an automated campaign. Automated campaign messaging was stopped. A personalized response is required.',upper(v_channel)),
      p_client_id,v_campaign_id,'client_follow_up'::public.crm_task_type_enum,'high'::public.crm_task_priority_enum,
      'not_started'::public.crm_task_status_enum,v_creator,v_received_at,v_received_at+interval '1 day',
      array['campaign-response','personalized-response-required',v_channel]::text[]
    ) returning id into v_task_id;
  elsif v_task_id is not null then
    update public.crm_tasks
    set campaign_id=coalesce(campaign_id,v_campaign_id),priority='high'::public.crm_task_priority_enum,updated_at=clock_timestamp()
    where id=v_task_id;
  end if;

  insert into public.crm_activity_events (tenant_id,client_id,event_type,metadata)
  values(p_tenant_id,p_client_id,'campaign_enrollment_responded',jsonb_build_object(
    'source','inbound_campaign_response','channel',v_channel,'correlation_id',p_correlation_id,
    'stopped_enrollments',v_stopped,'campaign_id',v_campaign_id,'task_id',v_task_id));

  perform public.trg_enqueue_clickup_sync(p_client_id);
  return jsonb_build_object('handled',true,'stoppedEnrollments',v_stopped,'taskId',v_task_id,'engagementState','normal');
end;
$function$;

create or replace function private.crm_apply_client_campaign_completion()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_step public.crm_campaign_steps%rowtype;
  v_enrollment public.crm_campaign_enrollments%rowtype;
  v_campaign public.crm_campaigns%rowtype;
  v_client public.clients%rowtype;
  v_previous_context jsonb;
begin
  if new.status<>'sent' or old.status is not distinct from new.status then return new; end if;

  select * into v_step from public.crm_campaign_steps where id=new.step_id;
  if not found then return new; end if;

  select * into v_enrollment from public.crm_campaign_enrollments where id=new.enrollment_id for update;
  if not found or v_enrollment.status<>'active' then return new; end if;

  if exists(
    select 1 from public.crm_campaign_steps s
    where s.campaign_id=v_enrollment.campaign_id and s.is_active and s.step_order>v_step.step_order
  ) then return new; end if;

  select * into v_campaign from public.crm_campaigns
  where id=v_enrollment.campaign_id and tenant_id=v_enrollment.tenant_id;
  if not found then return new; end if;

  select * into v_client from public.clients
  where id=v_enrollment.client_id and tenant_id=v_enrollment.tenant_id for update;
  if not found then return new; end if;

  update public.crm_campaign_enrollments
  set status='completed',completed_at=coalesce(completed_at,new.sent_at,clock_timestamp()),
      current_step=v_step.step_order,updated_at=clock_timestamp()
  where id=v_enrollment.id and status='active';

  if v_campaign.on_complete_engagement_state is not null
     and v_client.engagement_state is distinct from v_campaign.on_complete_engagement_state then
    v_previous_context := public.client_state_engine_begin_context(
      'engagement_workflow',format('Campaign %s completed all automated steps.',v_campaign.name),v_campaign.created_by_profile_id);
    begin
      update public.clients set engagement_state=v_campaign.on_complete_engagement_state
      where id=v_client.id and tenant_id=v_client.tenant_id;
      perform public.client_state_engine_restore_context(v_previous_context);
    exception when others then
      perform public.client_state_engine_restore_context(v_previous_context);
      raise;
    end;
  end if;

  if v_campaign.on_complete_lifecycle_stage is not null
     and v_client.lifecycle_stage is distinct from v_campaign.on_complete_lifecycle_stage then
    insert into public.crm_activity_events (tenant_id,client_id,event_type,metadata)
    values(v_client.tenant_id,v_client.id,'campaign_completion_state_action_deferred',jsonb_build_object(
      'campaign_id',v_campaign.id,'configured_lifecycle',v_campaign.on_complete_lifecycle_stage::text,
      'current_lifecycle',v_client.lifecycle_stage::text,
      'reason','Canonical lifecycle progression requires the underlying workflow event.'));
  end if;

  perform public.trg_enqueue_clickup_sync(v_client.id);
  return new;
end;
$function$;
