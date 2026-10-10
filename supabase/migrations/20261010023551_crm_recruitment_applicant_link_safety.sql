CREATE UNIQUE INDEX IF NOT EXISTS provider_applicants_tenant_id_id_key ON public.provider_applicants(tenant_id,id);
CREATE TABLE public.crm_therapist_prospect_applicant_links(
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),prospect_id uuid NOT NULL,
 applicant_id uuid NOT NULL,linked_by uuid NOT NULL REFERENCES public.profiles(id),
 link_reason text NOT NULL CHECK(length(btrim(link_reason)) BETWEEN 8 AND 500),
 linked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,prospect_id),UNIQUE(tenant_id,applicant_id),
 FOREIGN KEY(tenant_id,prospect_id) REFERENCES public.therapist_outreach_prospects(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,applicant_id) REFERENCES public.provider_applicants(tenant_id,id) ON DELETE RESTRICT);
ALTER TABLE public.crm_therapist_prospect_applicant_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_therapist_prospect_applicant_links FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.crm_recruitment_applicant_candidates(p_tenant_id uuid, p_prospect_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_source public.therapist_outreach_prospects%ROWTYPE; v_result jsonb;
BEGIN
 IF (select auth.uid()) IS NULL
   OR NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
   OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Prospect candidate access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_source FROM public.therapist_outreach_prospects
 WHERE tenant_id=p_tenant_id AND id=p_prospect_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Prospect not in tenant' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
  'linkedApplicantId',(SELECT applicant_id FROM public.crm_therapist_prospect_applicant_links
    WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id),
  'matches',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',concat_ws(' ',a.first_name,a.last_name),
   'status',a.status::text,'reason',
   CASE WHEN lower(btrim(a.email))=lower(btrim(v_source.email)) THEN 'Exact email'
        ELSE 'Exact phone' END))
   FROM public.provider_applicants a
   WHERE a.tenant_id=p_tenant_id AND
    ((nullif(btrim(coalesce(v_source.email,'')),'') IS NOT NULL
        AND lower(btrim(a.email))=lower(btrim(v_source.email)))
     OR (regexp_replace(coalesce(v_source.phone,''),'[^0-9]','','g')~'^[0-9]{10,11}$'
        AND regexp_replace(coalesce(a.phone,''),'[^0-9]','','g')=regexp_replace(v_source.phone,'[^0-9]','','g')))),
  '[]'::jsonb)) INTO v_result;
 RETURN v_result;
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_recruitment_link_existing_applicant(p_tenant_id uuid, p_prospect_id uuid, p_applicant_id uuid, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor uuid:=(select auth.uid()); v_prospect public.therapist_outreach_prospects%ROWTYPE;
DECLARE v_applicant public.provider_applicants%ROWTYPE;
BEGIN
 IF v_actor IS NULL
   OR NOT coalesce(private.crm_has_relationship_permission(v_actor,p_tenant_id,'edit_relationships'),false)
   OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Prospect link denied' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 500
 THEN RAISE EXCEPTION 'Link reason must be 8–500 characters'; END IF;
 SELECT * INTO v_prospect FROM public.therapist_outreach_prospects
 WHERE tenant_id=p_tenant_id AND id=p_prospect_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Prospect not in tenant' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_applicant FROM public.provider_applicants
 WHERE tenant_id=p_tenant_id AND id=p_applicant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Applicant not in tenant' USING ERRCODE='42501'; END IF;
 IF NOT (
  (v_prospect.email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    AND lower(btrim(v_prospect.email))=lower(btrim(v_applicant.email)))
  OR (regexp_replace(coalesce(v_prospect.phone,''),'[^0-9]','','g') ~ '^[0-9]{10,11}$'
   AND regexp_replace(coalesce(v_prospect.phone,''),'[^0-9]','','g')
     =regexp_replace(coalesce(v_applicant.phone,''),'[^0-9]','','g'))
 ) THEN RAISE EXCEPTION 'No verified email or phone match. Manual research required'; END IF;
 INSERT INTO public.crm_therapist_prospect_applicant_links
 (tenant_id,prospect_id,applicant_id,linked_by,link_reason)
 VALUES (p_tenant_id,p_prospect_id,p_applicant_id,v_actor,btrim(p_reason));
 INSERT INTO public.crm_therapist_prospect_events
 (tenant_id,prospect_id,actor_profile_id,old_status,new_status,reason)
 SELECT p_tenant_id,p_prospect_id,v_actor,w.workflow_status,w.workflow_status,
    'Linked existing applicant '||p_applicant_id::text||': '||btrim(p_reason)
 FROM public.crm_therapist_prospect_workflow w
 WHERE w.tenant_id=p_tenant_id AND w.prospect_id=p_prospect_id;
 RETURN true;
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_invalidate_changed_prospect_email_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NEW.email IS DISTINCT FROM OLD.email
 OR NEW.outreach_contactable IS DISTINCT FROM OLD.outreach_contactable
 OR NEW.outreach_exclusion_reason IS DISTINCT FROM OLD.outreach_exclusion_reason THEN
  UPDATE public.crm_therapist_prospect_workflow
   SET email_review_status='unverified',email_reviewed_at=NULL,email_reviewed_by=NULL,
       version=version+1,updated_at=now()
   WHERE tenant_id=NEW.tenant_id AND prospect_id=NEW.id
     AND email_review_status<>'unverified';
 END IF;
 RETURN NEW;
END $function$
;
REVOKE ALL ON FUNCTION public.crm_recruitment_applicant_candidates(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_applicant_candidates(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.crm_recruitment_link_existing_applicant(uuid,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_link_existing_applicant(uuid,uuid,uuid,text) TO authenticated;
CREATE TRIGGER crm_prospect_email_source_changed AFTER UPDATE OF email,outreach_contactable,outreach_exclusion_reason
 ON public.therapist_outreach_prospects FOR EACH ROW EXECUTE FUNCTION public.crm_invalidate_changed_prospect_email_review();
REVOKE ALL ON FUNCTION public.crm_invalidate_changed_prospect_email_review() FROM PUBLIC,anon,authenticated;