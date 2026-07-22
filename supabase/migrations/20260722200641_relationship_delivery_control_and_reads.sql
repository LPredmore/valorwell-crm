-- Pass 12: provider readiness, controlled activation, canonical JSON, and tenant-scoped read RPCs.

CREATE OR REPLACE FUNCTION private.relationship_communication_json(p_communication_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
SELECT jsonb_build_object(
  'id',c.id,'workItemId',c.work_item_id,'campaignId',c.campaign_id,'campaignStepId',c.campaign_step_id,
  'enrollmentId',c.enrollment_id,'organizationId',c.organization_id,'contactId',c.contact_id,'opportunityId',c.opportunity_id,
  'direction',c.direction,'channel',c.channel,'status',c.status,'senderEmail',c.sender_email,'recipientEmail',c.recipient_email,
  'subject',c.subject,'renderedBody',c.rendered_body,'provider',c.provider,'providerMessageId',c.provider_message_id,
  'providerThreadId',c.provider_thread_id,'occurredAt',c.occurred_at,'scheduledFor',c.scheduled_for,'sentAt',c.sent_at,
  'deliveredAt',c.delivered_at,'failedAt',c.failed_at,'errorCode',c.error_code,'errorMessage',c.error_message,
  'metadata',c.metadata,'createdAt',c.created_at,'updatedAt',c.updated_at,'createdBy',c.created_by_profile_id,'updatedBy',c.updated_by_profile_id
) FROM public.relationship_communications c WHERE c.id=p_communication_id;
$function$;

CREATE OR REPLACE FUNCTION private.relationship_reply_json(p_reply_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
SELECT jsonb_build_object(
  'id',r.id,'communicationLogId',r.communication_id,'enrollmentId',r.enrollment_id,'organizationId',r.organization_id,
  'contactId',r.contact_id,'opportunityId',r.opportunity_id,'ownerId',r.owner_profile_id,'status',r.status,
  'followUpDueAt',r.follow_up_due_at,'resolvedAt',r.resolved_at,'version',r.version,'metadata',r.metadata,
  'receivedAt',c.occurred_at,'subject',c.subject,'body',c.rendered_body,'senderEmail',c.sender_email,'recipientEmail',c.recipient_email,
  'createdAt',r.created_at,'updatedAt',r.updated_at,'createdBy',r.created_by_profile_id,'updatedBy',r.updated_by_profile_id
) FROM public.relationship_replies r
JOIN public.relationship_communications c ON c.tenant_id=r.tenant_id AND c.id=r.communication_id
WHERE r.id=p_reply_id;
$function$;

CREATE OR REPLACE FUNCTION private.relationship_delivery_readiness(p_tenant_id uuid,p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_campaign public.relationship_campaigns%rowtype;
  v_config private.relationship_delivery_provider_configs%rowtype;
  v_config_present boolean:=false;
  v_reasons text[]:='{}';
BEGIN
  SELECT * INTO v_campaign FROM public.relationship_campaigns WHERE tenant_id=p_tenant_id AND id=p_campaign_id;
  IF NOT found THEN
    RETURN jsonb_build_object('ready',false,'reasons',jsonb_build_array('campaign_not_found'),'campaignId',p_campaign_id,'executionEnabled',false,'provider','resend','providerStatus','disabled');
  END IF;
  SELECT * INTO v_config FROM private.relationship_delivery_provider_configs WHERE tenant_id=p_tenant_id AND provider='resend';
  v_config_present:=found;
  IF NOT v_config_present THEN
    v_reasons:=array_append(v_reasons,'provider_not_configured');
  ELSE
    IF v_config.status<>'ready' THEN v_reasons:=array_append(v_reasons,'provider_not_ready'); END IF;
    IF v_config.sender_email IS NULL OR lower(v_config.sender_email)<>lower(v_campaign.sender_email) THEN v_reasons:=array_append(v_reasons,'sender_not_verified'); END IF;
    IF v_config.inbound_address IS NULL THEN v_reasons:=array_append(v_reasons,'inbound_address_not_verified'); END IF;
    IF nullif(btrim(v_config.postal_address),'') IS NULL THEN v_reasons:=array_append(v_reasons,'postal_address_missing'); END IF;
    IF v_config.webhook_verified_at IS NULL THEN v_reasons:=array_append(v_reasons,'webhook_not_verified'); END IF;
    IF v_config.worker_verified_at IS NULL THEN v_reasons:=array_append(v_reasons,'worker_not_verified'); END IF;
  END IF;
  IF v_campaign.status<>'active' THEN v_reasons:=array_append(v_reasons,'campaign_not_active'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.relationship_campaign_steps s WHERE s.tenant_id=p_tenant_id AND s.campaign_id=p_campaign_id AND s.is_active) THEN
    v_reasons:=array_append(v_reasons,'no_active_steps');
  END IF;
  RETURN jsonb_build_object(
    'ready',cardinality(v_reasons)=0,'reasons',to_jsonb(v_reasons),'campaignId',p_campaign_id,
    'executionEnabled',v_campaign.execution_enabled,'provider','resend',
    'providerStatus',CASE WHEN v_config_present THEN v_config.status ELSE 'disabled' END,
    'senderEmail',CASE WHEN v_config_present THEN v_config.sender_email ELSE NULL END,
    'inboundAddress',CASE WHEN v_config_present THEN v_config.inbound_address ELSE NULL END,
    'webhookEndpoint',CASE WHEN v_config_present THEN v_config.webhook_endpoint ELSE NULL END,
    'lastVerifiedAt',CASE WHEN v_config_present THEN v_config.last_verified_at ELSE NULL END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.set_relationship_delivery_provider_config(p_tenant_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_provider text:=coalesce(nullif(lower(btrim(p_payload->>'provider')),''),'resend');
  v_status text:=coalesce(nullif(lower(btrim(p_payload->>'status')),''),'disabled');
  v_row private.relationship_delivery_provider_configs%rowtype;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=p_tenant_id) THEN RAISE EXCEPTION 'Tenant not found.' USING errcode='P0002'; END IF;
  INSERT INTO private.relationship_delivery_provider_configs(
    tenant_id,provider,status,sender_email,inbound_address,postal_address,webhook_endpoint,
    outbound_verified_at,inbound_verified_at,webhook_verified_at,worker_verified_at,last_verified_at,metadata
  ) VALUES (
    p_tenant_id,v_provider,v_status,nullif(lower(btrim(p_payload->>'senderEmail')),''),nullif(lower(btrim(p_payload->>'inboundAddress')),''),
    nullif(btrim(p_payload->>'postalAddress'),''),nullif(btrim(p_payload->>'webhookEndpoint'),''),
    nullif(p_payload->>'outboundVerifiedAt','')::timestamptz,nullif(p_payload->>'inboundVerifiedAt','')::timestamptz,
    nullif(p_payload->>'webhookVerifiedAt','')::timestamptz,nullif(p_payload->>'workerVerifiedAt','')::timestamptz,
    coalesce(nullif(p_payload->>'lastVerifiedAt','')::timestamptz,now()),coalesce(p_payload->'metadata','{}'::jsonb)
  ) ON CONFLICT (tenant_id,provider) DO UPDATE SET
    status=excluded.status,sender_email=excluded.sender_email,inbound_address=excluded.inbound_address,
    postal_address=excluded.postal_address,webhook_endpoint=excluded.webhook_endpoint,
    outbound_verified_at=excluded.outbound_verified_at,inbound_verified_at=excluded.inbound_verified_at,
    webhook_verified_at=excluded.webhook_verified_at,worker_verified_at=excluded.worker_verified_at,
    last_verified_at=excluded.last_verified_at,metadata=excluded.metadata
  RETURNING * INTO v_row;
  IF v_row.status<>'ready' THEN
    UPDATE public.relationship_campaigns SET execution_enabled=false WHERE tenant_id=p_tenant_id AND execution_enabled;
    UPDATE public.relationship_campaign_enrollments SET delivery_enabled=false WHERE tenant_id=p_tenant_id AND delivery_enabled;
  END IF;
  RETURN jsonb_build_object(
    'tenantId',v_row.tenant_id,'provider',v_row.provider,'status',v_row.status,'senderEmail',v_row.sender_email,
    'inboundAddress',v_row.inbound_address,'postalAddress',v_row.postal_address,'webhookEndpoint',v_row.webhook_endpoint,
    'outboundVerifiedAt',v_row.outbound_verified_at,'inboundVerifiedAt',v_row.inbound_verified_at,
    'webhookVerifiedAt',v_row.webhook_verified_at,'workerVerifiedAt',v_row.worker_verified_at,
    'lastVerifiedAt',v_row.last_verified_at,'metadata',v_row.metadata
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.set_relationship_campaign_execution(
  p_campaign_id uuid,p_expected_version bigint,p_enabled boolean,p_idempotency_key text,p_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_context jsonb:=private.relationship_campaign_context(true);
  v_actor uuid:=(v_context->>'actor_id')::uuid;
  v_tenant uuid:=(v_context->>'tenant_id')::uuid;
  v_campaign public.relationship_campaigns%rowtype;
  v_readiness jsonb;
  v_existing record;
  v_response jsonb;
BEGIN
  IF nullif(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'Execution idempotency key is required.' USING errcode='22023'; END IF;
  SELECT operation,campaign_id,response INTO v_existing
  FROM private.relationship_delivery_idempotency WHERE tenant_id=v_tenant AND idempotency_key=btrim(p_idempotency_key);
  IF found THEN
    IF v_existing.operation<>'execution' OR v_existing.campaign_id IS DISTINCT FROM p_campaign_id THEN
      RAISE EXCEPTION 'Execution idempotency key was already used for another operation.' USING errcode='23505';
    END IF;
    RETURN v_existing.response;
  END IF;
  SELECT * INTO v_campaign FROM public.relationship_campaigns WHERE tenant_id=v_tenant AND id=p_campaign_id FOR UPDATE;
  IF NOT found THEN RAISE EXCEPTION 'Relationship campaign not found.' USING errcode='P0002'; END IF;
  IF p_expected_version IS NULL OR p_expected_version<>v_campaign.version THEN
    RAISE EXCEPTION 'Campaign changed after it was loaded. Refresh and retry.' USING errcode='40001';
  END IF;
  IF p_enabled THEN
    v_readiness:=private.relationship_delivery_readiness(v_tenant,p_campaign_id);
    IF coalesce((v_readiness->>'ready')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Campaign delivery is not ready: %',coalesce(v_readiness->'reasons','[]'::jsonb)::text USING errcode='22023';
    END IF;
  END IF;
  PERFORM set_config('app.relationship_delivery_activation','allowed',true);
  UPDATE public.relationship_campaigns
  SET execution_enabled=p_enabled,version=version+1,updated_by_profile_id=v_actor
  WHERE tenant_id=v_tenant AND id=p_campaign_id RETURNING * INTO v_campaign;
  IF p_enabled THEN
    UPDATE public.relationship_campaign_enrollments
    SET delivery_enabled=true,updated_by_profile_id=v_actor
    WHERE tenant_id=v_tenant AND campaign_id=p_campaign_id
      AND status=ANY(ARRAY['pending','active']::text[]) AND safety_status='ready';
  ELSE
    UPDATE public.relationship_campaign_enrollments
    SET delivery_enabled=false,updated_by_profile_id=v_actor
    WHERE tenant_id=v_tenant AND campaign_id=p_campaign_id AND delivery_enabled;
  END IF;
  INSERT INTO public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,reason,actor_profile_id,metadata)
  SELECT v_tenant,e.id,CASE WHEN p_enabled THEN 'delivery_enabled' ELSE 'delivery_disabled' END,
    coalesce(nullif(btrim(p_reason),''),CASE WHEN p_enabled THEN 'Controlled campaign delivery enabled.' ELSE 'Campaign delivery disabled.' END),
    v_actor,jsonb_build_object('campaign_id',p_campaign_id,'execution_enabled',p_enabled)
  FROM public.relationship_campaign_enrollments e WHERE e.tenant_id=v_tenant AND e.campaign_id=p_campaign_id;
  v_response:=jsonb_build_object(
    'campaignId',p_campaign_id,'executionEnabled',p_enabled,'version',v_campaign.version,
    'readiness',private.relationship_delivery_readiness(v_tenant,p_campaign_id)
  );
  INSERT INTO private.relationship_delivery_idempotency(tenant_id,idempotency_key,operation,campaign_id,response)
  VALUES(v_tenant,btrim(p_idempotency_key),'execution',p_campaign_id,v_response);
  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION private.list_relationship_communications(p_subject jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_context jsonb:=private.relationship_campaign_context(false);
  v_tenant uuid:=(v_context->>'tenant_id')::uuid;
  v_organization uuid:=nullif(p_subject->>'organizationId','')::uuid;
  v_contact uuid:=nullif(p_subject->>'contactId','')::uuid;
  v_opportunity uuid:=nullif(p_subject->>'opportunityId','')::uuid;
  v_enrollment uuid:=nullif(p_subject->>'enrollmentId','')::uuid;
  v_campaign uuid:=nullif(p_subject->>'campaignId','')::uuid;
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(private.relationship_communication_json(c.id) ORDER BY c.occurred_at DESC,c.created_at DESC)
    FROM (
      SELECT id,occurred_at,created_at FROM public.relationship_communications
      WHERE tenant_id=v_tenant
        AND (v_organization IS NULL OR organization_id=v_organization)
        AND (v_contact IS NULL OR contact_id=v_contact)
        AND (v_opportunity IS NULL OR opportunity_id=v_opportunity)
        AND (v_enrollment IS NULL OR enrollment_id=v_enrollment)
        AND (v_campaign IS NULL OR campaign_id=v_campaign)
      ORDER BY occurred_at DESC,created_at DESC LIMIT 250
    ) c
  ),'[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION private.list_relationship_communication_events(p_communication_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_context jsonb:=private.relationship_campaign_context(false);
  v_tenant uuid:=(v_context->>'tenant_id')::uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.relationship_communications WHERE tenant_id=v_tenant AND id=p_communication_id) THEN
    RAISE EXCEPTION 'Relationship communication not found.' USING errcode='P0002';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id',e.id,'communicationId',e.communication_id,'provider',e.provider,'providerEventId',e.provider_event_id,
      'eventType',e.event_type,'occurredAt',e.occurred_at,'payload',e.payload,'createdAt',e.created_at
    ) ORDER BY e.occurred_at DESC,e.created_at DESC)
    FROM public.relationship_communication_events e
    WHERE e.tenant_id=v_tenant AND e.communication_id=p_communication_id
  ),'[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION private.list_relationship_replies(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_context jsonb:=private.relationship_campaign_context(false);
  v_tenant uuid:=(v_context->>'tenant_id')::uuid;
  v_statuses text[]:=CASE WHEN jsonb_typeof(p_filters->'statuses')='array' THEN ARRAY(SELECT jsonb_array_elements_text(p_filters->'statuses')) ELSE NULL END;
  v_owner uuid:=nullif(p_filters->>'ownerId','')::uuid;
  v_unowned boolean:=coalesce((p_filters->>'unownedOnly')::boolean,false);
  v_page integer:=greatest(coalesce((p_filters->>'page')::integer,1),1);
  v_page_size integer:=least(greatest(coalesce((p_filters->>'pageSize')::integer,25),1),100);
  v_total bigint;
  v_items jsonb;
BEGIN
  SELECT count(*) INTO v_total FROM public.relationship_replies r
  WHERE r.tenant_id=v_tenant AND (v_statuses IS NULL OR r.status=ANY(v_statuses))
    AND (v_owner IS NULL OR r.owner_profile_id=v_owner) AND (NOT v_unowned OR r.owner_profile_id IS NULL);
  SELECT coalesce(jsonb_agg(private.relationship_reply_json(x.id) ORDER BY x.created_at DESC),'[]'::jsonb)
  INTO v_items FROM (
    SELECT r.id,r.created_at FROM public.relationship_replies r
    WHERE r.tenant_id=v_tenant AND (v_statuses IS NULL OR r.status=ANY(v_statuses))
      AND (v_owner IS NULL OR r.owner_profile_id=v_owner) AND (NOT v_unowned OR r.owner_profile_id IS NULL)
    ORDER BY r.created_at DESC LIMIT v_page_size OFFSET ((v_page-1)*v_page_size)
  ) x;
  RETURN jsonb_build_object('items',v_items,'total',v_total,'page',v_page,'pageSize',v_page_size);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_relationship_delivery_readiness(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_context jsonb:=private.relationship_campaign_context(false);
BEGIN RETURN private.relationship_delivery_readiness((v_context->>'tenant_id')::uuid,p_campaign_id); END;
$function$;
CREATE OR REPLACE FUNCTION public.set_relationship_campaign_execution(p_campaign_id uuid,p_expected_version bigint,p_enabled boolean,p_idempotency_key text,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SET search_path TO '' AS $function$
SELECT private.set_relationship_campaign_execution(p_campaign_id,p_expected_version,p_enabled,p_idempotency_key,p_reason);
$function$;
CREATE OR REPLACE FUNCTION public.set_relationship_delivery_provider_config(p_tenant_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $function$
SELECT private.set_relationship_delivery_provider_config(p_tenant_id,p_payload);
$function$;
CREATE OR REPLACE FUNCTION public.list_relationship_communications(p_subject jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
SELECT private.list_relationship_communications(p_subject);
$function$;
CREATE OR REPLACE FUNCTION public.list_relationship_communication_events(p_communication_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
SELECT private.list_relationship_communication_events(p_communication_id);
$function$;
CREATE OR REPLACE FUNCTION public.list_relationship_replies(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
SELECT private.list_relationship_replies(p_filters);
$function$;

REVOKE ALL ON FUNCTION private.relationship_communication_json(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.relationship_reply_json(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.relationship_delivery_readiness(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.set_relationship_delivery_provider_config(uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.set_relationship_campaign_execution(uuid,bigint,boolean,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.list_relationship_communications(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.list_relationship_communication_events(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.list_relationship_replies(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_relationship_delivery_readiness(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_relationship_campaign_execution(uuid,bigint,boolean,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_relationship_delivery_provider_config(uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_relationship_communications(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_relationship_communication_events(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_relationship_replies(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_relationship_delivery_readiness(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_relationship_campaign_execution(uuid,bigint,boolean,text,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_relationship_delivery_provider_config(uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_relationship_communications(jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_relationship_communication_events(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_relationship_replies(jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.set_relationship_delivery_provider_config(uuid,jsonb) TO service_role;
