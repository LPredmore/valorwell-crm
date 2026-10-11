-- Honor opt-outs for the original message recipient, even if enrichment
-- changed the current prospect email after a message was sent.
CREATE OR REPLACE FUNCTION public.crm_recruitment_worker_unsubscribe(p_token text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE row_ public.crm_recruitment_unsubscribe_tokens%ROWTYPE;
DECLARE recipient text;
BEGIN
 IF coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
 THEN RAISE EXCEPTION 'Worker role required' USING ERRCODE='42501';END IF;
 IF p_token !~ '^[0-9a-f]{48}$' THEN RETURN 'invalid_token';END IF;
 SELECT * INTO row_ FROM public.crm_recruitment_unsubscribe_tokens
 WHERE token_sha256=encode(sha256(convert_to(p_token,'utf8')),'hex') FOR UPDATE;
 IF NOT FOUND THEN RETURN 'invalid_token';END IF;
 IF row_.used_at IS NOT NULL THEN RETURN 'already_unsubscribed';END IF;
 IF row_.expires_at<now() THEN RETURN 'expired_token';END IF;
 SELECT lower(btrim(pl.recipient_email)) INTO recipient
 FROM public.crm_recruitment_delivery_steps s
 JOIN public.crm_recruitment_delivery_plans pl
  ON pl.tenant_id=s.tenant_id AND pl.id=s.plan_id
 WHERE s.tenant_id=row_.tenant_id AND s.id=row_.delivery_step_id;
 IF recipient IS NOT NULL AND recipient ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
  -- The token belongs to the original recipient, even if later enrichment
  -- changed the prospect's current email address.
  INSERT INTO public.relationship_suppressions
   (tenant_id,scope,reason,email,source,source_record_key)
  SELECT row_.tenant_id,'email','unsubscribe',recipient,
    'crm_recruitment_unsubscribe',row_.delivery_step_id::text
  WHERE NOT EXISTS (SELECT 1 FROM public.relationship_suppressions su
   WHERE su.tenant_id=row_.tenant_id AND su.scope='email'
    AND lower(btrim(su.email))=recipient AND su.revoked_at IS NULL
    AND su.effective_at<=now() AND (su.expires_at IS NULL OR su.expires_at>now()));
  PERFORM private.crm_recruitment_stop_held(row_.tenant_id,row_.prospect_id,
    'Recruitment unsubscribe token redeemed');
  UPDATE public.crm_therapist_prospect_workflow
  SET workflow_status='blocked',recruiting_stage='closed',
    next_action='Unsubscribed from recruitment messages',next_action_due_at=NULL,
    version=version+1,updated_at=now()
  WHERE tenant_id=row_.tenant_id AND prospect_id=row_.prospect_id
    AND (workflow_status<>'blocked' OR recruiting_stage<>'closed');
 END IF;
 UPDATE public.crm_recruitment_unsubscribe_tokens SET used_at=now()
 WHERE token_sha256=row_.token_sha256;
 RETURN 'unsubscribed';
END $function$
;
REVOKE ALL ON FUNCTION public.crm_recruitment_worker_unsubscribe(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_worker_unsubscribe(text) TO service_role;