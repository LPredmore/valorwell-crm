create or replace function public.ai_ops_build_bty_intelligence_batches(p_tenant_id uuid,p_run_id uuid,p_cutoff_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_row record;v_payload jsonb;v_key text;v_prep int:=0;v_post int:=0;v_unavailable int:=0;v_date date;
begin
 if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501';end if;
 select business_date into v_date from public.ai_operations_runs where id=p_run_id and tenant_id=p_tenant_id;
 for v_row in
  select m.id,m.organization_id,m.contact_id,m.opportunity_id,m.purpose,m.starts_at,m.ends_at,m.event_status,m.streamyard_url,
   o.name organization_name,o.website,o.organization_kind,o.veteran_affiliated,o.relationship_stage,
   c.first_name,c.last_name,c.preferred_name,c.veteran_affiliation,
   ro.status opportunity_status,ro.cause_area,ro.next_action,ro.qualification,
   (select jsonb_agg(jsonb_build_object('occurredAt',i.occurred_at,'type',i.interaction_type,'summary',left(coalesce(i.summary,''),1200)) order by i.occurred_at desc)
    from (select * from public.relationship_interactions i where i.tenant_id=p_tenant_id and (i.organization_id=m.organization_id or (m.contact_id is not null and i.contact_id=m.contact_id) or (m.opportunity_id is not null and i.opportunity_id=m.opportunity_id)) order by i.occurred_at desc limit 10) i) recent_interactions
  from public.relationship_meetings m
  join public.relationship_organizations o on o.id=m.organization_id and o.tenant_id=m.tenant_id
  left join public.relationship_contacts c on c.id=m.contact_id and c.tenant_id=m.tenant_id
  left join public.relationship_opportunities ro on ro.id=m.opportunity_id and ro.tenant_id=m.tenant_id
  where m.tenant_id=p_tenant_id
    and exists(select 1 from public.relationship_organization_roles r where r.tenant_id=p_tenant_id and r.organization_id=m.organization_id and r.role_code='bty_nominee')
    and ((m.starts_at between p_cutoff_at and p_cutoff_at+interval '14 days' and coalesce(m.event_status,'') not in('cancelled','deleted')) or (m.ends_at between p_cutoff_at-interval '2 days' and p_cutoff_at and coalesce(m.event_status,'') not in('cancelled','deleted')))
  order by m.starts_at
 loop
   v_key:='bty'||left(md5(v_row.id::text||p_run_id::text),12);
   v_payload:=jsonb_build_object(
     'entityKey',v_key,'meetingPurpose',v_row.purpose,'startsAt',v_row.starts_at,'endsAt',v_row.ends_at,'eventStatus',v_row.event_status,
     'organization',jsonb_build_object('id',v_row.organization_id,'name',v_row.organization_name,'website',v_row.website,'kind',v_row.organization_kind,'veteranAffiliated',v_row.veteran_affiliated,'relationshipStage',v_row.relationship_stage),
     'contact',case when v_row.contact_id is null then null else jsonb_build_object('id',v_row.contact_id,'name',trim(concat_ws(' ',coalesce(v_row.preferred_name,v_row.first_name),v_row.last_name)),'veteranAffiliation',v_row.veteran_affiliation) end,
     'opportunity',case when v_row.opportunity_id is null then null else jsonb_build_object('id',v_row.opportunity_id,'status',v_row.opportunity_status,'causeArea',v_row.cause_area,'nextAction',v_row.next_action,'qualification',v_row.qualification) end,
     'recentInteractions',coalesce(v_row.recent_interactions,'[]'::jsonb),'sourceTimestamp',v_row.starts_at
   );
   insert into private.ai_ops_snapshots(tenant_id,entity_type,entity_id,snapshot_type,snapshot_hash,evaluation_hash,cutoff_at,payload,expires_at) values(p_tenant_id,'relationship_meeting',v_row.id::text,'bty_intelligence:'||p_run_id::text,v_key,md5((v_payload-'entityKey')::text),p_cutoff_at,v_payload,now()+interval '30 days');
   if v_row.starts_at>=p_cutoff_at then
      perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'bty_intelligence','bty_prep:'||v_row.id::text||':'||v_date::text,'bty_interview_prep',jsonb_build_object('entities',jsonb_build_array(v_payload)),'1','1',65,'gemini-2.5-pro','{}'::uuid[]);v_prep:=v_prep+1;
   else
      if jsonb_array_length(coalesce(v_row.recent_interactions,'[]'::jsonb))=0 then v_unavailable:=v_unavailable+1;
      else perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'bty_intelligence','bty_post:'||v_row.id::text||':'||v_date::text,'bty_post_interview_review',jsonb_build_object('entities',jsonb_build_array(v_payload)),'1','1',65,'gemini-2.5-pro','{}'::uuid[]);v_post:=v_post+1;end if;
   end if;
 end loop;
 return jsonb_build_object('sourceAvailable',true,'prepItemsQueued',v_prep,'postInterviewItemsQueued',v_post,'postInterviewSourceUnavailable',v_unavailable,'sourceItemsTotal',v_prep+v_post+v_unavailable,'itemsQueued',v_prep+v_post,'batchesQueued',v_prep+v_post,'cutoffAt',p_cutoff_at);
end;$function$;