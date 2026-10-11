-- Phase 32 preparation: leased worker protocol. Send lock remains immutable FALSE.
-- Existing state check is replaced to model claiming, retry and uncertain acceptance.
ALTER TABLE public.crm_recruitment_delivery_steps
  DROP CONSTRAINT crm_recruitment_delivery_steps_state_check;
ALTER TABLE public.crm_recruitment_delivery_steps
  ADD CONSTRAINT crm_recruitment_delivery_steps_state_check
  CHECK(state IN ('held','claimed','retry_wait','uncertain','stopped','sent','delivered','bounced','complained','failed'));
ALTER TABLE public.crm_recruitment_delivery_steps
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN retry_after timestamptz,
  ADD COLUMN provider_idempotency_key text,
  ADD COLUMN worker_checked_at timestamptz,
  ADD CONSTRAINT crm_recruitment_lease_pair CHECK
   ((lease_token IS NULL AND lease_expires_at IS NULL) OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL));
CREATE UNIQUE INDEX crm_recruitment_delivery_idempotency_key
 ON public.crm_recruitment_delivery_steps(tenant_id,provider_idempotency_key)
 WHERE provider_idempotency_key IS NOT NULL;
CREATE INDEX crm_recruitment_due_claim_queue ON public.crm_recruitment_delivery_steps
 (tenant_id,state,scheduled_for,retry_after) WHERE state IN ('held','claimed','retry_wait');
-- A second independent guard protects any accidentally enabled worker; never
-- automatically permit actual provider delivery until a separate authorized migration.
ALTER TABLE public.crm_recruitment_send_control
  ADD COLUMN approved_test_only boolean NOT NULL DEFAULT false CHECK (approved_test_only=false),
  ADD COLUMN max_per_run integer NOT NULL DEFAULT 1 CHECK (max_per_run BETWEEN 1 AND 10);

-- Reserve provider message before calling external API. A single permanent email
-- message ID and stable provider idempotency key survive recoverable retries.
CREATE OR REPLACE FUNCTION public.crm_recruitment_worker_claim(
 p_limit integer DEFAULT 5,p_lease_seconds integer DEFAULT 180
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
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
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_worker_claim(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_worker_claim(integer,integer) TO service_role;

-- Finalize a claimed attempt only with the exact lease token and tenant binding.
CREATE OR REPLACE FUNCTION public.crm_recruitment_worker_finalize(
 p_tenant_id uuid,p_step_id uuid,p_lease_token uuid,p_outcome text,
 p_provider_message_id text DEFAULT NULL,p_error text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE s public.crm_recruitment_delivery_steps%ROWTYPE;
DECLARE next_state text;msg_status text;key text;
BEGIN
 IF coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
 THEN RAISE EXCEPTION 'Recruitment worker restricted to service role' USING ERRCODE='42501';END IF;
 IF p_outcome NOT IN ('accepted','retry','uncertain','failed')
 THEN RAISE EXCEPTION 'Invalid worker outcome';END IF;
 SELECT * INTO s FROM public.crm_recruitment_delivery_steps
 WHERE tenant_id=p_tenant_id AND id=p_step_id FOR UPDATE;
 IF NOT FOUND OR s.lease_token IS DISTINCT FROM p_lease_token OR s.state<>'claimed'
 THEN RAISE EXCEPTION 'Invalid or stale recruitment delivery lease' USING ERRCODE='42501';END IF;
 IF p_outcome='accepted' AND nullif(btrim(coalesce(p_provider_message_id,'')),'') IS NULL
 THEN RAISE EXCEPTION 'Provider acceptance ID is required';END IF;
 next_state:=CASE p_outcome WHEN 'accepted' THEN 'sent'
 WHEN 'retry' THEN CASE WHEN s.attempt_count>=3 THEN 'uncertain' ELSE 'retry_wait' END
 WHEN 'uncertain' THEN 'uncertain' ELSE 'failed' END;
 msg_status:=CASE WHEN p_outcome='accepted' THEN 'sent'
 WHEN p_outcome='failed' THEN 'failed' ELSE 'queued' END;
 UPDATE public.crm_recruitment_delivery_steps SET
  state=next_state,lease_token=NULL,lease_expires_at=NULL,
  retry_after=CASE WHEN next_state='retry_wait' THEN now()+make_interval(mins=>least(60,5*s.attempt_count)) ELSE NULL END,
  provider_message_id=CASE WHEN p_outcome='accepted' THEN p_provider_message_id ELSE provider_message_id END,
  last_error=left(coalesce(p_error,''),450),updated_at=now()
 WHERE id=p_step_id;
 UPDATE public.crm_email_messages SET status=msg_status,
  provider_message_id=CASE WHEN p_outcome='accepted' THEN p_provider_message_id ELSE provider_message_id END,
  sent_at=CASE WHEN p_outcome='accepted' THEN now() ELSE sent_at END,
  failed_at=CASE WHEN p_outcome='failed' THEN now() ELSE failed_at END,
  error_code=CASE WHEN p_outcome='failed' THEN 'recruitment_delivery_failed' ELSE error_code END,
  error_message=CASE WHEN p_error IS NOT NULL THEN left(p_error,450) ELSE error_message END,
  updated_at=now()
 WHERE tenant_id=p_tenant_id AND id=s.email_message_id;
 key:='crm-recruitment/'||p_step_id::text||'/attempt/'||s.attempt_count::text;
 INSERT INTO public.crm_recruitment_delivery_attempts
 (tenant_id,delivery_step_id,attempt_number,idempotency_key,result,error_code,provider_message_id)
 VALUES(p_tenant_id,p_step_id,s.attempt_count,key,
  CASE WHEN p_outcome='accepted' THEN 'accepted'
  WHEN p_outcome='retry' THEN 'retry' ELSE 'failed' END,
  left(p_error,200),p_provider_message_id)
 ON CONFLICT (tenant_id,delivery_step_id,attempt_number) DO NOTHING;
 RETURN jsonb_build_object('stepId',p_step_id,'state',next_state);
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_worker_finalize(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_worker_finalize(uuid,uuid,uuid,text,text,text) TO service_role;

-- Lease expiry is UNCERTAIN, never automatically retried: provider may have accepted.
CREATE OR REPLACE FUNCTION public.crm_recruitment_worker_reap_expired()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE n integer;
BEGIN
 IF coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
 THEN RAISE EXCEPTION 'Recruitment worker restricted to service role' USING ERRCODE='42501';END IF;
 UPDATE public.crm_recruitment_delivery_steps
 SET state='uncertain',last_error='Claim lease expired: provider acceptance unknown',
 lease_token=NULL,lease_expires_at=NULL,updated_at=now()
 WHERE state='claimed' AND lease_expires_at<now();
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_worker_reap_expired() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_worker_reap_expired() TO service_role;
NOTIFY pgrst,'reload schema';