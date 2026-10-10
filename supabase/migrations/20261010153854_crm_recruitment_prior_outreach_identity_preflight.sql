-- Cross-check prior outbound contact/applicant identities. Hold permission
-- row lock during scheduling, so revocation triggers can safely cancel afterwards.
CREATE OR REPLACE FUNCTION public.crm_recruitment_delivery_gate(p_tenant_id uuid, p_sequence_id uuid, p_prospect_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 IF EXISTS(SELECT 1 FROM private.crm_recruitment_quality_rows(p_tenant_id) q
 WHERE q.prospect_id=p_prospect_id AND (q.possible_applicant OR q.possible_contact))
 THEN v_reasons:=array_append(v_reasons,'possible_existing_identity'); END IF;
 IF EXISTS(SELECT 1 FROM public.crm_email_messages m
 WHERE m.tenant_id=p_tenant_id AND m.direction='outbound' AND lower(btrim(m.recipient_email))=v_email
 AND m.status IN ('sent','delivered','delivery_delayed'))
 THEN v_reasons:=array_append(v_reasons,'prior_outbound_contact'); END IF;
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
END $function$
;
REVOKE ALL ON FUNCTION public.crm_recruitment_delivery_gate(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_delivery_gate(uuid,uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.crm_recruitment_stage_held_plan(p_tenant_id uuid, p_sequence_id uuid, p_prospect_id uuid, p_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=(select auth.uid());gate jsonb;rec record;v_plan_id uuid;
DECLARE start_time timestamptz:=coalesce(p_start_at,now());due_time timestamptz;
DECLARE cnt integer:=0;
BEGIN
 IF actor IS NULL OR
 NOT coalesce(private.crm_has_relationship_permission(actor,p_tenant_id,'edit_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment plan staging denied' USING ERRCODE='42501'; END IF;
 IF start_time<now()-interval '1 hour' OR start_time>now()+interval '365 days'
 THEN RAISE EXCEPTION 'Requested planning date out of range'; END IF;
 -- Lock source workflow and sequence against changes while evaluating the gate.
 PERFORM 1 FROM public.crm_therapist_prospect_workflow
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id FOR UPDATE;
 PERFORM 1 FROM public.crm_recruitment_draft_sequences
 WHERE tenant_id=p_tenant_id AND crm_recruitment_draft_sequences.id=p_sequence_id FOR SHARE;
 PERFORM 1 FROM public.crm_recruitment_contact_permissions
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id FOR SHARE;
 gate:=public.crm_recruitment_delivery_gate(p_tenant_id,p_sequence_id,p_prospect_id);
 IF NOT (gate->>'canCreateHeldPlan')::boolean
 THEN RAISE EXCEPTION 'Plan not eligible: %',gate->'reasons'; END IF;
 IF (gate->>'sendingEnabled')::boolean OR (gate->>'canSend')::boolean
 THEN RAISE EXCEPTION 'Recruitment delivery safety gate unexpectedly enabled'; END IF;
 INSERT INTO public.crm_recruitment_delivery_plans(
  tenant_id,sequence_id,prospect_id,recipient_email,start_at,created_by)
 VALUES(p_tenant_id,p_sequence_id,p_prospect_id,gate->>'email',start_time,actor)
 RETURNING crm_recruitment_delivery_plans.id INTO v_plan_id;
 due_time:=start_time;
 FOR rec IN SELECT step_order,delay_days,subject,body_text
 FROM public.crm_recruitment_draft_steps
 WHERE tenant_id=p_tenant_id AND sequence_id=p_sequence_id ORDER BY step_order LOOP
  cnt:=cnt+1;
  due_time:=due_time+make_interval(days=>rec.delay_days);
  INSERT INTO public.crm_recruitment_delivery_steps
   (tenant_id,plan_id,step_order,scheduled_for,subject,body_text,state)
  VALUES(p_tenant_id,v_plan_id,rec.step_order,due_time,rec.subject,rec.body_text,'held');
 END LOOP;
 IF cnt=0 THEN RAISE EXCEPTION 'Cannot plan an empty sequence'; END IF;
 RETURN jsonb_build_object('planId',v_plan_id,'stepCount',cnt,
  'state','held','sendingEnabled',false,
  'message','Created immutable step snapshots on HOLD. No delivery/scheduling worker is active.');
END $function$
;
REVOKE ALL ON FUNCTION public.crm_recruitment_stage_held_plan(uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_stage_held_plan(uuid,uuid,uuid,timestamptz) TO authenticated;