-- Clinician email enrichment is evidence-based and review-only.
-- It never marks email identity verified or grants outreach consent.
CREATE TABLE public.crm_recruitment_email_enrichment(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 prospect_id uuid NOT NULL,
 proposed_email text NOT NULL CHECK(proposed_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
 evidence_url text NOT NULL CHECK(length(evidence_url) BETWEEN 12 AND 1000 AND evidence_url ~* '^https://[^[:space:]]+$'),
 evidence_notes text NOT NULL CHECK(length(btrim(evidence_notes)) BETWEEN 12 AND 1200),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
 submitted_by uuid NOT NULL REFERENCES public.profiles(id),
 reviewed_by uuid REFERENCES public.profiles(id),
 review_notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,prospect_id) REFERENCES public.crm_therapist_prospect_workflow(tenant_id,prospect_id),
 UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX crm_recruitment_one_pending_email_proposal
 ON public.crm_recruitment_email_enrichment(tenant_id,prospect_id)
 WHERE status='pending';
CREATE INDEX crm_recruitment_email_enrichment_review_idx
 ON public.crm_recruitment_email_enrichment(tenant_id,status,created_at DESC);
ALTER TABLE public.crm_recruitment_email_enrichment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_recruitment_email_enrichment FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.crm_recruitment_propose_email_enrichment(
 p_tenant_id uuid,p_prospect_id uuid,p_email text,p_source_url text,p_evidence_notes text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor uuid:=(SELECT auth.uid());rid uuid;addr text:=lower(btrim(coalesce(p_email,'')));
BEGIN
 IF actor IS NULL OR
 NOT coalesce(private.crm_has_relationship_permission(actor,p_tenant_id,'edit_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment enrichment permission denied' USING ERRCODE='42501'; END IF;
 IF addr !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 OR length(p_source_url) NOT BETWEEN 12 AND 1000 OR p_source_url !~* '^https://[^[:space:]]+$'
 OR length(btrim(coalesce(p_evidence_notes,''))) NOT BETWEEN 12 AND 1200
 THEN RAISE EXCEPTION 'Valid email, HTTPS source URL and evidence are required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.crm_therapist_prospect_workflow
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id)
 THEN RAISE EXCEPTION 'Prospect not found in tenant' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.crm_recruitment_email_enrichment
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id AND status='pending')
 THEN RAISE EXCEPTION 'Review the existing pending proposal before submitting another';END IF;
 INSERT INTO public.crm_recruitment_email_enrichment
 (tenant_id,prospect_id,proposed_email,evidence_url,evidence_notes,submitted_by)
 VALUES(p_tenant_id,p_prospect_id,addr,p_source_url,btrim(p_evidence_notes),actor)
 RETURNING id INTO rid;
 RETURN rid;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_propose_email_enrichment(uuid,uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_propose_email_enrichment(uuid,uuid,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_recruitment_email_enrichment_queue(
 p_tenant_id uuid,p_prospect_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE result jsonb;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR
 NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment enrichment viewing denied' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',e.id,'prospectId',e.prospect_id,'email',e.proposed_email,
  'sourceUrl',e.evidence_url,'notes',e.evidence_notes,'status',e.status,
  'createdAt',e.created_at,'reviewedAt',e.reviewed_at,'reviewNotes',e.review_notes
 ) ORDER BY e.created_at DESC),'[]'::jsonb) INTO result
 FROM (SELECT * FROM public.crm_recruitment_email_enrichment
   WHERE tenant_id=p_tenant_id AND (p_prospect_id IS NULL OR prospect_id=p_prospect_id)
   ORDER BY created_at DESC LIMIT 100) e;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_email_enrichment_queue(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_email_enrichment_queue(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_recruitment_review_email_enrichment(
 p_tenant_id uuid,p_proposal_id uuid,p_decision text,p_review_notes text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor uuid:=(SELECT auth.uid());proposal public.crm_recruitment_email_enrichment%ROWTYPE;
DECLARE existing text;work_status text;
BEGIN
 IF actor IS NULL OR
 NOT coalesce(private.crm_has_relationship_permission(actor,p_tenant_id,'edit_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment enrichment review denied' USING ERRCODE='42501';END IF;
 IF p_decision NOT IN ('approved','rejected') OR length(btrim(coalesce(p_review_notes,'')))<10
 THEN RAISE EXCEPTION 'Approval/decline decision and review reason required';END IF;
 SELECT * INTO proposal FROM public.crm_recruitment_email_enrichment
 WHERE tenant_id=p_tenant_id AND id=p_proposal_id FOR UPDATE;
 IF NOT FOUND OR proposal.status<>'pending'
 THEN RAISE EXCEPTION 'Enrichment proposal is not pending' USING ERRCODE='42501'; END IF;
 IF p_decision='approved' THEN
  PERFORM 1 FROM public.crm_therapist_prospect_workflow
  WHERE tenant_id=p_tenant_id AND prospect_id=proposal.prospect_id FOR UPDATE;
  SELECT p.email,w.workflow_status INTO existing,work_status
  FROM public.therapist_outreach_prospects p
  JOIN public.crm_therapist_prospect_workflow w ON w.tenant_id=p.tenant_id AND w.prospect_id=p.id
  WHERE p.tenant_id=p_tenant_id AND p.id=proposal.prospect_id FOR UPDATE OF p;
  IF work_status='blocked' THEN RAISE EXCEPTION 'Blocked prospects cannot be enriched without review'; END IF;
  IF existing ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  THEN RAISE EXCEPTION 'Prospect already has a valid email; review separately before replacement'; END IF;
  IF EXISTS(SELECT 1 FROM public.therapist_outreach_prospects
    WHERE tenant_id=p_tenant_id AND id<>proposal.prospect_id
      AND lower(btrim(email))=proposal.proposed_email)
  THEN RAISE EXCEPTION 'Email already belongs to another prospect'; END IF;
  IF EXISTS(SELECT 1 FROM public.relationship_suppressions s
   WHERE s.tenant_id=p_tenant_id AND s.revoked_at IS NULL AND s.effective_at<=now()
     AND (s.expires_at IS NULL OR s.expires_at>now())
     AND (s.scope='global' OR (s.scope='email' AND lower(btrim(s.email))=proposal.proposed_email)))
  THEN RAISE EXCEPTION 'Proposed email is suppressed'; END IF;
  UPDATE public.therapist_outreach_prospects
  SET email=proposal.proposed_email,updated_at=now()
  WHERE tenant_id=p_tenant_id AND id=proposal.prospect_id;
  UPDATE public.crm_therapist_prospect_workflow SET
   email_review_status='unverified',recruiting_stage='not_contacted',
   next_action='Manually verify newly enriched email before recruitment',
   next_action_due_at=NULL,version=version+1,updated_by=actor,updated_at=now()
  WHERE tenant_id=p_tenant_id AND prospect_id=proposal.prospect_id;
  UPDATE public.crm_recruitment_contact_permissions SET
   email_permission='unknown',evidence_source=NULL,evidence_details=NULL,
   reviewed_by=NULL,reviewed_at=NULL,updated_at=now()
  WHERE tenant_id=p_tenant_id AND prospect_id=proposal.prospect_id;
 END IF;
 UPDATE public.crm_recruitment_email_enrichment SET
 status=p_decision,reviewed_by=actor,reviewed_at=now(),
 review_notes=btrim(p_review_notes),updated_at=now()
 WHERE id=proposal.id;
 RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_review_email_enrichment(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_review_email_enrichment(uuid,uuid,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';