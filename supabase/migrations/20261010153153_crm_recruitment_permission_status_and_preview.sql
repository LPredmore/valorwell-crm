CREATE FUNCTION public.crm_recruitment_contact_permission_status(
 p_tenant_id uuid,p_prospect_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE res jsonb;
BEGIN
 IF (select auth.uid()) IS NULL OR
 NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment permission status denied' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.crm_therapist_prospect_workflow
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id)
 THEN RAISE EXCEPTION 'Prospect unavailable in tenant' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('emailPermission',coalesce(c.email_permission,'unknown'),
  'evidenceSource',c.evidence_source,'evidenceDetails',c.evidence_details,
  'reviewedAt',c.reviewed_at,'reviewedBy',c.reviewed_by)
 INTO res FROM (SELECT 1) defaults LEFT JOIN public.crm_recruitment_contact_permissions c
 ON c.tenant_id=p_tenant_id AND c.prospect_id=p_prospect_id;
 RETURN res;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_contact_permission_status(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_contact_permission_status(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_recruitment_draft_preview(p_tenant_id uuid,p_sequence_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE seq public.crm_recruitment_draft_sequences%ROWTYPE;
DECLARE result jsonb;
BEGIN
 IF (select auth.uid()) IS NULL OR
 NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment draft preview denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO seq FROM public.crm_recruitment_draft_sequences
 WHERE tenant_id=p_tenant_id AND id=p_sequence_id AND status='draft';
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found in tenant' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
  'matched',count(*),
  'formatValid',count(*) FILTER (WHERE q.email_quality='valid'),
  'missing',count(*) FILTER (WHERE q.email_quality='missing'),
  'invalid',count(*) FILTER (WHERE q.email_quality='invalid'),
  'suppressed',count(*) FILTER (WHERE q.suppressed),
  'manuallyVerified',count(*) FILTER (WHERE q.email_review='verified'),
  'documentedPermission',count(*) FILTER (WHERE perm.email_permission='approved'),
  'technicallyReady',count(*) FILTER (WHERE q.preview_eligible),
  'approvedForSending',0,
  'sendingEnabled',false,
  'notice','Recipient overview only. Identity, documented outreach permission, suppression, stage and delivery history must all pass the individual gate. The worker remains disabled.')
 INTO result
 FROM private.crm_recruitment_quality_rows(p_tenant_id) q
 LEFT JOIN public.crm_recruitment_contact_permissions perm ON
  perm.tenant_id=p_tenant_id AND perm.prospect_id=q.prospect_id
 WHERE (seq.state_filter IS NULL OR upper(btrim(q.state_code))=seq.state_filter
  OR coalesce(q.licensed_states,'[]'::jsonb) ? seq.state_filter)
 AND (seq.license_filter IS NULL OR lower(coalesce(q.item->>'licenseType','')) LIKE '%'||lower(seq.license_filter)||'%');
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_draft_preview(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_draft_preview(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';