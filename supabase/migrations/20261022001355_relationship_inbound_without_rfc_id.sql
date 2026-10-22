-- Preserve provider-ID lookup when RFC Message-ID is absent. FOUND may still
-- describe the outbound anchor lookup; it is not an inbound existence check.
create or replace function private.ingest_relationship_inbound_reply(
  p_provider text,p_provider_event_id text,p_provider_message_id text,p_provider_thread_id text,
  p_outbound_communication_id uuid,p_in_reply_to_provider_message_id text,p_from_email text,p_to_email text,
  p_subject text,p_body text,p_occurred_at timestamptz,p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_outbound public.relationship_communications%rowtype;
  v_inbound public.relationship_communications%rowtype;
  v_existing_event public.relationship_communication_events%rowtype;
  v_tenant uuid;
  v_reply_id uuid;
  v_classification text;
  v_headers jsonb:=coalesce(p_payload->'received_headers',p_payload->'headers','{}'::jsonb);
  v_rfc_id text:=private.relationship_header_value(v_headers,'message-id');
  v_stop boolean:=true;
  v_enrollment public.relationship_campaign_enrollments%rowtype;
  v_activity jsonb;
begin
  if lower(btrim(p_provider))<>all(array['resend','gmail']::text[]) then
    raise exception 'Unsupported relationship inbound provider.' using errcode='22023';
  end if;
  if nullif(btrim(p_provider_event_id),'') is null or nullif(btrim(p_provider_message_id),'') is null then
    raise exception 'Inbound provider event and message IDs are required.' using errcode='22023';
  end if;
  if lower(btrim(p_from_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or lower(btrim(p_to_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Valid inbound sender and recipient emails are required.' using errcode='22023';
  end if;
  if length(coalesce(p_body,''))>1048576 then
    raise exception 'Inbound reply body exceeds the supported size.' using errcode='22023';
  end if;
  select * into v_existing_event from public.relationship_communication_events
  where provider=lower(btrim(p_provider)) and provider_event_id=btrim(p_provider_event_id);
  if found then
    select r.id into v_reply_id from public.relationship_replies r
    where r.tenant_id=v_existing_event.tenant_id and r.communication_id=v_existing_event.communication_id;
    return jsonb_build_object('replayed',true,'matched',true,'classification',
      case when v_reply_id is null then 'automated' else 'human' end,'replyId',v_reply_id);
  end if;

  if p_outbound_communication_id is not null then
    select * into v_outbound from public.relationship_communications c
    where c.id=p_outbound_communication_id and c.direction='outbound'
      and lower(c.recipient_email)=lower(btrim(p_from_email));
  end if;
  if not found and nullif(btrim(p_in_reply_to_provider_message_id),'') is not null then
    select c.* into v_outbound from public.relationship_communications c
    where c.direction='outbound' and lower(c.recipient_email)=lower(btrim(p_from_email))
      and (c.provider_message_id=btrim(p_in_reply_to_provider_message_id)
        or c.id in (select o.communication_id from public.relationship_message_observations o
          where o.provider_message_id=btrim(p_in_reply_to_provider_message_id)
             or o.rfc_message_id=btrim(p_in_reply_to_provider_message_id)))
    order by c.sent_at desc nulls last limit 1;
  end if;
  if not found and nullif(btrim(p_provider_thread_id),'') is not null then
    select c.* into v_outbound from public.relationship_communications c
    where c.direction='outbound' and lower(c.recipient_email)=lower(btrim(p_from_email))
      and c.id in (select o.communication_id from public.relationship_message_observations o
        where o.provider_thread_id=btrim(p_provider_thread_id))
    order by c.sent_at desc nulls last limit 1;
  end if;

  if not found then
    select c.tenant_id into v_tenant from private.relationship_delivery_provider_configs c
    where lower(c.inbound_address)=lower(btrim(p_to_email)) limit 1;
    if v_tenant is null and lower(btrim(p_to_email))='info@valorwell.org' then
      select tenant_id into v_tenant from private.relationship_google_connections
      where connection_type='gmail' and google_account_email='info@valorwell.org' and status='active' limit 1;
    end if;
    if v_tenant is not null then
      v_activity:=private.apply_relationship_activity(
        v_tenant,'human_reply_received',lower(btrim(p_provider)),
        format('%s-inbound-unmatched:%s',lower(btrim(p_provider)),p_provider_event_id),p_provider_event_id,
        null,null,null,null,null,null,coalesce(p_occurred_at,now()),
        jsonb_build_object('provider_message_id',p_provider_message_id,'from_email',lower(btrim(p_from_email)),
          'to_email',lower(btrim(p_to_email)),'subject',left(coalesce(p_subject,''),500)),null
      );
    end if;
    return jsonb_build_object('replayed',false,'matched',false,'classification','ambiguous','activity',v_activity);
  end if;
  v_tenant:=v_outbound.tenant_id;
  v_classification:=private.classify_relationship_email(v_headers,p_subject,p_from_email);

  if v_rfc_id is not null then
    select c.* into v_inbound from public.relationship_message_observations o
    join public.relationship_communications c on c.tenant_id=o.tenant_id and c.id=o.communication_id
    where o.tenant_id=v_tenant and o.rfc_message_id=v_rfc_id and c.direction='inbound'
    order by o.observed_at limit 1;
  end if;
  if v_inbound.id is null then
    select * into v_inbound from public.relationship_communications
    where tenant_id=v_tenant and direction='inbound'
      and provider=lower(btrim(p_provider)) and provider_message_id=btrim(p_provider_message_id);
  end if;
  if v_inbound.id is null then
    insert into public.relationship_communications(
      tenant_id,campaign_id,campaign_step_id,enrollment_id,organization_id,contact_id,opportunity_id,
      direction,channel,status,sender_email,recipient_email,subject,rendered_body,provider,
      provider_message_id,provider_thread_id,occurred_at,metadata
    ) values (
      v_tenant,v_outbound.campaign_id,v_outbound.campaign_step_id,v_outbound.enrollment_id,
      v_outbound.organization_id,v_outbound.contact_id,v_outbound.opportunity_id,
      'inbound','email','received',lower(btrim(p_from_email)),lower(btrim(p_to_email)),
      nullif(p_subject,''),coalesce(p_body,''),lower(btrim(p_provider)),btrim(p_provider_message_id),
      nullif(btrim(p_provider_thread_id),''),coalesce(p_occurred_at,now()),
      jsonb_build_object('in_reply_to_communication_id',v_outbound.id,'classification',v_classification)
    ) returning * into v_inbound;
  end if;
  insert into public.relationship_message_observations(
    tenant_id,communication_id,source,provider_message_id,provider_thread_id,rfc_message_id,observed_at,metadata
  ) values (
    v_tenant,v_inbound.id,lower(btrim(p_provider)),btrim(p_provider_message_id),
    nullif(btrim(p_provider_thread_id),''),v_rfc_id,coalesce(p_occurred_at,now()),
    jsonb_build_object('classification',v_classification)
  ) on conflict(tenant_id,source,provider_message_id) do nothing;
  insert into public.relationship_communication_events(
    tenant_id,communication_id,provider,provider_event_id,event_type,occurred_at,payload
  ) values (
    v_tenant,v_inbound.id,lower(btrim(p_provider)),btrim(p_provider_event_id),'email.received',
    coalesce(p_occurred_at,now()),coalesce(p_payload,'{}'::jsonb)
  ) on conflict(provider,provider_event_id) where provider_event_id is not null do nothing;

  if v_classification='human' then
    insert into public.relationship_replies(
      tenant_id,communication_id,enrollment_id,organization_id,contact_id,opportunity_id,status,metadata
    ) values (
      v_tenant,v_inbound.id,v_inbound.enrollment_id,v_inbound.organization_id,
      v_inbound.contact_id,v_inbound.opportunity_id,'new',jsonb_build_object('outbound_communication_id',v_outbound.id)
    ) on conflict(communication_id) do update set updated_at=public.relationship_replies.updated_at
    returning id into v_reply_id;
    select stop_on_reply into v_stop from public.relationship_campaign_steps
    where tenant_id=v_tenant and id=v_outbound.campaign_step_id;
    if coalesce(v_stop,true) and v_outbound.enrollment_id is not null then
      select * into v_enrollment from public.relationship_campaign_enrollments
      where tenant_id=v_tenant and id=v_outbound.enrollment_id for update;
      if found and v_enrollment.status=any(array['pending','active','paused']::text[]) then
        update public.relationship_campaign_enrollments set status='responded',
          responded_at=coalesce(p_occurred_at,now()),delivery_enabled=false,next_scheduled_at=null
        where id=v_enrollment.id;
        update private.relationship_campaign_work_items set status='cancelled',claim_token=null,
          claimed_by=null,claimed_at=null,lease_expires_at=null,updated_at=now(),
          metadata=metadata||jsonb_build_object('cancelled_by_reply_id',v_reply_id)
        where tenant_id=v_tenant and enrollment_id=v_enrollment.id
          and status=any(array['planned','retry_wait','claimed']::text[]);
        insert into public.relationship_enrollment_events(
          tenant_id,enrollment_id,event_type,from_status,to_status,reason,metadata
        ) values (
          v_tenant,v_enrollment.id,'reply_received',v_enrollment.status,'responded',
          'Verified human inbound reply stopped remaining relationship campaign work.',
          jsonb_build_object('reply_id',v_reply_id,'communication_id',v_inbound.id)
        );
      end if;
    end if;
    insert into public.relationship_interactions(
      tenant_id,organization_id,contact_id,opportunity_id,interaction_type,occurred_at,summary,metadata
    ) values (
      v_tenant,v_outbound.organization_id,v_outbound.contact_id,v_outbound.opportunity_id,
      'inbound_reply',coalesce(p_occurred_at,now()),coalesce(nullif(p_subject,''),'Inbound relationship reply received.'),
      jsonb_build_object('reply_id',v_reply_id,'communication_id',v_inbound.id,'classification','human')
    );
  else
    insert into public.relationship_interactions(
      tenant_id,organization_id,contact_id,opportunity_id,interaction_type,occurred_at,summary,metadata
    ) values (
      v_tenant,v_outbound.organization_id,v_outbound.contact_id,v_outbound.opportunity_id,
      'system',coalesce(p_occurred_at,now()),'Automated inbound response recorded without changing BTY lifecycle.',
      jsonb_build_object('communication_id',v_inbound.id,'classification','automated')
    );
  end if;
  v_activity:=private.apply_relationship_activity(
    v_tenant,case when v_classification='human' then 'human_reply_received' else 'automated_reply_received' end,
    lower(btrim(p_provider)),format('%s-inbound:%s',lower(btrim(p_provider)),p_provider_event_id),p_provider_event_id,
    v_outbound.organization_id,v_outbound.contact_id,v_outbound.opportunity_id,v_outbound.campaign_id,
    v_outbound.enrollment_id,v_inbound.id,coalesce(p_occurred_at,now()),
    jsonb_build_object('classification',v_classification,'reply_id',v_reply_id,'outbound_communication_id',v_outbound.id),null
  );
  return jsonb_build_object('replayed',false,'matched',true,'classification',v_classification,
    'replyId',v_reply_id,'communicationId',v_inbound.id,'activity',v_activity);
end;
$function$;
