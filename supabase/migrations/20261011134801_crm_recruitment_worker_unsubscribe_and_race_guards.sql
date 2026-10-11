-- Prevent reply/optout races with claimed work and support authenticated
-- recipient one-click suppression through opaque, hashed database tokens.
CREATE TABLE public.crm_recruitment_unsubscribe_tokens(
 token_sha256 text PRIMARY KEY CHECK(token_sha256 ~ '^[0-9a-f]{64}$'),
 tenant_id uuid NOT NULL,
 prospect_id uuid NOT NULL,
 delivery_step_id uuid NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '2 years',
 used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,prospect_id) REFERENCES public.crm_therapist_prospect_workflow(tenant_id,prospect_id),
 FOREIGN KEY(tenant_id,delivery_step_id) REFERENCES public.crm_recruitment_delivery_steps(tenant_id,id)
);
ALTER TABLE public.crm_recruitment_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_recruitment_unsubscribe_tokens FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.crm_recruitment_stop_held(
 p_tenant_id uuid,p_prospect_id uuid,p_reason text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE affected integer;
BEGIN
 UPDATE public.crm_recruitment_delivery_steps d
 SET state='stopped',stopped_reason=left(p_reason,200),updated_at=now(),
 lease_token=NULL,lease_expires_at=NULL,retry_after=NULL
 FROM public.crm_recruitment_delivery_plans pl
 WHERE d.tenant_id=p_tenant_id AND pl.tenant_id=d.tenant_id AND pl.id=d.plan_id
  AND pl.prospect_id=p_prospect_id AND d.state IN ('held','claimed','retry_wait');
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected>0 THEN
  UPDATE public.crm_recruitment_delivery_plans
  SET status='stopped',stopped_reason=left(p_reason,200),updated_at=now()
  WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id AND status='held';
 END IF;
 RETURN affected;
END $fn$;
REVOKE ALL ON FUNCTION private.crm_recruitment_stop_held(uuid,uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.crm_recruitment_worker_recheck(
 p_tenant_id uuid,p_step_id uuid,p_lease_token uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
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
  AND NOT EXISTS(SELECT 1 FROM public.crm_recruitment_inbound_triage t
   WHERE t.tenant_id=p_tenant_id AND t.prospect_id=step.prospect_id);
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_worker_recheck(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_worker_recheck(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_recruitment_worker_issue_unsubscribe_token(
 p_tenant_id uuid,p_step_id uuid,p_lease_token uuid
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE token text;hash text;v_prospect uuid;
BEGIN
 IF coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
 THEN RAISE EXCEPTION 'Worker role required' USING ERRCODE='42501';END IF;
 IF NOT public.crm_recruitment_worker_recheck(p_tenant_id,p_step_id,p_lease_token)
 THEN RAISE EXCEPTION 'Worker delivery is not authorized' USING ERRCODE='42501';END IF;
 SELECT pl.prospect_id INTO v_prospect FROM public.crm_recruitment_delivery_steps s
 JOIN public.crm_recruitment_delivery_plans pl ON pl.tenant_id=s.tenant_id AND pl.id=s.plan_id
 WHERE s.tenant_id=p_tenant_id AND s.id=p_step_id;
 token:=encode(extensions.gen_random_bytes(24),'hex');
 hash:=encode(sha256(convert_to(token,'utf8')),'hex');
 INSERT INTO public.crm_recruitment_unsubscribe_tokens
 (token_sha256,tenant_id,prospect_id,delivery_step_id)
 VALUES(hash,p_tenant_id,v_prospect,p_step_id);
 RETURN token;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_worker_issue_unsubscribe_token(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_worker_issue_unsubscribe_token(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_recruitment_worker_unsubscribe(
 p_token text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
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
 SELECT lower(btrim(email)) INTO recipient FROM public.therapist_outreach_prospects
 WHERE tenant_id=row_.tenant_id AND id=row_.prospect_id;
 IF recipient IS NOT NULL AND recipient ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
  PERFORM private.crm_recruitment_suppress_known_address(row_.tenant_id,recipient,'unsubscribe',
    'crm_recruitment_unsubscribe',row_.delivery_step_id::text);
 END IF;
 UPDATE public.crm_recruitment_unsubscribe_tokens SET used_at=now()
 WHERE token_sha256=row_.token_sha256;
 RETURN 'unsubscribed';
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_worker_unsubscribe(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_worker_unsubscribe(text) TO service_role;
NOTIFY pgrst,'reload schema';