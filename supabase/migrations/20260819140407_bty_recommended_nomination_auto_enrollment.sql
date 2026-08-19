create table if not exists private.relationship_bty_recommended_nomination_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  campaign_id uuid not null,
  event_key text not null,
  source text not null,
  nominated_at timestamptz not null,
  organization_id uuid,
  contact_id uuid,
  source_entity_type text,
  source_entity_id text,
  status text not null default 'waiting_for_details' check (status in ('waiting_for_details','waiting_campaign','enrolled','blocked','error')),
  enrollment_id uuid,
  last_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,campaign_id,event_key)
);
alter table private.relationship_bty_recommended_nomination_events enable row level security;
revoke all on private.relationship_bty_recommended_nomination_events from anon,authenticated;
grant select,insert,update on private.relationship_bty_recommended_nomination_events to service_role;
create index if not exists relationship_bty_recommended_nomination_waiting_org_idx on private.relationship_bty_recommended_nomination_events(tenant_id,organization_id,nominated_at) where status in ('waiting_for_details','waiting_campaign');
create index if not exists relationship_bty_recommended_nomination_waiting_contact_idx on private.relationship_bty_recommended_nomination_events(tenant_id,contact_id,nominated_at) where status in ('waiting_for_details','waiting_campaign');

create or replace function private.try_auto_enroll_bty_recommended_event(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  ev private.relationship_bty_recommended_nomination_events%rowtype;
  camp public.relationship_campaigns%rowtype;
  org public.relationship_organizations%rowtype;
  con public.relationship_contacts%rowtype;
  step public.relationship_campaign_steps%rowtype;
  cutoff timestamptz; cid uuid; n integer; existing uuid; eval jsonb; reasons text[]:='{}';
  due timestamptz; enrollment uuid; source_mode text:='research'; source_kind text:='internal';
  ref public.relationship_referrals%rowtype; refid uuid; already boolean:=false;
begin
  select * into ev from private.relationship_bty_recommended_nomination_events where id=p_event_id for update;
  if not found then return jsonb_build_object('handled',false,'reason','event_not_found'); end if;
  if ev.status in ('enrolled','blocked') then return jsonb_build_object('handled',true,'status',ev.status,'enrollmentId',ev.enrollment_id); end if;
  select * into camp from public.relationship_campaigns c where c.tenant_id=ev.tenant_id and c.id=ev.campaign_id and c.source_record_key='bty_recommended_organization_outreach_v1';
  if not found then update private.relationship_bty_recommended_nomination_events set status='error',last_reason='recommended_campaign_not_found',updated_at=now() where id=ev.id; return jsonb_build_object('handled',false,'status','error'); end if;
  begin cutoff:=nullif(camp.metadata->>'autoEnrollmentStartedAt','')::timestamptz; exception when others then cutoff:=null; end;
  if cutoff is null or ev.nominated_at<cutoff then update private.relationship_bty_recommended_nomination_events set status='blocked',last_reason='pre_activation_nomination',updated_at=now() where id=ev.id; return jsonb_build_object('handled',true,'status','blocked','reason','pre_activation_nomination'); end if;
  if camp.status<>'active' or not camp.execution_enabled or coalesce((camp.metadata->>'autoEnrollmentEnabled')::boolean,false) is not true then update private.relationship_bty_recommended_nomination_events set status='waiting_campaign',last_reason='campaign_not_execution_enabled',updated_at=now() where id=ev.id; return jsonb_build_object('handled',true,'status','waiting_campaign'); end if;

  if ev.organization_id is null and ev.contact_id is not null then select l.organization_id into ev.organization_id from public.relationship_contact_organizations l where l.tenant_id=ev.tenant_id and l.contact_id=ev.contact_id order by l.is_primary desc,l.updated_at desc,l.organization_id limit 1; end if;
  if ev.organization_id is null then update private.relationship_bty_recommended_nomination_events set status='waiting_for_details',last_reason='organization_required',updated_at=now() where id=ev.id; return jsonb_build_object('handled',true,'status','waiting_for_details','reason','organization_required'); end if;
  select * into org from public.relationship_organizations o where o.tenant_id=ev.tenant_id and o.id=ev.organization_id;
  if not found or nullif(btrim(org.name),'') is null then update private.relationship_bty_recommended_nomination_events set status='waiting_for_details',organization_id=ev.organization_id,last_reason='organization_name_required',updated_at=now() where id=ev.id; return jsonb_build_object('handled',true,'status','waiting_for_details','reason','organization_name_required'); end if;

  cid:=null;
  if ev.contact_id is not null and exists(select 1 from public.relationship_contact_organizations l where l.tenant_id=ev.tenant_id and l.organization_id=ev.organization_id and l.contact_id=ev.contact_id) then cid:=ev.contact_id; end if;
  if cid is null then
    select count(*),(array_agg(c.id order by c.id))[1] into n,cid from public.relationship_contact_organizations l join public.relationship_contacts c on c.tenant_id=l.tenant_id and c.id=l.contact_id where l.tenant_id=ev.tenant_id and l.organization_id=ev.organization_id and l.is_primary and nullif(btrim(c.first_name),'') is not null and nullif(btrim(c.email),'') is not null;
    if n<>1 then select count(*),(array_agg(c.id order by c.id))[1] into n,cid from public.relationship_contact_organizations l join public.relationship_contacts c on c.tenant_id=l.tenant_id and c.id=l.contact_id where l.tenant_id=ev.tenant_id and l.organization_id=ev.organization_id and nullif(btrim(c.first_name),'') is not null and nullif(btrim(c.email),'') is not null; if n<>1 then cid:=null; end if; end if;
  end if;
  if cid is null then update private.relationship_bty_recommended_nomination_events set status='waiting_for_details',organization_id=ev.organization_id,last_reason='complete_contact_required',updated_at=now() where id=ev.id; return jsonb_build_object('handled',true,'status','waiting_for_details','reason','complete_contact_required'); end if;
  select * into con from public.relationship_contacts c where c.tenant_id=ev.tenant_id and c.id=cid;
  if not found or nullif(btrim(con.first_name),'') is null or nullif(btrim(con.email),'') is null then update private.relationship_bty_recommended_nomination_events set status='waiting_for_details',organization_id=ev.organization_id,contact_id=cid,last_reason='contact_name_and_email_required',updated_at=now() where id=ev.id; return jsonb_build_object('handled',true,'status','waiting_for_details','reason','contact_name_and_email_required'); end if;

  already:=coalesce((con.metadata->>'btyNominationOutreachSent')::boolean,false) or coalesce((org.metadata->>'btyNominationOutreachSent')::boolean,false);
  if not already then select exists(select 1 from public.relationship_communications comm join public.relationship_campaigns prior on prior.tenant_id=comm.tenant_id and prior.id=comm.campaign_id where comm.tenant_id=ev.tenant_id and comm.direction='outbound' and comm.status in ('sent','delivered') and comm.sent_at is not null and coalesce((prior.metadata->>'btyNominationOutreach')::boolean,false) and (comm.contact_id=cid or comm.organization_id=ev.organization_id)) into already; end if;
  if already then update private.relationship_bty_recommended_nomination_events set status='blocked',organization_id=ev.organization_id,contact_id=cid,last_reason='nomination_outreach_already_sent',updated_at=now() where id=ev.id; return jsonb_build_object('handled',true,'status','blocked','reason','nomination_outreach_already_sent'); end if;

  select e.id into existing from public.relationship_campaign_enrollments e where e.tenant_id=ev.tenant_id and e.campaign_id=camp.id and (e.contact_id=cid or e.organization_id=ev.organization_id) order by e.created_at desc limit 1;
  if existing is not null then update private.relationship_bty_recommended_nomination_events set status='enrolled',organization_id=ev.organization_id,contact_id=cid,enrollment_id=existing,last_reason='existing_campaign_enrollment',updated_at=now() where id=ev.id; return jsonb_build_object('handled',true,'status','enrolled','enrollmentId',existing,'replayed',true); end if;

  select r.* into ref from public.relationship_referrals r where r.tenant_id=ev.tenant_id and r.verified and r.revoked_at is null and regexp_replace(lower(btrim(r.source_category)),'[^a-z0-9]+','_','g')='client_nomination' and ((r.organization_id is not null and r.organization_id=ev.organization_id) or (r.contact_id is not null and r.contact_id=cid)) order by r.verified_at desc nulls last,r.created_at desc limit 1;
  if found then refid:=ref.id; if ref.disclosure='named_referrer' and nullif(btrim(ref.named_referrer),'') is not null then source_mode:='verified_named'; else source_mode:='verified_anonymous'; end if; source_kind:='client'; elsif lower(ev.source) like '%website%' then source_mode:='community'; source_kind:='website'; end if;

  eval:=private.evaluate_relationship_campaign_target(ev.tenant_id,camp.id,jsonb_strip_nulls(jsonb_build_object('contactId',cid,'organizationId',ev.organization_id,'sourceLanguageMode',source_mode,'verifiedReferralId',refid)));
  if coalesce((eval->>'eligible')::boolean,false) is not true then
    select coalesce(array_agg(value),'{}'::text[]) into reasons from jsonb_array_elements_text(coalesce(eval->'reasons','[]'::jsonb));
    update private.relationship_bty_recommended_nomination_events set status=case when reasons && array['missing_email','recipient_contact_required','recipient_contact_ambiguous','contact_not_linked_to_organization']::text[] then 'waiting_for_details' else 'blocked' end,organization_id=ev.organization_id,contact_id=cid,last_reason=array_to_string(reasons,','),updated_at=now() where id=ev.id;
    return jsonb_build_object('handled',true,'status',case when reasons && array['missing_email','recipient_contact_required','recipient_contact_ambiguous','contact_not_linked_to_organization']::text[] then 'waiting_for_details' else 'blocked' end,'reasons',to_jsonb(reasons));
  end if;

  select * into step from public.relationship_campaign_steps s where s.tenant_id=ev.tenant_id and s.campaign_id=camp.id and s.is_active order by s.position limit 1;
  if not found then update private.relationship_bty_recommended_nomination_events set status='waiting_campaign',last_reason='no_active_campaign_step',updated_at=now() where id=ev.id; return jsonb_build_object('handled',true,'status','waiting_campaign'); end if;
  due:=private.relationship_campaign_schedule_at(now(),camp.default_timezone,camp.weekdays_only,camp.send_window_start,camp.send_window_end,step.delay_days);
  perform set_config('app.relationship_delivery_activation','allowed',true);
  begin
    insert into public.relationship_campaign_enrollments(tenant_id,campaign_id,contact_id,organization_id,opportunity_id,recipient_email,recipient_name,status,current_step_position,next_scheduled_at,source_language_mode,personalization_context,eligibility_snapshot,safety_status,delivery_enabled,metadata)
    values(ev.tenant_id,camp.id,cid,ev.organization_id,null,lower(btrim(con.email)),nullif(btrim(concat_ws(' ',con.first_name,con.last_name)),''),'pending',step.position,due,source_mode,coalesce(eval->'personalizationContext','{}'::jsonb)||jsonb_build_object('nominationSource',source_kind,'nominationEventId',ev.id::text),eval,'pending_pass_11',true,jsonb_build_object('autoEnrollment',true,'nominationEventId',ev.id,'policy','new_nomination_event_v1')) returning id into enrollment;
    insert into private.relationship_campaign_work_items(tenant_id,campaign_id,enrollment_id,campaign_step_id,step_position,status,due_at,available_at,idempotency_key,metadata) values(ev.tenant_id,camp.id,enrollment,step.id,step.position,'planned',due,due,format('enrollment:%s:step:%s',enrollment,step.id),jsonb_build_object('autoEnrollment',true,'nominationEventId',ev.id));
    insert into public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,to_status,reason,metadata) values(ev.tenant_id,enrollment,'enrolled','pending','New post-activation BTY recommendation automatically enrolled after organization and contact details became complete.',jsonb_build_object('nominationEventId',ev.id,'delivery_enabled',true,'policy','new_nomination_event_v1'));
    insert into public.relationship_interactions(tenant_id,organization_id,contact_id,interaction_type,occurred_at,summary,metadata) values(ev.tenant_id,ev.organization_id,cid,'campaign_enrollment',now(),'New BTY recommendation automatically enrolled in Recommended Organization Outreach.',jsonb_build_object('campaign_id',camp.id,'enrollment_id',enrollment,'nominationEventId',ev.id));
    update private.relationship_bty_recommended_nomination_events set status='enrolled',organization_id=ev.organization_id,contact_id=cid,enrollment_id=enrollment,last_reason=null,updated_at=now() where id=ev.id;
  exception when others then
    update private.relationship_bty_recommended_nomination_events set status='error',organization_id=ev.organization_id,contact_id=cid,last_reason=left(sqlstate||':'||sqlerrm,1000),updated_at=now() where id=ev.id;
    return jsonb_build_object('handled',false,'status','error','reason',left(sqlstate||':'||sqlerrm,1000));
  end;
  return jsonb_build_object('handled',true,'status','enrolled','enrollmentId',enrollment,'dueAt',due);
