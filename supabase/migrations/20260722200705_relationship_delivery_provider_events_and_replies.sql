-- Pass 12: provider event ingestion, bounce/complaint suppression, inbound matching, reply workflow, and stop-on-reply.

CREATE OR REPLACE FUNCTION private.ingest_relationship_provider_event(
  p_provider text,p_provider_event_id text,p_event_type text,p_provider_message_id text,
  p_occurred_at timestamptz,p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_comm public.relationship_communications%rowtype;
  v_existing_event public.relationship_communication_events%rowtype;
  v_reason text;
  v_suppression_id uuid;
BEGIN
  IF lower(btrim(p_provider))<>'resend' THEN RAISE EXCEPTION 'Unsupported relationship delivery provider.' USING errcode='22023'; END IF;
  IF nullif(btrim(p_provider_event_id),'') IS NULL OR nullif(btrim(p_provider_message_id),'') IS NULL THEN
    RAISE EXCEPTION 'Provider event and message IDs are required.' USING errcode='22023';
  END IF;
  SELECT * INTO v_existing_event FROM public.relationship_communication_events
  WHERE provider='resend' AND provider_event_id=btrim(p_provider_event_id);
  IF found THEN
    RETURN jsonb_build_object('replayed',true,'matched',true,'communication',private.relationship_communication_json(v_existing_event.communication_id));
  END IF;
  SELECT * INTO v_comm FROM public.relationship_communications
  WHERE provider='resend' AND provider_message_id=btrim(p_provider_message_id) FOR UPDATE;
  IF NOT found THEN RETURN jsonb_build_object('replayed',false,'matched',false,'providerEventId',btrim(p_provider_event_id)); END IF;
  INSERT INTO public.relationship_communication_events(tenant_id,communication_id,provider,provider_event_id,event_type,occurred_at,payload)
  VALUES(v_comm.tenant_id,v_comm.id,'resend',btrim(p_provider_event_id),btrim(p_event_type),coalesce(p_occurred_at,now()),coalesce(p_payload,'{}'::jsonb));
  IF p_event_type='email.delivered' THEN
    UPDATE public.relationship_communications
    SET status='delivered',delivered_at=coalesce(p_occurred_at,now()),occurred_at=coalesce(sent_at,occurred_at),error_code=NULL,error_message=NULL
    WHERE id=v_comm.id;
    INSERT INTO public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,reason,metadata)
    VALUES(v_comm.tenant_id,v_comm.enrollment_id,'communication_delivered','Provider confirmed relationship email delivery.',
      jsonb_build_object('communication_id',v_comm.id,'provider_event_id',p_provider_event_id));
  ELSIF p_event_type=ANY(ARRAY['email.bounced','email.complained']::text[]) THEN
    v_reason:=CASE WHEN p_event_type='email.complained' THEN 'complaint' ELSE 'bounce' END;
    UPDATE public.relationship_communications
    SET status='bounced',failed_at=coalesce(p_occurred_at,now()),error_code=v_reason,
      error_message=CASE WHEN v_reason='complaint' THEN 'Recipient reported the message as spam or unwanted.' ELSE 'Provider reported a delivery bounce.' END
    WHERE id=v_comm.id;
    SELECT id INTO v_suppression_id FROM public.relationship_suppressions
    WHERE tenant_id=v_comm.tenant_id AND scope='email' AND lower(email)=lower(v_comm.recipient_email)
      AND reason=v_reason AND revoked_at IS NULL AND effective_at<=now() AND (expires_at IS NULL OR expires_at>now()) LIMIT 1;
    IF v_suppression_id IS NULL THEN
      INSERT INTO public.relationship_suppressions(tenant_id,scope,reason,email,effective_at,source,source_record_key,metadata)
      VALUES(v_comm.tenant_id,'email',v_reason,lower(v_comm.recipient_email),now(),'relationship_delivery',p_provider_event_id,
        jsonb_build_object('communication_id',v_comm.id,'provider','resend')) RETURNING id INTO v_suppression_id;
    END IF;
    IF v_comm.enrollment_id IS NOT NULL THEN
      PERFORM private.revalidate_relationship_enrollment(v_comm.tenant_id,v_comm.enrollment_id,NULL,'Provider delivery event created an email suppression.');
    END IF;
    INSERT INTO public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,reason,metadata)
    VALUES(v_comm.tenant_id,v_comm.enrollment_id,'communication_bounced',
      CASE WHEN v_reason='complaint' THEN 'Recipient complaint stopped future relationship outreach.' ELSE 'Delivery bounce stopped future relationship outreach.' END,
      jsonb_build_object('communication_id',v_comm.id,'suppression_id',v_suppression_id,'provider_event_id',p_provider_event_id));
  ELSIF p_event_type=ANY(ARRAY['email.failed','email.suppressed']::text[]) THEN
    UPDATE public.relationship_communications
    SET status='failed',failed_at=coalesce(p_occurred_at,now()),error_code=p_event_type,error_message='Provider reported a terminal delivery failure.'
    WHERE id=v_comm.id;
    INSERT INTO public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,reason,metadata)
    VALUES(v_comm.tenant_id,v_comm.enrollment_id,'communication_failed','Provider reported a terminal relationship-email failure.',
      jsonb_build_object('communication_id',v_comm.id,'provider_event_id',p_provider_event_id,'provider_event_type',p_event_type));
  END IF;
  RETURN jsonb_build_object('replayed',false,'matched',true,'communication',private.relationship_communication_json(v_comm.id));
