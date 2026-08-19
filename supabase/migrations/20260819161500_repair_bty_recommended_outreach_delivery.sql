-- Repair the active BTY Recommended Organization campaign so canonical communications can be prepared.
update public.relationship_campaign_steps
set render_hash = 'sha256:' || encode(
  extensions.digest(
    convert_to(
      coalesce(subject_template,'') || E'\n---TEXT---\n' ||
      coalesce(nullif(body_text_template,''), body_template, '') || E'\n---HTML---\n' ||
      coalesce(body_html_template,''),
      'UTF8'
    ),
    'sha256'
  ),
  'hex'
),
updated_at = now()
where campaign_id = '292d66f7-041b-4faf-873e-20631db4c120'::uuid
  and position in (1,2);

-- Keep the Resend inbound address as backend infrastructure only. Recipient-visible replies
-- go to the verified campaign sender, info@valorwell.org.
create or replace function private.prepare_relationship_campaign_delivery(
  p_work_item_id uuid,
  p_claim_token uuid,
  p_idempotency_key text,
  p_unsubscribe_base_url text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
 v_item private.relationship_campaign_work_items%rowtype; v_campaign public.relationship_campaigns%rowtype;
 v_enrollment public.relationship_campaign_enrollments%rowtype; v_step public.relationship_campaign_steps%rowtype;
 v_config private.relationship_delivery_provider_configs%rowtype; v_existing record; v_comm_id uuid; v_token jsonb;
 v_unsub text; v_subject text; v_text_template text; v_html_template text; v_text text; v_html text; v_preheader text; v_response jsonb;
begin
 if nullif(btrim(p_idempotency_key),'') is null then raise exception 'Delivery preparation idempotency key is required.' using errcode='22023'; end if;
 if nullif(btrim(p_unsubscribe_base_url),'') is null or p_unsubscribe_base_url !~ '^https://' then raise exception 'A secure unsubscribe base URL is required.' using errcode='22023'; end if;
 select * into v_item from private.relationship_campaign_work_items where id=p_work_item_id for update;
 if not found then raise exception 'Campaign work item not found.' using errcode='P0002'; end if;
 select operation,work_item_id,response into v_existing from private.relationship_delivery_idempotency
 where tenant_id=v_item.tenant_id and idempotency_key=btrim(p_idempotency_key);
 if found then
  if v_existing.operation<>'prepare' or v_existing.work_item_id is distinct from p_work_item_id then raise exception 'Preparation idempotency key was already used for another operation.' using errcode='23505'; end if;
  return v_existing.response;
 end if;
 if v_item.status<>'claimed' or v_item.claim_token is distinct from p_claim_token or v_item.lease_expires_at<=now() then raise exception 'Campaign work claim is no longer valid.' using errcode='40001'; end if;
 select * into v_campaign from public.relationship_campaigns where tenant_id=v_item.tenant_id and id=v_item.campaign_id;
 select * into v_enrollment from public.relationship_campaign_enrollments where tenant_id=v_item.tenant_id and id=v_item.enrollment_id for update;
 select * into v_step from public.relationship_campaign_steps where tenant_id=v_item.tenant_id and id=v_item.campaign_step_id;
 perform private.revalidate_relationship_enrollment(v_item.tenant_id,v_enrollment.id,null,'Final pre-delivery safety revalidation.');
 select * into v_enrollment from public.relationship_campaign_enrollments where tenant_id=v_item.tenant_id and id=v_item.enrollment_id for update;
 select * into v_config from private.relationship_delivery_provider_configs where tenant_id=v_item.tenant_id and provider='resend';
 if not found or v_config.status<>'ready' then raise exception 'Relationship delivery provider is not ready.' using errcode='42501'; end if;
 if not v_campaign.execution_enabled or not v_enrollment.delivery_enabled or v_enrollment.safety_status<>'ready' or v_enrollment.status<>all(array['pending','active']::text[]) then raise exception 'Campaign execution, enrollment delivery, and safety gates must all remain enabled.' using errcode='42501'; end if;
 if lower(v_campaign.sender_email)<>lower(v_config.sender_email) then raise exception 'Campaign sender is not the verified provider sender.' using errcode='42501'; end if;
 if v_step.render_hash is null then raise exception 'Campaign step is missing canonical render hash.' using errcode='22023'; end if;
 select id into v_comm_id from public.relationship_communications where work_item_id=v_item.id and direction='outbound';
 if v_comm_id is null then
  v_token:=private.issue_relationship_unsubscribe_token(v_item.tenant_id,v_enrollment.contact_id,v_campaign.id,v_enrollment.recipient_email,now()+interval '30 days');
  v_unsub:=rtrim(p_unsubscribe_base_url,'/?')||'?token='||(v_token->>'token');
  v_subject:=private.render_relationship_text(v_step.subject_template,v_enrollment.personalization_context,v_unsub,v_config.postal_address);
  v_text_template:=coalesce(nullif(v_step.body_text_template,''),v_step.body_template);
  if position('{{unsubscribe_url}}' in v_text_template)=0 then v_text_template:=v_text_template||E'\n\n---\nUnsubscribe from non-clinical ValorWell relationship outreach: {{unsubscribe_url}}'; end if;
  if position('{{postal_address}}' in v_text_template)=0 then v_text_template:=v_text_template||E'\n{{postal_address}}'; end if;
  v_text:=private.render_relationship_text(v_text_template,v_enrollment.personalization_context,v_unsub,v_config.postal_address);
  if nullif(btrim(v_step.body_html_template),'') is not null then
   v_html_template:=v_step.body_html_template;
   if position('{{unsubscribe_url}}' in v_html_template)=0 then v_html_template:=v_html_template||'<hr><p>Unsubscribe from non-clinical ValorWell relationship outreach: <a href="{{unsubscribe_url}}">unsubscribe</a>'; else v_html_template:=v_html_template||'<hr><p>'; end if;
   if position('{{postal_address}}' in v_html_template)=0 then v_html_template:=v_html_template||'<br>{{postal_address}}'; end if;
   v_html_template:=v_html_template||'</p>';
   v_html:=private.render_relationship_html(v_html_template,v_enrollment.personalization_context,v_unsub,v_config.postal_address);
  end if;
  if nullif(btrim(v_step.preheader_template),'') is not null then v_preheader:=private.render_relationship_text(v_step.preheader_template,v_enrollment.personalization_context,v_unsub,v_config.postal_address); end if;
  insert into public.relationship_communications(
   tenant_id,work_item_id,campaign_id,campaign_step_id,enrollment_id,organization_id,contact_id,opportunity_id,
   direction,channel,status,sender_email,recipient_email,subject,rendered_body,rendered_html,rendered_text,rendered_preheader,
   render_hash,template_version_id,provider,occurred_at,scheduled_for,metadata
  ) values (
   v_item.tenant_id,v_item.id,v_campaign.id,v_step.id,v_enrollment.id,v_enrollment.organization_id,v_enrollment.contact_id,v_enrollment.opportunity_id,
   'outbound','email','scheduled',lower(v_campaign.sender_email),lower(v_enrollment.recipient_email),v_subject,v_text,v_html,v_text,v_preheader,
   v_step.render_hash,v_step.template_version_id,'resend',now(),v_item.due_at,
   jsonb_build_object('attempt_count',v_item.attempt_count,'unsubscribe_expires_at',v_token->>'expiresAt','email_content_mode',coalesce(v_step.content_mode,'legacy'),'reply_to',lower(v_campaign.sender_email))
  ) returning id into v_comm_id;
  insert into public.relationship_communication_events(tenant_id,communication_id,provider,event_type,occurred_at,payload)
  values(v_item.tenant_id,v_comm_id,'crm','scheduled',now(),jsonb_build_object('work_item_id',v_item.id,'attempt_count',v_item.attempt_count));
  insert into public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,reason,metadata)
  values(v_item.tenant_id,v_enrollment.id,'communication_scheduled','Canonical outbound communication prepared for provider delivery.',jsonb_build_object('communication_id',v_comm_id,'work_item_id',v_item.id));
 else
  update public.relationship_communications set status='scheduled',failed_at=null,error_code=null,error_message=null,
    metadata=metadata||jsonb_build_object('attempt_count',v_item.attempt_count) where id=v_comm_id and status='failed';
 end if;
 v_response:=private.relationship_communication_json(v_comm_id)||jsonb_build_object('replyTo',lower(v_campaign.sender_email),'providerIdempotencyKey','relationship-communication:'||v_comm_id::text);
 insert into private.relationship_delivery_idempotency(tenant_id,idempotency_key,operation,work_item_id,communication_id,response)
 values(v_item.tenant_id,btrim(p_idempotency_key),'prepare',v_item.id,v_comm_id,v_response);
 return v_response;
end;$function$;
