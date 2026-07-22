-- Pass 12: deterministic rendering, final safety validation, provider result recording, and guarded work advancement.

CREATE OR REPLACE FUNCTION private.render_relationship_text(p_template text,p_context jsonb,p_unsubscribe_url text,p_postal_address text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $function$
DECLARE v_result text:=coalesce(p_template,'');
BEGIN
  v_result:=replace(v_result,'{{recipient_name}}',coalesce(nullif(p_context->>'contactDisplayName',''),'there'));
  v_result:=replace(v_result,'{{first_name}}',coalesce(nullif(p_context->>'contactFirstName',''),nullif(p_context->>'contactDisplayName',''),'there'));
  v_result:=replace(v_result,'{{organization_name}}',coalesce(nullif(p_context->>'organizationName',''),''));
  v_result:=replace(v_result,'{{sender_name}}',coalesce(nullif(p_context->>'senderName',''),''));
  v_result:=replace(v_result,'{{unsubscribe_url}}',coalesce(p_unsubscribe_url,''));
  v_result:=replace(v_result,'{{postal_address}}',coalesce(p_postal_address,''));
  IF v_result ~ '\{\{[^{}]+\}\}' THEN
    RAISE EXCEPTION 'Relationship campaign template contains unresolved variables.' USING errcode='22023';
  END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION private.prepare_relationship_campaign_delivery(
  p_work_item_id uuid,p_claim_token uuid,p_idempotency_key text,p_unsubscribe_base_url text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_item private.relationship_campaign_work_items%rowtype;
  v_campaign public.relationship_campaigns%rowtype;
  v_enrollment public.relationship_campaign_enrollments%rowtype;
  v_step public.relationship_campaign_steps%rowtype;
  v_config private.relationship_delivery_provider_configs%rowtype;
  v_existing record;
  v_comm_id uuid;
  v_token jsonb;
  v_unsub text;
  v_subject text;
  v_body_template text;
  v_body text;
  v_response jsonb;
BEGIN
  IF nullif(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'Delivery preparation idempotency key is required.' USING errcode='22023'; END IF;
  IF nullif(btrim(p_unsubscribe_base_url),'') IS NULL OR p_unsubscribe_base_url !~ '^https://' THEN
    RAISE EXCEPTION 'A secure unsubscribe base URL is required.' USING errcode='22023';
  END IF;
  SELECT * INTO v_item FROM private.relationship_campaign_work_items WHERE id=p_work_item_id FOR UPDATE;
  IF NOT found THEN RAISE EXCEPTION 'Campaign work item not found.' USING errcode='P0002'; END IF;
  SELECT operation,work_item_id,response INTO v_existing
  FROM private.relationship_delivery_idempotency
  WHERE tenant_id=v_item.tenant_id AND idempotency_key=btrim(p_idempotency_key);
  IF found THEN
    IF v_existing.operation<>'prepare' OR v_existing.work_item_id IS DISTINCT FROM p_work_item_id THEN
      RAISE EXCEPTION 'Preparation idempotency key was already used for another operation.' USING errcode='23505';
    END IF;
    RETURN v_existing.response;
  END IF;
  IF v_item.status<>'claimed' OR v_item.claim_token IS DISTINCT FROM p_claim_token OR v_item.lease_expires_at<=now() THEN
    RAISE EXCEPTION 'Campaign work claim is no longer valid.' USING errcode='40001';
  END IF;
  SELECT * INTO v_campaign FROM public.relationship_campaigns WHERE tenant_id=v_item.tenant_id AND id=v_item.campaign_id;
  SELECT * INTO v_enrollment FROM public.relationship_campaign_enrollments WHERE tenant_id=v_item.tenant_id AND id=v_item.enrollment_id FOR UPDATE;
  SELECT * INTO v_step FROM public.relationship_campaign_steps WHERE tenant_id=v_item.tenant_id AND id=v_item.campaign_step_id;
  PERFORM private.revalidate_relationship_enrollment(v_item.tenant_id,v_enrollment.id,NULL,'Final pre-delivery safety revalidation.');
  SELECT * INTO v_enrollment FROM public.relationship_campaign_enrollments WHERE tenant_id=v_item.tenant_id AND id=v_item.enrollment_id FOR UPDATE;
  SELECT * INTO v_config FROM private.relationship_delivery_provider_configs WHERE tenant_id=v_item.tenant_id AND provider='resend';
  IF NOT found OR v_config.status<>'ready' THEN RAISE EXCEPTION 'Relationship delivery provider is not ready.' USING errcode='42501'; END IF;
  IF NOT v_campaign.execution_enabled OR NOT v_enrollment.delivery_enabled OR v_enrollment.safety_status<>'ready'
     OR v_enrollment.status<>ALL(ARRAY['pending','active']::text[]) THEN
    RAISE EXCEPTION 'Campaign execution, enrollment delivery, and safety gates must all remain enabled.' USING errcode='42501';
  END IF;
  IF lower(v_campaign.sender_email)<>lower(v_config.sender_email) THEN
    RAISE EXCEPTION 'Campaign sender is not the verified provider sender.' USING errcode='42501';
  END IF;
  SELECT id INTO v_comm_id FROM public.relationship_communications WHERE work_item_id=v_item.id AND direction='outbound';
  IF v_comm_id IS NULL THEN
    v_token:=private.issue_relationship_unsubscribe_token(v_item.tenant_id,v_enrollment.contact_id,v_campaign.id,v_enrollment.recipient_email,now()+interval '30 days');
    v_unsub:=rtrim(p_unsubscribe_base_url,'/?')||'?token='||(v_token->>'token');
    v_subject:=private.render_relationship_text(v_step.subject_template,v_enrollment.personalization_context,v_unsub,v_config.postal_address);
    v_body_template:=v_step.body_template;
    IF position('{{unsubscribe_url}}' IN v_body_template)=0 THEN
      v_body_template:=v_body_template||E'\n\n---\nUnsubscribe from non-clinical ValorWell relationship outreach: {{unsubscribe_url}}';
    END IF;
    IF position('{{postal_address}}' IN v_body_template)=0 THEN v_body_template:=v_body_template||E'\n{{postal_address}}'; END IF;
    v_body:=private.render_relationship_text(v_body_template,v_enrollment.personalization_context,v_unsub,v_config.postal_address);
    INSERT INTO public.relationship_communications(
      tenant_id,work_item_id,campaign_id,campaign_step_id,enrollment_id,organization_id,contact_id,opportunity_id,
      direction,channel,status,sender_email,recipient_email,subject,rendered_body,provider,occurred_at,scheduled_for,metadata
    ) VALUES (
      v_item.tenant_id,v_item.id,v_campaign.id,v_step.id,v_enrollment.id,v_enrollment.organization_id,v_enrollment.contact_id,v_enrollment.opportunity_id,
      'outbound','email','scheduled',lower(v_campaign.sender_email),lower(v_enrollment.recipient_email),v_subject,v_body,'resend',now(),v_item.due_at,
      jsonb_build_object('attempt_count',v_item.attempt_count,'unsubscribe_expires_at',v_token->>'expiresAt')
    ) RETURNING id INTO v_comm_id;
    INSERT INTO public.relationship_communication_events(tenant_id,communication_id,provider,event_type,occurred_at,payload)
    VALUES(v_item.tenant_id,v_comm_id,'crm','scheduled',now(),jsonb_build_object('work_item_id',v_item.id,'attempt_count',v_item.attempt_count));
    INSERT INTO public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,reason,metadata)
    VALUES(v_item.tenant_id,v_enrollment.id,'communication_scheduled','Canonical outbound communication prepared for provider delivery.',jsonb_build_object('communication_id',v_comm_id,'work_item_id',v_item.id));
  ELSE
    UPDATE public.relationship_communications
    SET status='scheduled',failed_at=NULL,error_code=NULL,error_message=NULL,metadata=metadata||jsonb_build_object('attempt_count',v_item.attempt_count)
    WHERE id=v_comm_id AND status='failed';
  END IF;
  v_response:=private.relationship_communication_json(v_comm_id)||jsonb_build_object(
    'replyTo',v_config.inbound_address,'providerIdempotencyKey','relationship-communication:'||v_comm_id::text
  );
  INSERT INTO private.relationship_delivery_idempotency(tenant_id,idempotency_key,operation,work_item_id,communication_id,response)
  VALUES(v_item.tenant_id,btrim(p_idempotency_key),'prepare',v_item.id,v_comm_id,v_response);
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION private.record_relationship_campaign_work_result(
  p_work_item_id uuid,p_claim_token uuid,p_outcome text,p_idempotency_key text,
  p_retry_at timestamptz DEFAULT NULL,p_error_code text DEFAULT NULL,p_error_message text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_item private.relationship_campaign_work_items%rowtype;
  v_campaign public.relationship_campaigns%rowtype;
  v_enrollment public.relationship_campaign_enrollments%rowtype;
  v_next_step public.relationship_campaign_steps%rowtype;
  v_existing_operation text;
  v_existing_work_item_id uuid;
  v_existing_response jsonb;
  v_next_due timestamptz;
  v_response jsonb;
BEGIN
  IF nullif(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'Work result idempotency key is required.' USING errcode='22023'; END IF;
  IF p_outcome<>ALL(ARRAY['completed','retry','failed']::text[]) THEN RAISE EXCEPTION 'Work result outcome is invalid.' USING errcode='22023'; END IF;
  SELECT * INTO v_item FROM private.relationship_campaign_work_items WHERE id=p_work_item_id FOR UPDATE;
  IF NOT found THEN RAISE EXCEPTION 'Campaign work item not found.' USING errcode='P0002'; END IF;
  SELECT operation,work_item_id,response INTO v_existing_operation,v_existing_work_item_id,v_existing_response
  FROM private.relationship_enrollment_idempotency WHERE tenant_id=v_item.tenant_id AND idempotency_key=btrim(p_idempotency_key);
  IF found THEN
    IF v_existing_operation<>'work_result' OR v_existing_work_item_id<>v_item.id THEN
      RAISE EXCEPTION 'Work result idempotency key was already used for a different operation or work item.' USING errcode='23505';
    END IF;
    RETURN v_existing_response;
  END IF;
  IF v_item.status<>'claimed' OR v_item.claim_token IS DISTINCT FROM p_claim_token THEN RAISE EXCEPTION 'Campaign work claim is no longer valid.' USING errcode='40001'; END IF;
  IF v_item.lease_expires_at<=now() THEN RAISE EXCEPTION 'Campaign work claim lease has expired.' USING errcode='40001'; END IF;
  SELECT * INTO v_campaign FROM public.relationship_campaigns WHERE tenant_id=v_item.tenant_id AND id=v_item.campaign_id;
  SELECT * INTO v_enrollment FROM public.relationship_campaign_enrollments WHERE tenant_id=v_item.tenant_id AND id=v_item.enrollment_id FOR UPDATE;
  IF NOT v_campaign.execution_enabled OR NOT v_enrollment.delivery_enabled OR v_enrollment.safety_status<>'ready' THEN
    RAISE EXCEPTION 'Campaign execution, enrollment delivery, and safety gates must all be enabled before recording work.' USING errcode='42501';
  END IF;
  IF p_outcome='completed' AND NOT EXISTS(
    SELECT 1 FROM public.relationship_communications c
    WHERE c.tenant_id=v_item.tenant_id AND c.work_item_id=v_item.id AND c.direction='outbound' AND c.status=ANY(ARRAY['sent','delivered']::text[])
  ) THEN
    RAISE EXCEPTION 'Canonical sent communication is required before campaign work can complete.' USING errcode='42501';
  END IF;
  IF p_outcome='retry' THEN
    IF v_item.attempt_count>=v_item.max_attempts THEN RAISE EXCEPTION 'Campaign work item has exhausted its retry allowance.' USING errcode='22023'; END IF;
    IF p_retry_at IS NULL OR p_retry_at<=now() THEN RAISE EXCEPTION 'A future retry time is required.' USING errcode='22023'; END IF;
    UPDATE private.relationship_campaign_work_items
    SET status='retry_wait',available_at=p_retry_at,claim_token=NULL,claimed_by=NULL,claimed_at=NULL,lease_expires_at=NULL,
      last_error_code=nullif(btrim(p_error_code),''),last_error_message=nullif(btrim(p_error_message),''),updated_at=now()
    WHERE id=v_item.id;
    INSERT INTO public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,reason,metadata)
    VALUES(v_item.tenant_id,v_item.enrollment_id,'work_retry_scheduled',nullif(btrim(p_error_message),''),
      jsonb_build_object('work_item_id',v_item.id,'retry_at',p_retry_at,'error_code',nullif(btrim(p_error_code),''),'attempt_count',v_item.attempt_count));
  ELSIF p_outcome='failed' THEN
    UPDATE private.relationship_campaign_work_items
    SET status='failed',claim_token=NULL,claimed_by=NULL,claimed_at=NULL,lease_expires_at=NULL,
      last_error_code=nullif(btrim(p_error_code),''),last_error_message=nullif(btrim(p_error_message),''),updated_at=now()
    WHERE id=v_item.id;
    UPDATE public.relationship_campaign_enrollments
    SET status='failed',delivery_enabled=false,next_scheduled_at=NULL,updated_by_profile_id=NULL WHERE id=v_enrollment.id;
    INSERT INTO public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,from_status,to_status,reason,metadata)
    VALUES(v_item.tenant_id,v_item.enrollment_id,'failed',v_enrollment.status,'failed',nullif(btrim(p_error_message),''),
      jsonb_build_object('work_item_id',v_item.id,'error_code',nullif(btrim(p_error_code),'')));
  ELSE
    UPDATE private.relationship_campaign_work_items
    SET status='completed',completed_at=now(),claim_token=NULL,claimed_by=NULL,claimed_at=NULL,lease_expires_at=NULL,
      last_error_code=NULL,last_error_message=NULL,updated_at=now()
    WHERE id=v_item.id;
    INSERT INTO public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,reason,metadata)
    VALUES(v_item.tenant_id,v_item.enrollment_id,'step_completed','Campaign step work completed after canonical send recording.',
      jsonb_build_object('work_item_id',v_item.id,'step_position',v_item.step_position));
    SELECT * INTO v_next_step FROM public.relationship_campaign_steps
    WHERE tenant_id=v_item.tenant_id AND campaign_id=v_item.campaign_id AND is_active AND position>v_item.step_position
    ORDER BY position LIMIT 1;
    IF found THEN
      v_next_due:=private.relationship_campaign_schedule_at(now(),v_campaign.default_timezone,v_campaign.weekdays_only,v_campaign.send_window_start,v_campaign.send_window_end,v_next_step.delay_days);
      INSERT INTO private.relationship_campaign_work_items(
        tenant_id,campaign_id,enrollment_id,campaign_step_id,step_position,status,due_at,available_at,idempotency_key,metadata
      ) VALUES (
        v_item.tenant_id,v_item.campaign_id,v_item.enrollment_id,v_next_step.id,v_next_step.position,'planned',v_next_due,v_next_due,
        format('enrollment:%s:step:%s',v_item.enrollment_id,v_next_step.id),jsonb_build_object('planned_after_work_item_id',v_item.id)
      ) ON CONFLICT(enrollment_id,campaign_step_id) DO NOTHING;
      UPDATE public.relationship_campaign_enrollments
      SET status='active',current_step_position=v_next_step.position,next_scheduled_at=v_next_due,updated_by_profile_id=NULL WHERE id=v_enrollment.id;
      INSERT INTO public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,reason,metadata)
      VALUES(v_item.tenant_id,v_item.enrollment_id,'work_planned','Next active campaign step planned.',jsonb_build_object('step_position',v_next_step.position,'due_at',v_next_due));
    ELSE
      UPDATE public.relationship_campaign_enrollments
      SET status='completed',delivery_enabled=false,current_step_position=NULL,next_scheduled_at=NULL,updated_by_profile_id=NULL WHERE id=v_enrollment.id;
      INSERT INTO public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,from_status,to_status,reason,metadata)
      VALUES(v_item.tenant_id,v_item.enrollment_id,'completed',v_enrollment.status,'completed','All active campaign steps completed.','{}'::jsonb);
    END IF;
  END IF;
  v_response:=jsonb_build_object('workItemId',v_item.id,'outcome',p_outcome,'enrollment',private.relationship_enrollment_json(v_item.enrollment_id));
  INSERT INTO private.relationship_enrollment_idempotency(
    tenant_id,idempotency_key,operation,campaign_id,enrollment_id,work_item_id,actor_profile_id,response
  ) VALUES(v_item.tenant_id,btrim(p_idempotency_key),'work_result',v_item.campaign_id,v_item.enrollment_id,v_item.id,NULL,v_response);
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION private.record_relationship_delivery_result(
  p_communication_id uuid,p_claim_token uuid,p_outcome text,p_idempotency_key text,
  p_provider_message_id text DEFAULT NULL,p_provider_thread_id text DEFAULT NULL,p_retry_at timestamptz DEFAULT NULL,
  p_error_code text DEFAULT NULL,p_error_message text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_comm public.relationship_communications%rowtype;
  v_item private.relationship_campaign_work_items%rowtype;
  v_existing record;
  v_work_result jsonb;
  v_response jsonb;
  v_event_id text;
BEGIN
  IF p_outcome<>ALL(ARRAY['sent','retry','failed']::text[]) THEN RAISE EXCEPTION 'Delivery result outcome is invalid.' USING errcode='22023'; END IF;
  IF nullif(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'Delivery result idempotency key is required.' USING errcode='22023'; END IF;
  SELECT * INTO v_comm FROM public.relationship_communications WHERE id=p_communication_id FOR UPDATE;
  IF NOT found OR v_comm.direction<>'outbound' OR v_comm.work_item_id IS NULL THEN
    RAISE EXCEPTION 'Outbound relationship communication not found.' USING errcode='P0002';
  END IF;
  SELECT operation,communication_id,response INTO v_existing
  FROM private.relationship_delivery_idempotency WHERE tenant_id=v_comm.tenant_id AND idempotency_key=btrim(p_idempotency_key);
  IF found THEN
    IF v_existing.operation<>'delivery_result' OR v_existing.communication_id IS DISTINCT FROM p_communication_id THEN
      RAISE EXCEPTION 'Delivery-result idempotency key was already used for another operation.' USING errcode='23505';
    END IF;
    RETURN v_existing.response;
  END IF;
  SELECT * INTO v_item FROM private.relationship_campaign_work_items WHERE tenant_id=v_comm.tenant_id AND id=v_comm.work_item_id FOR UPDATE;
  IF v_item.status<>'claimed' OR v_item.claim_token IS DISTINCT FROM p_claim_token OR v_item.lease_expires_at<=now() THEN
    RAISE EXCEPTION 'Campaign work claim is no longer valid.' USING errcode='40001';
  END IF;
  IF p_outcome='sent' THEN
    IF nullif(btrim(p_provider_message_id),'') IS NULL THEN RAISE EXCEPTION 'Provider message ID is required for a sent result.' USING errcode='22023'; END IF;
    UPDATE public.relationship_communications
    SET status='sent',provider='resend',provider_message_id=btrim(p_provider_message_id),provider_thread_id=nullif(btrim(p_provider_thread_id),''),
      sent_at=now(),occurred_at=now(),failed_at=NULL,error_code=NULL,error_message=NULL WHERE id=v_comm.id;
    v_event_id:='send:'||btrim(p_provider_message_id);
    INSERT INTO public.relationship_communication_events(tenant_id,communication_id,provider,provider_event_id,event_type,occurred_at,payload)
    VALUES(v_comm.tenant_id,v_comm.id,'resend',v_event_id,'email.sent',now(),jsonb_build_object('provider_message_id',btrim(p_provider_message_id)))
    ON CONFLICT DO NOTHING;
    INSERT INTO public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,reason,metadata)
    VALUES(v_comm.tenant_id,v_comm.enrollment_id,'communication_sent','Provider accepted the outbound relationship email.',
      jsonb_build_object('communication_id',v_comm.id,'provider_message_id',btrim(p_provider_message_id)));
    INSERT INTO public.relationship_interactions(tenant_id,organization_id,contact_id,opportunity_id,interaction_type,occurred_at,summary,metadata)
    VALUES(v_comm.tenant_id,v_comm.organization_id,v_comm.contact_id,v_comm.opportunity_id,'outbound_email',now(),
      coalesce(v_comm.subject,'Relationship outreach email sent.'),jsonb_build_object('communication_id',v_comm.id,'campaign_id',v_comm.campaign_id,'enrollment_id',v_comm.enrollment_id));
    v_work_result:=private.record_relationship_campaign_work_result(v_item.id,p_claim_token,'completed',btrim(p_idempotency_key)||':work',NULL,NULL,NULL);
  ELSE
    UPDATE public.relationship_communications
    SET status='failed',failed_at=now(),error_code=nullif(btrim(p_error_code),''),error_message=nullif(btrim(p_error_message),'') WHERE id=v_comm.id;
    INSERT INTO public.relationship_communication_events(tenant_id,communication_id,provider,event_type,occurred_at,payload)
    VALUES(v_comm.tenant_id,v_comm.id,'resend',CASE WHEN p_outcome='retry' THEN 'email.retry_scheduled' ELSE 'email.failed' END,now(),
      jsonb_build_object('error_code',nullif(btrim(p_error_code),''),'error_message',nullif(btrim(p_error_message),''),'retry_at',p_retry_at));
    INSERT INTO public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,reason,metadata)
    VALUES(v_comm.tenant_id,v_comm.enrollment_id,'communication_failed',coalesce(nullif(btrim(p_error_message),''),'Provider delivery failed.'),
      jsonb_build_object('communication_id',v_comm.id,'retry_at',p_retry_at,'error_code',nullif(btrim(p_error_code),'')));
    v_work_result:=private.record_relationship_campaign_work_result(
      v_item.id,p_claim_token,CASE WHEN p_outcome='retry' THEN 'retry' ELSE 'failed' END,
      btrim(p_idempotency_key)||':work',p_retry_at,p_error_code,p_error_message
    );
  END IF;
  v_response:=jsonb_build_object('communication',private.relationship_communication_json(v_comm.id),'workResult',v_work_result,'outcome',p_outcome);
  INSERT INTO private.relationship_delivery_idempotency(tenant_id,idempotency_key,operation,work_item_id,communication_id,response)
  VALUES(v_comm.tenant_id,btrim(p_idempotency_key),'delivery_result',v_item.id,v_comm.id,v_response);
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_relationship_campaign_work(p_worker_id text,p_limit integer DEFAULT 10,p_lease_seconds integer DEFAULT 300)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $function$
SELECT private.claim_relationship_campaign_work(p_worker_id,p_limit,p_lease_seconds);
$function$;
CREATE OR REPLACE FUNCTION public.prepare_relationship_campaign_delivery(p_work_item_id uuid,p_claim_token uuid,p_idempotency_key text,p_unsubscribe_base_url text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $function$
SELECT private.prepare_relationship_campaign_delivery(p_work_item_id,p_claim_token,p_idempotency_key,p_unsubscribe_base_url);
$function$;
CREATE OR REPLACE FUNCTION public.record_relationship_delivery_result(
  p_communication_id uuid,p_claim_token uuid,p_outcome text,p_idempotency_key text,
  p_provider_message_id text DEFAULT NULL,p_provider_thread_id text DEFAULT NULL,p_retry_at timestamptz DEFAULT NULL,
  p_error_code text DEFAULT NULL,p_error_message text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $function$
SELECT private.record_relationship_delivery_result(
  p_communication_id,p_claim_token,p_outcome,p_idempotency_key,p_provider_message_id,p_provider_thread_id,p_retry_at,p_error_code,p_error_message
);
$function$;

REVOKE ALL ON FUNCTION private.render_relationship_text(text,jsonb,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.prepare_relationship_campaign_delivery(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.record_relationship_delivery_result(uuid,uuid,text,text,text,text,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.record_relationship_campaign_work_result(uuid,uuid,text,text,timestamptz,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.claim_relationship_campaign_work(text,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.prepare_relationship_campaign_delivery(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_relationship_delivery_result(uuid,uuid,text,text,text,text,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_relationship_campaign_work(text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_relationship_campaign_delivery(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_relationship_delivery_result(uuid,uuid,text,text,text,text,timestamptz,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION private.prepare_relationship_campaign_delivery(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION private.record_relationship_delivery_result(uuid,uuid,text,text,text,text,timestamptz,text,text) TO service_role;
