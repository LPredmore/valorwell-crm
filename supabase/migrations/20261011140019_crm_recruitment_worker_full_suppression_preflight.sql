-- Apply all current suppressions and competing-contact preflights both when
-- claiming and immediately before provider delivery, not just during staging.
CREATE OR REPLACE FUNCTION public.crm_recruitment_worker_claim(p_limit integer DEFAULT 5, p_lease_seconds integer DEFAULT 180)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE out_items jsonb:='[]'::jsonb;
DECLARE item record;v_message uuid;v_token uuid;v_attempt integer;
DECLARE sender record;
BEGIN
 IF coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
 THEN RAISE EXCEPTION 'Recruitment worker restricted to service role' USING ERRCODE='42501';END IF;
 IF p_limit NOT BETWEEN 1 AND 10 OR p_lease_seconds NOT BETWEEN 60 AND 300
 THEN RAISE EXCEPTION 'Invalid worker lease parameters';END IF;
 -- All tenants are currently locked off by database CHECK constraint.
 IF NOT EXISTS(SELECT 1 FROM public.crm_recruitment_send_control
 WHERE execution_enabled=true AND approved_test_only=true) THEN RETURN out_items;END IF;
 FOR item IN
 SELECT s.*,pl.prospect_id,pl.sequence_id,pl.recipient_email,pl.created_by,
   st.from_name,st.marketing_from_name,st.marketing_from_email,
   st.from_email,st.inbound_email,st.reply_to_email,st.postal_address
 FROM public.crm_recruitment_delivery_steps s
 JOIN public.crm_recruitment_delivery_plans pl ON pl.tenant_id=s.tenant_id AND pl.id=s.plan_id
 JOIN public.crm_recruitment_send_control ctl ON ctl.tenant_id=s.tenant_id
 JOIN public.crm_resend_email_settings st ON st.tenant_id=s.tenant_id
 JOIN public.crm_therapist_prospect_workflow w ON w.tenant_id=pl.tenant_id AND w.prospect_id=pl.prospect_id
 JOIN public.crm_recruitment_contact_permissions perm ON perm.tenant_id=pl.tenant_id AND perm.prospect_id=pl.prospect_id
 JOIN public.therapist_outreach_prospects src ON src.tenant_id=pl.tenant_id AND src.id=pl.prospect_id
 WHERE ctl.execution_enabled=true AND ctl.approved_test_only=true
 AND st.connection_status='connected' AND st.marketing_from_email IS NOT NULL
 AND st.postal_address IS NOT NULL AND btrim(st.postal_address)<>''
 AND pl.status='held' AND s.state IN ('held','retry_wait')
 AND s.scheduled_for<=now() AND coalesce(s.retry_after,now())<=now()
 AND s.attempt_count<3 AND w.workflow_status='ready'
 AND w.recruiting_stage='not_contacted' AND w.email_review_status='verified'
 AND perm.email_permission='approved'
 AND src.outreach_contactable=true AND src.outreach_exclusion_reason IS NULL
 AND lower(btrim(src.email))=pl.recipient_email
 AND (SELECT count(*) FROM public.therapist_outreach_prospects z
  WHERE z.tenant_id=s.tenant_id AND lower(btrim(z.email))=pl.recipient_email)=1
 AND NOT EXISTS (SELECT 1 FROM public.relationship_suppressions su
  WHERE su.tenant_id=s.tenant_id AND su.revoked_at IS NULL
   AND su.effective_at<=now() AND (su.expires_at IS NULL OR su.expires_at>now())
   AND (su.scope='global' OR (su.scope='email' AND lower(btrim(su.email))=pl.recipient_email)))
 AND NOT EXISTS (SELECT 1 FROM public.crm_newsletter_suppressions n
  WHERE n.tenant_id=s.tenant_id AND n.revoked_at IS NULL
   AND lower(btrim(n.example_email))=pl.recipient_email)
 AND NOT EXISTS (SELECT 1 FROM public.relationship_contacts c
  WHERE c.tenant_id=s.tenant_id AND c.do_not_contact=true
   AND lower(btrim(coalesce(c.email,'')))=pl.recipient_email)
 AND NOT EXISTS (SELECT 1 FROM public.crm_email_messages m
  WHERE m.tenant_id=s.tenant_id AND m.direction='outbound'
   AND lower(btrim(m.recipient_email))=pl.recipient_email
   AND m.source<>'crm_recruitment_worker'
   AND m.status IN ('sent','delivered','bounced','complained','suppressed'))
 AND NOT EXISTS (SELECT 1 FROM public.crm_recruitment_inbound_triage t
  WHERE t.tenant_id=s.tenant_id AND t.prospect_id=pl.prospect_id)
 AND NOT EXISTS (SELECT 1 FROM public.crm_recruitment_delivery_steps prior
  WHERE prior.tenant_id=s.tenant_id AND prior.plan_id=s.plan_id
   AND prior.step_order<s.step_order AND prior.state NOT IN('sent','delivered'))
 AND NOT EXISTS (SELECT 1 FROM public.crm_recruitment_delivery_steps other
  WHERE other.tenant_id=s.tenant_id AND other.plan_id=s.plan_id
   AND other.id<>s.id AND other.state='claimed')
 ORDER BY s.scheduled_for,s.id FOR UPDATE OF s SKIP LOCKED LIMIT p_limit LOOP
  v_token:=gen_random_uuid();v_attempt:=item.attempt_count+1;
  v_message:=item.email_message_id;
  IF v_message IS NULL THEN
    INSERT INTO public.crm_email_messages
    (tenant_id,direction,status,sender_email,recipient_email,reply_to_email,
     subject,body_text,provider,source,message_class,metadata,created_by_profile_id)
    VALUES(item.tenant_id,'outbound','queued',lower(item.marketing_from_email),
     item.recipient_email,coalesce(item.inbound_email,item.reply_to_email),
     item.subject,item.body_text,'resend','crm_recruitment_worker','marketing',
     jsonb_build_object('recruitmentPlanId',item.plan_id,'recruitmentStepId',item.id,
      'heldWorker',true),item.created_by)
    RETURNING id INTO v_message;
  END IF;
  UPDATE public.crm_recruitment_delivery_steps SET
   state='claimed',lease_token=v_token,
   lease_expires_at=now()+make_interval(secs=>p_lease_seconds),
   attempt_count=v_attempt,email_message_id=v_message,provider='resend',
   provider_idempotency_key=coalesce(provider_idempotency_key,'crm-recruitment/'||id::text),
   worker_checked_at=now(),updated_at=now()
  WHERE id=item.id;
  out_items:=out_items||jsonb_build_array(jsonb_build_object(
   'tenantId',item.tenant_id,'stepId',item.id,'planId',item.plan_id,
   'leaseToken',v_token,'emailMessageId',v_message,'attempt',v_attempt,
   'fromEmail',lower(item.marketing_from_email),'fromName',item.marketing_from_name,
   'replyTo',coalesce(item.inbound_email,item.reply_to_email),
   'to',item.recipient_email,'subject',item.subject,'bodyText',item.body_text,
   'postalAddress',item.postal_address,'idempotencyKey','crm-recruitment/'||item.id::text));
 END LOOP;
 RETURN out_items;
