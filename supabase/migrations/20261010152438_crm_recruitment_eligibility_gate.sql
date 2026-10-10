-- Tenant-authorized eligibility gate. "Can plan" does NOT imply permission to send.
CREATE FUNCTION public.crm_recruitment_delivery_gate(
 p_tenant_id uuid,p_sequence_id uuid,p_prospect_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_source public.therapist_outreach_prospects%ROWTYPE;
DECLARE v_work public.crm_therapist_prospect_workflow%ROWTYPE;
DECLARE v_draft public.crm_recruitment_draft_sequences%ROWTYPE;
DECLARE v_permissions public.crm_recruitment_contact_permissions%ROWTYPE;
DECLARE v_row record;v_reasons text[]:=ARRAY[]::text[];
DECLARE v_email text;v_send_enabled boolean:=false;
BEGIN
 IF (select auth.uid()) IS NULL
  OR NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
  OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment delivery eligibility denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_draft FROM public.crm_recruitment_draft_sequences
 WHERE tenant_id=p_tenant_id AND id=p_sequence_id AND status='draft';
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found in tenant' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_source FROM public.therapist_outreach_prospects
 WHERE tenant_id=p_tenant_id AND id=p_prospect_id;
 SELECT * INTO v_work FROM public.crm_therapist_prospect_workflow
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id;
 IF NOT FOUND OR v_source.id IS NULL THEN RAISE EXCEPTION 'Prospect unavailable in tenant' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_permissions FROM public.crm_recruitment_contact_permissions
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id;
 v_email:=lower(btrim(coalesce(v_source.email,'')));
 IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 THEN v_reasons:=array_append(v_reasons,'invalid_or_missing_email'); END IF;
 IF (SELECT count(*) FROM public.therapist_outreach_prospects p WHERE p.tenant_id=p_tenant_id
  AND v_email<>'' AND lower(btrim(coalesce(p.email,'')))=v_email)<>1
 THEN v_reasons:=array_append(v_reasons,'duplicate_identity'); END IF;
 IF v_work.email_review_status<>'verified'
 THEN v_reasons:=array_append(v_reasons,'email_identity_unverified'); END IF;
 IF coalesce(v_permissions.email_permission,'unknown')<>'approved'
 THEN v_reasons:=array_append(v_reasons,'contact_permission_not_approved'); END IF;
 IF v_work.workflow_status<>'ready' OR v_work.recruiting_stage<>'not_contacted'
 THEN v_reasons:=array_append(v_reasons,'not_initial_outreach_stage'); END IF;
 IF NOT v_source.outreach_contactable OR v_source.outreach_exclusion_reason IS NOT NULL
 THEN v_reasons:=array_append(v_reasons,'source_excluded'); END IF;
 IF v_draft.state_filter IS NOT NULL AND
    upper(btrim(coalesce(v_source.state,'')))<>v_draft.state_filter
    AND NOT coalesce(v_source.licensed_states,'[]'::jsonb) ? v_draft.state_filter
 THEN v_reasons:=array_append(v_reasons,'state_filter_mismatch'); END IF;
 IF v_draft.license_filter IS NOT NULL AND
    lower(coalesce(v_source.license_type,'')) NOT LIKE '%'||lower(v_draft.license_filter)||'%'
 THEN v_reasons:=array_append(v_reasons,'license_filter_mismatch'); END IF;
 IF EXISTS(SELECT 1 FROM public.relationship_suppressions s WHERE s.tenant_id=p_tenant_id
  AND s.revoked_at IS NULL AND s.effective_at<=now()
  AND (s.expires_at IS NULL OR s.expires_at>now())
  AND (s.scope='global' OR (s.scope='email' AND lower(btrim(s.email))=v_email)))
  OR EXISTS(SELECT 1 FROM public.crm_newsletter_suppressions n WHERE n.tenant_id=p_tenant_id
  AND n.revoked_at IS NULL AND lower(btrim(n.example_email))=v_email)
  OR EXISTS(SELECT 1 FROM public.relationship_contacts c WHERE c.tenant_id=p_tenant_id AND c.do_not_contact
  AND lower(btrim(coalesce(c.email,'')))=v_email)
 THEN v_reasons:=array_append(v_reasons,'suppressed_or_do_not_contact'); END IF;
 IF EXISTS(SELECT 1 FROM public.crm_recruitment_inbound_triage i WHERE i.tenant_id=p_tenant_id
  AND i.prospect_id=p_prospect_id)
 THEN v_reasons:=array_append(v_reasons,'reply_already_received'); END IF;
 IF EXISTS(SELECT 1 FROM public.crm_therapist_prospect_applicant_links a
  WHERE a.tenant_id=p_tenant_id AND a.prospect_id=p_prospect_id)
 THEN v_reasons:=array_append(v_reasons,'applicant_already_linked'); END IF;
 IF EXISTS(SELECT 1 FROM public.crm_recruitment_delivery_plans d WHERE d.tenant_id=p_tenant_id
  AND d.sequence_id=p_sequence_id AND d.prospect_id=p_prospect_id)
 THEN v_reasons:=array_append(v_reasons,'already_planned'); END IF;
 IF EXISTS(SELECT 1 FROM public.crm_email_messages m WHERE m.tenant_id=p_tenant_id
  AND m.direction='outbound' AND lower(btrim(m.recipient_email))=v_email
  AND m.status IN ('bounced','complained','suppressed'))
 THEN v_reasons:=array_append(v_reasons,'prior_delivery_failure'); END IF;
 IF EXISTS(SELECT 1 FROM public.crm_recruitment_delivery_steps d
  JOIN public.crm_recruitment_delivery_plans pl ON pl.tenant_id=d.tenant_id AND pl.id=d.plan_id
  WHERE d.tenant_id=p_tenant_id AND pl.prospect_id=p_prospect_id
   AND d.state IN ('bounced','complained'))
 THEN v_reasons:=array_append(v_reasons,'recruitment_bounce_or_complaint'); END IF;
 -- The row-level kill switch has an immutable CHECK(execution_enabled=false).
 SELECT coalesce(execution_enabled,false) INTO v_send_enabled
 FROM public.crm_recruitment_send_control WHERE tenant_id=p_tenant_id;
 RETURN jsonb_build_object('prospectId',p_prospect_id,
  'sequenceId',p_sequence_id,'email',v_email,
  'canCreateHeldPlan',cardinality(v_reasons)=0,
  'canSend',false,'sendingEnabled',coalesce(v_send_enabled,false),
  'reasons',to_jsonb(v_reasons));
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_delivery_gate(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_delivery_gate(uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.crm_recruitment_record_contact_permission(
 p_tenant_id uuid,p_prospect_id uuid,p_status text,
 p_evidence_source text,p_evidence_details text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor uuid:=(SELECT auth.uid());
BEGIN
 IF actor IS NULL OR
 NOT coalesce(private.crm_has_relationship_permission(actor,p_tenant_id,'edit_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment contact permission edit denied' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN ('approved','revoked','unknown') THEN RAISE EXCEPTION 'Invalid contact permission status'; END IF;
 IF p_status='approved' AND (length(btrim(coalesce(p_evidence_source,''))) NOT BETWEEN 5 AND 100 OR
  length(btrim(coalesce(p_evidence_details,''))) NOT BETWEEN 12 AND 1200)
 THEN RAISE EXCEPTION 'Documented permission evidence is required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.crm_therapist_prospect_workflow
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id) THEN
 RAISE EXCEPTION 'Prospect not found in tenant' USING ERRCODE='42501'; END IF;
 INSERT INTO public.crm_recruitment_contact_permissions
 (tenant_id,prospect_id,email_permission,evidence_source,evidence_details,reviewed_by,reviewed_at)
 VALUES(p_tenant_id,p_prospect_id,p_status,
  nullif(btrim(coalesce(p_evidence_source,'')),''),nullif(btrim(coalesce(p_evidence_details,'')),''),
  actor,now())
 ON CONFLICT(tenant_id,prospect_id) DO UPDATE
 SET email_permission=excluded.email_permission,evidence_source=excluded.evidence_source,
  evidence_details=excluded.evidence_details,reviewed_by=actor,reviewed_at=now(),updated_at=now();
 RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_record_contact_permission(uuid,uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_record_contact_permission(uuid,uuid,text,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';