END;
$function$;

CREATE OR REPLACE FUNCTION private.ingest_relationship_inbound_reply(
  p_provider text,p_provider_event_id text,p_provider_message_id text,p_provider_thread_id text,
  p_outbound_communication_id uuid,p_in_reply_to_provider_message_id text,p_from_email text,p_to_email text,
  p_subject text,p_body text,p_occurred_at timestamptz,p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_outbound public.relationship_communications%rowtype;
  v_inbound public.relationship_communications%rowtype;
  v_reply_id uuid;
  v_existing_event public.relationship_communication_events%rowtype;
  v_stop boolean:=true;
  v_enrollment public.relationship_campaign_enrollments%rowtype;
BEGIN
  IF lower(btrim(p_provider))<>'resend' THEN RAISE EXCEPTION 'Unsupported relationship inbound provider.' USING errcode='22023'; END IF;
  IF nullif(btrim(p_provider_event_id),'') IS NULL OR nullif(btrim(p_provider_message_id),'') IS NULL THEN
    RAISE EXCEPTION 'Inbound provider event and message IDs are required.' USING errcode='22023';
  END IF;
  IF lower(btrim(p_from_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR lower(btrim(p_to_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Valid inbound sender and recipient emails are required.' USING errcode='22023';
  END IF;
  IF length(coalesce(p_body,''))>1048576 THEN RAISE EXCEPTION 'Inbound reply body exceeds the supported size.' USING errcode='22023'; END IF;

  SELECT * INTO v_existing_event FROM public.relationship_communication_events
  WHERE provider='resend' AND provider_event_id=btrim(p_provider_event_id);
  IF found THEN
    SELECT r.id INTO v_reply_id FROM public.relationship_replies r
    WHERE r.tenant_id=v_existing_event.tenant_id AND r.communication_id=v_existing_event.communication_id;
    RETURN jsonb_build_object('replayed',true,'matched',v_reply_id IS NOT NULL,
      'reply',CASE WHEN v_reply_id IS NULL THEN NULL ELSE private.relationship_reply_json(v_reply_id) END);
  END IF;

  IF p_outbound_communication_id IS NOT NULL THEN
    SELECT * INTO v_outbound FROM public.relationship_communications c
    WHERE c.id=p_outbound_communication_id AND c.direction='outbound' AND lower(c.recipient_email)=lower(btrim(p_from_email));
  END IF;
  IF NOT found AND nullif(btrim(p_in_reply_to_provider_message_id),'') IS NOT NULL THEN
    SELECT * INTO v_outbound FROM public.relationship_communications c
    WHERE c.provider='resend' AND c.provider_message_id=btrim(p_in_reply_to_provider_message_id)
      AND c.direction='outbound' AND lower(c.recipient_email)=lower(btrim(p_from_email));
  END IF;
  IF NOT found AND nullif(btrim(p_provider_thread_id),'') IS NOT NULL THEN
    SELECT c.* INTO v_outbound FROM public.relationship_communications c
    JOIN private.relationship_delivery_provider_configs cfg ON cfg.tenant_id=c.tenant_id AND cfg.provider='resend'
      AND lower(cfg.inbound_address)=lower(btrim(p_to_email))
    WHERE c.provider='resend' AND c.provider_thread_id=btrim(p_provider_thread_id)
      AND c.direction='outbound' AND lower(c.recipient_email)=lower(btrim(p_from_email))
    ORDER BY c.sent_at DESC NULLS LAST LIMIT 1;
  END IF;
  IF NOT found THEN
    SELECT c.* INTO v_outbound FROM public.relationship_communications c
    JOIN private.relationship_delivery_provider_configs cfg ON cfg.tenant_id=c.tenant_id AND cfg.provider='resend'
      AND lower(cfg.inbound_address)=lower(btrim(p_to_email))
    WHERE c.provider='resend' AND c.direction='outbound' AND c.status=ANY(ARRAY['sent','delivered']::text[])
      AND lower(c.recipient_email)=lower(btrim(p_from_email))
    ORDER BY c.sent_at DESC NULLS LAST,c.created_at DESC LIMIT 1;
  END IF;
  IF NOT found THEN RETURN jsonb_build_object('replayed',false,'matched',false,'providerEventId',btrim(p_provider_event_id)); END IF;

  SELECT * INTO v_inbound FROM public.relationship_communications
  WHERE provider='resend' AND provider_message_id=btrim(p_provider_message_id);
  IF NOT found THEN
    INSERT INTO public.relationship_communications(
      tenant_id,campaign_id,campaign_step_id,enrollment_id,organization_id,contact_id,opportunity_id,
      direction,channel,status,sender_email,recipient_email,subject,rendered_body,provider,provider_message_id,
      provider_thread_id,occurred_at,metadata
    ) VALUES (
      v_outbound.tenant_id,v_outbound.campaign_id,v_outbound.campaign_step_id,v_outbound.enrollment_id,
      v_outbound.organization_id,v_outbound.contact_id,v_outbound.opportunity_id,'inbound','email','received',
      lower(btrim(p_from_email)),lower(btrim(p_to_email)),nullif(p_subject,''),coalesce(p_body,''),'resend',
      btrim(p_provider_message_id),nullif(btrim(p_provider_thread_id),''),coalesce(p_occurred_at,now()),
      jsonb_build_object('in_reply_to_communication_id',v_outbound.id)
    ) RETURNING * INTO v_inbound;
  END IF;

  INSERT INTO public.relationship_communication_events(tenant_id,communication_id,provider,provider_event_id,event_type,occurred_at,payload)
  VALUES(v_inbound.tenant_id,v_inbound.id,'resend',btrim(p_provider_event_id),'email.received',coalesce(p_occurred_at,now()),coalesce(p_payload,'{}'::jsonb))
  ON CONFLICT(provider,provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING;

  INSERT INTO public.relationship_replies(tenant_id,communication_id,enrollment_id,organization_id,contact_id,opportunity_id,status,metadata)
  VALUES(v_inbound.tenant_id,v_inbound.id,v_inbound.enrollment_id,v_inbound.organization_id,v_inbound.contact_id,v_inbound.opportunity_id,
    'new',jsonb_build_object('outbound_communication_id',v_outbound.id))
  ON CONFLICT(communication_id) DO UPDATE SET updated_at=public.relationship_replies.updated_at
  RETURNING id INTO v_reply_id;

  SELECT stop_on_reply INTO v_stop FROM public.relationship_campaign_steps
  WHERE tenant_id=v_outbound.tenant_id AND id=v_outbound.campaign_step_id;
  IF coalesce(v_stop,true) AND v_outbound.enrollment_id IS NOT NULL THEN
    SELECT * INTO v_enrollment FROM public.relationship_campaign_enrollments
    WHERE tenant_id=v_outbound.tenant_id AND id=v_outbound.enrollment_id FOR UPDATE;
    IF found AND v_enrollment.status=ANY(ARRAY['pending','active','paused']::text[]) THEN
      UPDATE public.relationship_campaign_enrollments
      SET status='responded',responded_at=coalesce(p_occurred_at,now()),delivery_enabled=false,next_scheduled_at=NULL,updated_by_profile_id=NULL
      WHERE id=v_enrollment.id;
      UPDATE private.relationship_campaign_work_items
      SET status='cancelled',claim_token=NULL,claimed_by=NULL,claimed_at=NULL,lease_expires_at=NULL,updated_at=now(),
        metadata=metadata||jsonb_build_object('cancelled_by_reply_id',v_reply_id)
      WHERE tenant_id=v_outbound.tenant_id AND enrollment_id=v_enrollment.id
        AND status=ANY(ARRAY['planned','retry_wait','claimed']::text[]);
      INSERT INTO public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,from_status,to_status,reason,metadata)
      VALUES(v_outbound.tenant_id,v_enrollment.id,'reply_received',v_enrollment.status,'responded',
        'Inbound reply stopped remaining relationship campaign work.',
        jsonb_build_object('reply_id',v_reply_id,'communication_id',v_inbound.id,'outbound_communication_id',v_outbound.id));
    END IF;
  ELSE
    INSERT INTO public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,reason,metadata)
    SELECT v_outbound.tenant_id,v_outbound.enrollment_id,'reply_received',
      'Inbound reply recorded; campaign step did not require automatic stop.',jsonb_build_object('reply_id',v_reply_id,'communication_id',v_inbound.id)
    WHERE v_outbound.enrollment_id IS NOT NULL;
  END IF;

  INSERT INTO public.relationship_interactions(tenant_id,organization_id,contact_id,opportunity_id,interaction_type,occurred_at,summary,metadata)
  VALUES(v_outbound.tenant_id,v_outbound.organization_id,v_outbound.contact_id,v_outbound.opportunity_id,'inbound_reply',coalesce(p_occurred_at,now()),
    coalesce(nullif(p_subject,''),'Inbound relationship reply received.'),
    jsonb_build_object('reply_id',v_reply_id,'communication_id',v_inbound.id,'campaign_id',v_outbound.campaign_id,'enrollment_id',v_outbound.enrollment_id));

  RETURN jsonb_build_object('replayed',false,'matched',true,'stoppedEnrollment',coalesce(v_stop,true),'reply',private.relationship_reply_json(v_reply_id));
END;
$function$;

CREATE OR REPLACE FUNCTION private.update_relationship_reply(
  p_reply_id uuid,p_expected_version bigint,p_status text,p_owner_profile_id uuid,p_follow_up_due_at timestamptz,
  p_idempotency_key text,p_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_context jsonb:=private.relationship_campaign_context(true);
  v_actor uuid:=(v_context->>'actor_id')::uuid;
  v_tenant uuid:=(v_context->>'tenant_id')::uuid;
  v_reply public.relationship_replies%rowtype;
  v_existing record;
  v_response jsonb;
BEGIN
  IF nullif(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'Reply update idempotency key is required.' USING errcode='22023'; END IF;
  IF p_status IS NOT NULL AND p_status<>ALL(ARRAY['new','needs_action','in_progress','resolved']::text[]) THEN
    RAISE EXCEPTION 'Reply status is invalid.' USING errcode='22023';
  END IF;
  SELECT operation,reply_id,response INTO v_existing
  FROM private.relationship_delivery_idempotency WHERE tenant_id=v_tenant AND idempotency_key=btrim(p_idempotency_key);
  IF found THEN
    IF v_existing.operation<>'reply_update' OR v_existing.reply_id IS DISTINCT FROM p_reply_id THEN
      RAISE EXCEPTION 'Reply idempotency key was already used for another operation.' USING errcode='23505';
    END IF;
    RETURN v_existing.response;
  END IF;
  SELECT * INTO v_reply FROM public.relationship_replies WHERE tenant_id=v_tenant AND id=p_reply_id FOR UPDATE;
  IF NOT found THEN RAISE EXCEPTION 'Relationship reply not found.' USING errcode='P0002'; END IF;
  IF p_expected_version IS NULL OR p_expected_version<>v_reply.version THEN
    RAISE EXCEPTION 'Reply changed after it was loaded. Refresh and retry.' USING errcode='40001';
  END IF;
  IF p_owner_profile_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.crm_user_capabilities c
    WHERE c.tenant_id=v_tenant AND c.profile_id=p_owner_profile_id AND c.crm_role<>'crm_none'::public.crm_capability_role
  ) THEN RAISE EXCEPTION 'Reply owner is not an active CRM user for this tenant.' USING errcode='22023'; END IF;
  UPDATE public.relationship_replies
  SET status=coalesce(p_status,status),owner_profile_id=p_owner_profile_id,follow_up_due_at=p_follow_up_due_at,
    resolved_at=CASE WHEN coalesce(p_status,status)='resolved' THEN coalesce(resolved_at,now()) ELSE NULL END,
    updated_by_profile_id=v_actor
  WHERE id=v_reply.id RETURNING * INTO v_reply;
  INSERT INTO public.relationship_communication_events(tenant_id,communication_id,provider,event_type,occurred_at,payload)
  VALUES(v_tenant,v_reply.communication_id,'crm','reply.workflow_updated',now(),
    jsonb_build_object('reply_id',v_reply.id,'status',v_reply.status,'owner_profile_id',v_reply.owner_profile_id,
      'follow_up_due_at',v_reply.follow_up_due_at,'reason',nullif(btrim(p_reason),''),'actor_id',v_actor));
  v_response:=private.relationship_reply_json(v_reply.id);
  INSERT INTO private.relationship_delivery_idempotency(tenant_id,idempotency_key,operation,reply_id,response)
  VALUES(v_tenant,btrim(p_idempotency_key),'reply_update',v_reply.id,v_response);
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ingest_relationship_provider_event(
  p_provider text,p_provider_event_id text,p_event_type text,p_provider_message_id text,
  p_occurred_at timestamptz,p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $function$
SELECT private.ingest_relationship_provider_event(p_provider,p_provider_event_id,p_event_type,p_provider_message_id,p_occurred_at,p_payload);
$function$;
CREATE OR REPLACE FUNCTION public.ingest_relationship_inbound_reply(
  p_provider text,p_provider_event_id text,p_provider_message_id text,p_provider_thread_id text,
  p_outbound_communication_id uuid,p_in_reply_to_provider_message_id text,p_from_email text,p_to_email text,
  p_subject text,p_body text,p_occurred_at timestamptz,p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $function$
SELECT private.ingest_relationship_inbound_reply(
  p_provider,p_provider_event_id,p_provider_message_id,p_provider_thread_id,p_outbound_communication_id,
  p_in_reply_to_provider_message_id,p_from_email,p_to_email,p_subject,p_body,p_occurred_at,p_payload
);
$function$;
CREATE OR REPLACE FUNCTION public.update_relationship_reply(
  p_reply_id uuid,p_expected_version bigint,p_status text DEFAULT NULL,p_owner_profile_id uuid DEFAULT NULL,
  p_follow_up_due_at timestamptz DEFAULT NULL,p_idempotency_key text DEFAULT NULL,p_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $function$
SELECT private.update_relationship_reply(p_reply_id,p_expected_version,p_status,p_owner_profile_id,p_follow_up_due_at,p_idempotency_key,p_reason);
$function$;

REVOKE ALL ON FUNCTION private.ingest_relationship_provider_event(text,text,text,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.ingest_relationship_inbound_reply(text,text,text,text,uuid,text,text,text,text,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.update_relationship_reply(uuid,bigint,text,uuid,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ingest_relationship_provider_event(text,text,text,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ingest_relationship_inbound_reply(text,text,text,text,uuid,text,text,text,text,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_relationship_reply(uuid,bigint,text,uuid,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_relationship_provider_event(text,text,text,text,timestamptz,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.ingest_relationship_inbound_reply(text,text,text,text,uuid,text,text,text,text,text,timestamptz,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_relationship_reply(uuid,bigint,text,uuid,timestamptz,text,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.ingest_relationship_provider_event(text,text,text,text,timestamptz,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.ingest_relationship_inbound_reply(text,text,text,text,uuid,text,text,text,text,text,timestamptz,jsonb) TO service_role;
