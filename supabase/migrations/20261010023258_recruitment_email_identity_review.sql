ALTER TABLE public.crm_therapist_prospect_workflow ADD COLUMN email_review_status text NOT NULL DEFAULT 'unverified' CHECK (email_review_status IN ('unverified','verified','invalid')), ADD COLUMN email_reviewed_at timestamptz, ADD COLUMN email_reviewed_by uuid REFERENCES public.profiles(id);
CREATE OR REPLACE FUNCTION public.crm_review_therapist_prospect_email(p_tenant_id uuid, p_prospect_id uuid, p_expected_version integer, p_email_review_status text, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_actor uuid:=(select auth.uid());
 v_row public.crm_therapist_prospect_workflow%ROWTYPE;
 v_source public.therapist_outreach_prospects%ROWTYPE;
 v_new integer;
BEGIN
 IF v_actor IS NULL
  OR NOT coalesce(private.crm_has_relationship_permission(v_actor,p_tenant_id,'edit_relationships'),false)
  OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment review denied' USING ERRCODE='42501'; END IF;
 IF p_email_review_status NOT IN ('unverified','verified','invalid')
   OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 500
 THEN RAISE EXCEPTION 'Invalid review status or reason'; END IF;
 SELECT * INTO v_row FROM public.crm_therapist_prospect_workflow
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Prospect not found' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_source FROM public.therapist_outreach_prospects
 WHERE tenant_id=p_tenant_id AND id=p_prospect_id;
 IF v_row.version<>p_expected_version THEN RAISE EXCEPTION 'Prospect changed: reload before editing'; END IF;
 IF p_email_review_status='verified'
   AND (v_source.email IS NULL OR v_source.email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        OR NOT v_source.outreach_contactable OR v_source.outreach_exclusion_reason IS NOT NULL)
 THEN RAISE EXCEPTION 'Cannot verify missing, malformed or excluded email'; END IF;
 UPDATE public.crm_therapist_prospect_workflow SET
  email_review_status=p_email_review_status,
  email_reviewed_at=CASE WHEN p_email_review_status='unverified' THEN NULL ELSE now() END,
  email_reviewed_by=CASE WHEN p_email_review_status='unverified' THEN NULL ELSE v_actor END,
  version=version+1,updated_by=v_actor,updated_at=now()
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id RETURNING version INTO v_new;
 INSERT INTO public.crm_therapist_prospect_events
 (tenant_id,prospect_id,actor_profile_id,old_status,new_status,
  old_owner_profile_id,new_owner_profile_id,reason)
 VALUES (p_tenant_id,p_prospect_id,v_actor,v_row.workflow_status,v_row.workflow_status,
 v_row.owner_profile_id,v_row.owner_profile_id,
 'Email review '||v_row.email_review_status||' → '||p_email_review_status||': '||btrim(p_reason));
 RETURN v_new;
END $function$
;
REVOKE ALL ON FUNCTION public.crm_review_therapist_prospect_email(uuid,uuid,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_review_therapist_prospect_email(uuid,uuid,integer,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';