end;$function$;
revoke all on function private.try_auto_enroll_bty_recommended_event(uuid) from public;

create or replace function private.queue_bty_recommended_nomination_event(p_tenant_id uuid,p_organization_id uuid,p_contact_id uuid,p_source text,p_event_key text,p_nominated_at timestamptz,p_source_entity_type text default null,p_source_entity_id text default null,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare camp public.relationship_campaigns%rowtype; cutoff timestamptz; eid uuid;
begin
  if p_tenant_id is null or nullif(btrim(p_event_key),'') is null or p_nominated_at is null then return jsonb_build_object('queued',false,'reason','invalid_event'); end if;
  select * into camp from public.relationship_campaigns c where c.tenant_id=p_tenant_id and c.source_record_key='bty_recommended_organization_outreach_v1' limit 1;
  if not found then return jsonb_build_object('queued',false,'reason','campaign_not_found'); end if;
  begin cutoff:=nullif(camp.metadata->>'autoEnrollmentStartedAt','')::timestamptz; exception when others then cutoff:=null; end;
  if cutoff is null or p_nominated_at<cutoff then return jsonb_build_object('queued',false,'reason','before_auto_enrollment_cutoff'); end if;
  insert into private.relationship_bty_recommended_nomination_events(tenant_id,campaign_id,event_key,source,nominated_at,organization_id,contact_id,source_entity_type,source_entity_id,metadata)
  values(p_tenant_id,camp.id,btrim(p_event_key),coalesce(nullif(btrim(p_source),''),'unknown'),p_nominated_at,p_organization_id,p_contact_id,p_source_entity_type,p_source_entity_id,coalesce(p_metadata,'{}'::jsonb))
  on conflict(tenant_id,campaign_id,event_key) do update set metadata=private.relationship_bty_recommended_nomination_events.metadata||excluded.metadata,organization_id=coalesce(private.relationship_bty_recommended_nomination_events.organization_id,excluded.organization_id),contact_id=coalesce(private.relationship_bty_recommended_nomination_events.contact_id,excluded.contact_id),updated_at=now() returning id into eid;
  return jsonb_build_object('queued',true,'eventId',eid,'result',private.try_auto_enroll_bty_recommended_event(eid));
end;$function$;
revoke all on function private.queue_bty_recommended_nomination_event(uuid,uuid,uuid,text,text,timestamptz,text,text,jsonb) from public;

create or replace function private.capture_bty_recommended_nomination_role()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare oid uuid; cid uuid; at timestamptz; latest text; k text;
begin
  if new.role_code is distinct from 'bty_nominee' then return new; end if;
  if tg_op='INSERT' then at:=new.created_at; else latest:=nullif(new.metadata->>'latest_bty_nomination_at',''); if latest is null or latest is not distinct from nullif(old.metadata->>'latest_bty_nomination_at','') then return new; end if; begin at:=latest::timestamptz; exception when others then return new; end; end if;
  if tg_table_name='relationship_organization_roles' then oid:=new.organization_id; k:=format('organization-role:%s:%s',new.organization_id,to_char(at at time zone 'UTC','YYYYMMDDHH24MISS.US')); else cid:=new.contact_id; select l.organization_id into oid from public.relationship_contact_organizations l where l.tenant_id=new.tenant_id and l.contact_id=new.contact_id order by l.is_primary desc,l.updated_at desc,l.organization_id limit 1; k:=format('contact-role:%s:%s',new.contact_id,to_char(at at time zone 'UTC','YYYYMMDDHH24MISS.US')); end if;
  perform private.queue_bty_recommended_nomination_event(new.tenant_id,oid,cid,new.source,k,at,tg_table_name,coalesce(oid::text,cid::text),jsonb_build_object('triggerOperation',tg_op,'roleCode',new.role_code)); return new;
end;$function$;
revoke all on function private.capture_bty_recommended_nomination_role() from public;
drop trigger if exists bty_recommended_nomination_org_role on public.relationship_organization_roles;
create trigger bty_recommended_nomination_org_role after insert or update of metadata on public.relationship_organization_roles for each row execute function private.capture_bty_recommended_nomination_role();
drop trigger if exists bty_recommended_nomination_contact_role on public.relationship_contact_roles;
create trigger bty_recommended_nomination_contact_role after insert or update of metadata on public.relationship_contact_roles for each row execute function private.capture_bty_recommended_nomination_role();

create or replace function private.capture_bty_recommended_website_submission()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare oid uuid; cid uuid;
begin
  if new.submission_type is distinct from 'bty_submission' or coalesce(new.original_lane,'')<>'nominate' then return new; end if;
  oid:=coalesce(new.subject_organization_id,new.organization_id); if oid is null then return new; end if;
  if new.contact_id is not null and exists(select 1 from public.relationship_contact_organizations l where l.tenant_id=new.tenant_id and l.organization_id=oid and l.contact_id=new.contact_id) then cid:=new.contact_id; end if;
  perform private.queue_bty_recommended_nomination_event(new.tenant_id,oid,cid,new.source_system,'website-submission:'||new.id::text,new.submitted_at,'website_submissions',new.id::text,jsonb_build_object('sourceRecordKey',new.source_record_key,'sourcePage',new.source_page)); return new;
end;$function$;
revoke all on function private.capture_bty_recommended_website_submission() from public;
drop trigger if exists bty_recommended_nomination_website_submission on public.website_submissions;
create trigger bty_recommended_nomination_website_submission after insert on public.website_submissions for each row execute function private.capture_bty_recommended_website_submission();

create or replace function private.retry_waiting_bty_recommended_nomination_events()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare tenant uuid; oid uuid; cid uuid; r record;
begin
  tenant:=new.tenant_id;
  if tg_table_name='relationship_contact_organizations' then oid:=new.organization_id; cid:=new.contact_id; elsif tg_table_name='relationship_contacts' then cid:=new.id; elsif tg_table_name='relationship_organizations' then oid:=new.id; elsif tg_table_name='relationship_campaigns' then if new.source_record_key is distinct from 'bty_recommended_organization_outreach_v1' or new.status<>'active' or not new.execution_enabled then return new; end if; end if;
  for r in select e.id from private.relationship_bty_recommended_nomination_events e where e.tenant_id=tenant and e.status in ('waiting_for_details','waiting_campaign','error') and (tg_table_name='relationship_campaigns' or (oid is not null and e.organization_id=oid) or (cid is not null and e.contact_id=cid) or (tg_table_name='relationship_contact_organizations' and e.organization_id=oid and e.contact_id is null) or (tg_table_name='relationship_contact_organizations' and e.contact_id=cid and e.organization_id is null)) order by e.nominated_at,e.id loop perform private.try_auto_enroll_bty_recommended_event(r.id); end loop; return new;
end;$function$;
revoke all on function private.retry_waiting_bty_recommended_nomination_events() from public;
drop trigger if exists bty_recommended_retry_contact_link on public.relationship_contact_organizations;
create trigger bty_recommended_retry_contact_link after insert or update of is_primary,role_title on public.relationship_contact_organizations for each row execute function private.retry_waiting_bty_recommended_nomination_events();
drop trigger if exists bty_recommended_retry_contact_details on public.relationship_contacts;
create trigger bty_recommended_retry_contact_details after update of first_name,last_name,preferred_name,email,do_not_contact on public.relationship_contacts for each row execute function private.retry_waiting_bty_recommended_nomination_events();
drop trigger if exists bty_recommended_retry_org_details on public.relationship_organizations;
create trigger bty_recommended_retry_org_details after update of name,do_not_contact on public.relationship_organizations for each row execute function private.retry_waiting_bty_recommended_nomination_events();
drop trigger if exists bty_recommended_retry_campaign_enable on public.relationship_campaigns;
create trigger bty_recommended_retry_campaign_enable after update of status,execution_enabled on public.relationship_campaigns for each row execute function private.retry_waiting_bty_recommended_nomination_events();

create or replace function private.set_bty_recommended_campaign_sentence_and_guard()
returns trigger language plpgsql set search_path=''
as $function$
declare key text; oname text; refid uuid; ref public.relationship_referrals%rowtype; rolesource text; explicit text; sentence text;
begin
  select c.source_record_key into key from public.relationship_campaigns c where c.tenant_id=new.tenant_id and c.id=new.campaign_id; if key is distinct from 'bty_recommended_organization_outreach_v1' then return new; end if;
  if new.organization_id is null then raise exception 'Recommended Organization campaign requires an organization target.' using errcode='42501'; end if;
  select o.name into oname from public.relationship_organizations o where o.tenant_id=new.tenant_id and o.id=new.organization_id; if nullif(btrim(oname),'') is null then raise exception 'Recommended Organization campaign requires a valid organization.' using errcode='42501'; end if;
  begin refid:=nullif(new.personalization_context->>'verifiedReferralId','')::uuid; exception when invalid_text_representation then refid:=null; end;
  if refid is not null then select r.* into ref from public.relationship_referrals r where r.tenant_id=new.tenant_id and r.id=refid and r.verified and r.revoked_at is null and regexp_replace(lower(btrim(r.source_category)),'[^a-z0-9]+','_','g')='client_nomination' and ((r.organization_id is not null and r.organization_id=new.organization_id) or (r.contact_id is not null and r.contact_id=new.contact_id)); if found then sentence:='One of our clients recommended '||oname||' as an organization we should feature on Beyond The Yellow.'; end if; end if;
  explicit:=lower(nullif(new.personalization_context->>'nominationSource','')); if sentence is null and explicit='website' then sentence:='Someone recently recommended '||oname||' as an organization we should feature on Beyond The Yellow.'; elsif sentence is null and explicit in ('internal','research') then sentence:=oname||' was recently recommended to us as an organization we should feature on Beyond The Yellow.'; end if;
  if sentence is null then select role.source into rolesource from public.relationship_organization_roles role where role.tenant_id=new.tenant_id and role.organization_id=new.organization_id and role.role_code='bty_nominee' order by role.updated_at desc nulls last,role.created_at desc limit 1; if not found and new.contact_id is not null then select role.source into rolesource from public.relationship_contact_roles role where role.tenant_id=new.tenant_id and role.contact_id=new.contact_id and role.role_code='bty_nominee' order by role.updated_at desc nulls last,role.created_at desc limit 1; end if; if rolesource is null then raise exception 'Recommended Organization campaign requires verified recommendation evidence.' using errcode='42501'; end if; if lower(rolesource) like '%website%' then sentence:='Someone recently recommended '||oname||' as an organization we should feature on Beyond The Yellow.'; else sentence:=oname||' was recently recommended to us as an organization we should feature on Beyond The Yellow.'; end if; end if;
  new.personalization_context:=coalesce(new.personalization_context,'{}'::jsonb)||jsonb_build_object('approvedSourceSentence',sentence); return new;
end;$function$;