END $function$
;
REVOKE ALL ON FUNCTION public.crm_recruitment_worker_claim(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_worker_claim(integer,integer) TO service_role;
CREATE OR REPLACE FUNCTION public.crm_recruitment_worker_recheck(p_tenant_id uuid, p_step_id uuid, p_lease_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE step record;
BEGIN
 IF coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
 THEN RAISE EXCEPTION 'Worker role required' USING ERRCODE='42501';END IF;
 SELECT s.id,s.tenant_id,s.state,s.lease_token,s.lease_expires_at,
  pl.prospect_id,pl.recipient_email,pl.status AS plan_status,
  ctl.execution_enabled,ctl.approved_test_only,
  w.workflow_status,w.recruiting_stage,w.email_review_status,
  perm.email_permission,src.outreach_contactable,src.outreach_exclusion_reason,
  src.email AS source_email
 INTO step
 FROM public.crm_recruitment_delivery_steps s
 JOIN public.crm_recruitment_delivery_plans pl ON pl.tenant_id=s.tenant_id AND pl.id=s.plan_id
 JOIN public.crm_recruitment_send_control ctl ON ctl.tenant_id=s.tenant_id
 JOIN public.crm_therapist_prospect_workflow w ON w.tenant_id=pl.tenant_id AND w.prospect_id=pl.prospect_id
 JOIN public.crm_recruitment_contact_permissions perm ON perm.tenant_id=pl.tenant_id AND perm.prospect_id=pl.prospect_id
 JOIN public.therapist_outreach_prospects src ON src.tenant_id=pl.tenant_id AND src.id=pl.prospect_id
 WHERE s.tenant_id=p_tenant_id AND s.id=p_step_id;
 IF NOT FOUND THEN RETURN false;END IF;
 RETURN step.state='claimed' AND step.lease_token=p_lease_token
  AND step.lease_expires_at>now() AND step.plan_status='held'
  AND step.execution_enabled=true AND step.approved_test_only=true
  AND step.workflow_status='ready' AND step.recruiting_stage='not_contacted'
  AND step.email_review_status='verified' AND step.email_permission='approved'
  AND step.outreach_contactable AND step.outreach_exclusion_reason IS NULL
  AND lower(btrim(step.source_email))=step.recipient_email
  AND NOT EXISTS(SELECT 1 FROM public.relationship_suppressions su
   WHERE su.tenant_id=p_tenant_id AND su.revoked_at IS NULL AND su.effective_at<=now()
    AND (su.expires_at IS NULL OR su.expires_at>now()) AND
    (su.scope='global' OR (su.scope='email' AND lower(btrim(su.email))=step.recipient_email)))
  AND NOT EXISTS(SELECT 1 FROM public.crm_newsletter_suppressions n
   WHERE n.tenant_id=p_tenant_id AND n.revoked_at IS NULL
    AND lower(btrim(n.example_email))=step.recipient_email)
  AND NOT EXISTS(SELECT 1 FROM public.relationship_contacts c
   WHERE c.tenant_id=p_tenant_id AND c.do_not_contact=true
    AND lower(btrim(coalesce(c.email,'')))=step.recipient_email)
  AND NOT EXISTS(SELECT 1 FROM public.crm_email_messages m
   WHERE m.tenant_id=p_tenant_id AND m.direction='outbound'
    AND lower(btrim(m.recipient_email))=step.recipient_email
    AND m.source<>'crm_recruitment_worker'
    AND m.status IN ('sent','delivered','bounced','complained','suppressed'))
  AND NOT EXISTS(SELECT 1 FROM public.crm_recruitment_inbound_triage t
   WHERE t.tenant_id=p_tenant_id AND t.prospect_id=step.prospect_id);
END $function$
;
REVOKE ALL ON FUNCTION public.crm_recruitment_worker_recheck(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_worker_recheck(uuid,uuid,uuid) TO service_role;