create or replace function private.record_relationship_delivery_result(
  p_communication_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_idempotency_key text,
  p_provider_message_id text default null::text,
  p_provider_thread_id text default null::text,
  p_retry_at timestamptz default null::timestamptz,
  p_error_code text default null::text,
  p_error_message text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_result jsonb;
  v_comm public.relationship_communications%rowtype;
  v_activity jsonb;
begin
  v_result:=private.record_relationship_delivery_result_pre_bty(
    p_communication_id,p_claim_token,p_outcome,p_idempotency_key,p_provider_message_id,
    p_provider_thread_id,p_retry_at,p_error_code,p_error_message
  );
  if p_outcome='sent' then
    select * into v_comm from public.relationship_communications where id=p_communication_id;
    insert into public.relationship_message_observations(
      tenant_id,communication_id,source,provider_message_id,provider_thread_id,rfc_message_id,observed_at,metadata
    ) values (
      v_comm.tenant_id,v_comm.id,'resend',p_provider_message_id,nullif(p_provider_thread_id,''),
      nullif(p_provider_thread_id,''),coalesce(v_comm.sent_at,now()),
      jsonb_build_object('delivery_result_idempotency_key',p_idempotency_key)
    ) on conflict(tenant_id,source,provider_message_id) do update
      set rfc_message_id = coalesce(public.relationship_message_observations.rfc_message_id, excluded.rfc_message_id),
          provider_thread_id = coalesce(public.relationship_message_observations.provider_thread_id, excluded.provider_thread_id);
    if v_comm.opportunity_id is not null then
      v_activity:=private.apply_relationship_activity(
        v_comm.tenant_id,'outreach_sent','resend','resend-send:'||p_provider_message_id,
        p_provider_message_id,v_comm.organization_id,v_comm.contact_id,v_comm.opportunity_id,
        v_comm.campaign_id,v_comm.enrollment_id,v_comm.id,coalesce(v_comm.sent_at,now()),
        jsonb_build_object('provider','resend','provider_message_id',p_provider_message_id),null
      );
    end if;
  end if;
  return v_result||jsonb_build_object('relationshipActivity',v_activity);
end;
$function$;

with ranked as (
  select
    o.id,
    row_number() over (
      partition by o.tenant_id, o.provider_thread_id
      order by o.observed_at asc, o.created_at asc, o.id
    ) as rn
  from public.relationship_message_observations o
  where o.source='resend'
    and o.rfc_message_id is null
    and nullif(btrim(o.provider_thread_id),'') is not null
    and o.provider_thread_id like '<%>'
    and o.provider_thread_id like '%>'
)
update public.relationship_message_observations o
set rfc_message_id=o.provider_thread_id
from ranked r
where r.id=o.id
  and r.rn=1;

create or replace function private.resolve_relationship_gmail_message(
  p_tenant_id uuid,
  p_gmail_message_id text,
  p_gmail_thread_id text,
  p_headers jsonb,
  p_from_email text,
  p_to_emails text[],
  p_subject text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_comm_id uuid;
  v_candidates uuid[];
  v_enrollment_count integer:=0;
  v_hint text:=private.relationship_header_value(p_headers,'x-relationship-communication-id');
  v_rfc text:=private.relationship_header_value(p_headers,'message-id');
  v_reply text:=private.relationship_header_value(p_headers,'in-reply-to');
  v_refs text:=coalesce(private.relationship_header_value(p_headers,'references'),'');
  v_direction text:=case when lower(btrim(p_from_email))='info@valorwell.org' then 'outbound' else 'inbound' end;
  v_counterparty text;
  v_likely boolean:=false;
begin
  select o.communication_id into v_comm_id from public.relationship_message_observations o
  where o.tenant_id=p_tenant_id and o.source='gmail' and o.provider_message_id=p_gmail_message_id;
  if found then return jsonb_build_object('matched',true,'physicalExisting',true,
    'communicationId',v_comm_id,'direction',v_direction,'classification',
    private.classify_relationship_email(p_headers,p_subject,p_from_email)); end if;

  if v_rfc is not null then
    select o.communication_id into v_comm_id from public.relationship_message_observations o
    where o.tenant_id=p_tenant_id and o.rfc_message_id=v_rfc order by o.observed_at limit 1;
    if found then return jsonb_build_object('matched',true,'physicalExisting',true,
      'communicationId',v_comm_id,'direction',v_direction,'classification',
      private.classify_relationship_email(p_headers,p_subject,p_from_email)); end if;
  end if;

  if v_hint ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select id into v_comm_id from public.relationship_communications
    where tenant_id=p_tenant_id and id=v_hint::uuid;
    if found then return jsonb_build_object('matched',true,'physicalExisting',v_direction='outbound',
      'communicationId',v_comm_id,'direction',v_direction,'classification',
      private.classify_relationship_email(p_headers,p_subject,p_from_email)); end if;
  end if;

  if v_reply is not null or v_refs<>'' then
    select array_agg(distinct o.communication_id) into v_candidates
    from public.relationship_message_observations o
    join public.relationship_communications c on c.tenant_id=o.tenant_id and c.id=o.communication_id
    where o.tenant_id=p_tenant_id
      and c.direction='outbound'
      and o.rfc_message_id is not null
      and (o.rfc_message_id=v_reply or position(o.rfc_message_id in v_refs)>0);

    if cardinality(v_candidates)=1 then
      v_comm_id:=v_candidates[1];
    elsif cardinality(v_candidates)>1 then
      select count(distinct c.enrollment_id) into v_enrollment_count
      from public.relationship_communications c
      where c.tenant_id=p_tenant_id and c.id=any(v_candidates);
      if v_enrollment_count=1 then
        select c.id into v_comm_id
        from public.relationship_communications c
        where c.tenant_id=p_tenant_id and c.id=any(v_candidates)
        order by c.sent_at asc nulls last, c.occurred_at asc, c.id
        limit 1;
      else
        return jsonb_build_object('matched',false,'ambiguous',true,
          'direction',v_direction,'classification',private.classify_relationship_email(p_headers,p_subject,p_from_email));
      end if;
    end if;

    if v_comm_id is null then
      select array_agg(distinct o.communication_id) into v_candidates
      from public.relationship_message_observations o
      join public.relationship_communications c on c.tenant_id=o.tenant_id and c.id=o.communication_id
      where o.tenant_id=p_tenant_id
        and c.direction='outbound'
        and o.source='resend'
        and o.rfc_message_id is null
        and o.provider_thread_id is not null
        and (o.provider_thread_id=v_reply or position(o.provider_thread_id in v_refs)>0);

      if cardinality(v_candidates)=1 then
        v_comm_id:=v_candidates[1];
      elsif cardinality(v_candidates)>1 then
        select count(distinct c.enrollment_id) into v_enrollment_count
        from public.relationship_communications c
        where c.tenant_id=p_tenant_id and c.id=any(v_candidates);
        if v_enrollment_count=1 then
          select c.id into v_comm_id
          from public.relationship_communications c
          where c.tenant_id=p_tenant_id and c.id=any(v_candidates)
          order by c.sent_at asc nulls last, c.occurred_at asc, c.id
          limit 1;
        else
          return jsonb_build_object('matched',false,'ambiguous',true,
            'direction',v_direction,'classification',private.classify_relationship_email(p_headers,p_subject,p_from_email));
        end if;
      end if;
    end if;
  end if;

  if v_comm_id is null and nullif(btrim(p_gmail_thread_id),'') is not null then
    select array_agg(distinct o.communication_id) into v_candidates
    from public.relationship_message_observations o
    where o.tenant_id=p_tenant_id and o.source='gmail' and o.provider_thread_id=p_gmail_thread_id;
    if cardinality(v_candidates)=1 then v_comm_id:=v_candidates[1]; end if;
    if cardinality(v_candidates)>1 then return jsonb_build_object('matched',false,'ambiguous',true,
      'direction',v_direction,'classification',private.classify_relationship_email(p_headers,p_subject,p_from_email)); end if;
  end if;

  if v_comm_id is not null then return jsonb_build_object('matched',true,'physicalExisting',false,
    'communicationId',v_comm_id,'direction',v_direction,'classification',
    private.classify_relationship_email(p_headers,p_subject,p_from_email)); end if;

  v_counterparty:=case when v_direction='inbound' then lower(btrim(p_from_email)) else
    (select lower(btrim(x)) from unnest(coalesce(p_to_emails,'{}'::text[])) x
     where lower(btrim(x))<>'info@valorwell.org' limit 1) end;
  select exists(select 1 from public.relationship_contacts c
    where c.tenant_id=p_tenant_id and lower(c.email)=v_counterparty) into v_likely;
  return jsonb_build_object('matched',false,'ambiguous',v_likely,'likelyRelationship',v_likely,
    'direction',v_direction,'classification',private.classify_relationship_email(p_headers,p_subject,p_from_email));
end;
$function$;
