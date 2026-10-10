-- The existing reviewer page can now read lifecycle stage.
-- Recorded history includes logged recruiter events and, when explicitly
-- linked or manually verified, metadata from existing communications.
-- No outbound sends, candidate creation, enrollment, or message-body exposure.
CREATE OR REPLACE FUNCTION private.crm_recruitment_quality_rows(p_tenant_id uuid)
 RETURNS TABLE(item jsonb, prospect_id uuid, created_at timestamp with time zone, stage text, owner_id uuid, state_code text, licensed_states jsonb, email_quality text, email_review text, suppressed boolean, possible_applicant boolean, possible_contact boolean, preview_eligible boolean, next_action text, due_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
WITH source AS MATERIALIZED (
 SELECT p.*,w.owner_profile_id,w.workflow_status,w.next_action,w.next_action_due_at,
  w.notes,w.email_review_status,w.recruiting_stage,coalesce(w.version,0) as version,
  lower(btrim(coalesce(p.email,''))) AS email_key,
  regexp_replace(coalesce(p.phone,''),'[^0-9]','','g') AS phone_digits,
  (coalesce(p.email,'') ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') AS email_valid,
  (regexp_replace(coalesce(p.phone,''),'[^0-9]','','g') ~ '^[0-9]{10,11}$') AS phone_valid,
  CASE WHEN NOT p.outreach_contactable OR p.outreach_exclusion_reason IS NOT NULL
    THEN 'blocked' ELSE coalesce(w.workflow_status,'review') END AS effective_stage
 FROM public.therapist_outreach_prospects p
 LEFT JOIN public.crm_therapist_prospect_workflow w
  ON w.tenant_id=p.tenant_id AND w.prospect_id=p.id
 WHERE p.tenant_id=p_tenant_id
),
emails AS MATERIALIZED (
 SELECT email_key,count(*)::integer AS copies FROM source
 WHERE email_key<>'' GROUP BY email_key
),
applicants AS MATERIALIZED (
 SELECT lower(btrim(coalesce(email,''))) email_key,
  regexp_replace(coalesce(phone,''),'[^0-9]','','g') phone_digits
 FROM public.provider_applicants WHERE tenant_id=p_tenant_id
),
contacts AS MATERIALIZED (
 SELECT lower(btrim(coalesce(email,''))) email_key,
  regexp_replace(coalesce(phone,''),'[^0-9]','','g') phone_digits,do_not_contact
 FROM public.relationship_contacts WHERE tenant_id=p_tenant_id
),
classify AS MATERIALIZED (
 SELECT s.*,coalesce(e.copies,0) AS email_copies,
  CASE WHEN s.email_key='' THEN 'missing'
   WHEN NOT s.email_valid THEN 'invalid'
   WHEN coalesce(e.copies,0)>1 THEN 'duplicate'
   ELSE 'valid' END AS quality,
  EXISTS(SELECT 1 FROM applicants a WHERE
    (s.email_key<>'' AND a.email_key=s.email_key)
    OR (s.phone_valid AND a.phone_digits=s.phone_digits)) AS matching_applicant,
  EXISTS(SELECT 1 FROM contacts c WHERE
    (s.email_key<>'' AND c.email_key=s.email_key)
    OR (s.phone_valid AND c.phone_digits=s.phone_digits)) AS matching_contact,
  (
   EXISTS(SELECT 1 FROM public.relationship_suppressions rs
    WHERE rs.tenant_id=p_tenant_id AND rs.revoked_at IS NULL
      AND rs.effective_at<=now() AND (rs.expires_at IS NULL OR rs.expires_at>now())
      AND (rs.scope='global' OR
         (s.email_key<>'' AND rs.scope='email' AND lower(btrim(rs.email))=s.email_key))
   )
   OR EXISTS(SELECT 1 FROM public.crm_newsletter_suppressions ns
    WHERE ns.tenant_id=p_tenant_id AND ns.revoked_at IS NULL
     AND s.email_key<>'' AND lower(btrim(ns.example_email))=s.email_key)
   OR EXISTS(SELECT 1 FROM contacts c WHERE c.do_not_contact
    AND ((s.email_key<>'' AND c.email_key=s.email_key)
      OR (s.phone_valid AND c.phone_digits=s.phone_digits)))
  ) AS external_suppression
 FROM source s LEFT JOIN emails e ON e.email_key=s.email_key
),
qualified AS MATERIALIZED (
 SELECT c.*,
  (NOT c.outreach_contactable OR c.outreach_exclusion_reason IS NOT NULL
    OR c.external_suppression) AS suppressed_flag
 FROM classify c
)
SELECT jsonb_build_object(
  'id',q.id,'firstName',q.first_name,'lastName',q.last_name,
  'email',q.email,'phone',q.phone,'linkedIn',q.linkedin_profile,
  'licenseType',q.license_type,'state',q.state,'licensedStates',q.licensed_states,
  'contactable',q.outreach_contactable,'exclusionReason',q.outreach_exclusion_reason,
  'ownerProfileId',q.owner_profile_id,'nextAction',q.next_action,
  'nextActionDueAt',q.next_action_due_at,'notes',q.notes,'version',q.version,
  'status',q.effective_stage,'recruitingStage',coalesce(q.recruiting_stage,'not_contacted'),'createdAt',q.created_at,'updatedAt',q.updated_at,
  'emailQuality',q.quality,'phoneValid',q.phone_valid,
  'duplicateEmailCount',q.email_copies,
  'emailReviewStatus',coalesce(q.email_review_status,'unverified'),
  'suppressed',q.suppressed_flag,'possibleApplicant',q.matching_applicant,
  'possibleContact',q.matching_contact,
  'emailPreviewEligible',(
   q.effective_stage='ready' AND q.email_review_status='verified'
   AND q.quality='valid' AND NOT q.suppressed_flag
   AND NOT q.matching_applicant AND NOT q.matching_contact
  )
 ),q.id,q.created_at,q.effective_stage,q.owner_profile_id,q.state,q.licensed_states,
 q.quality,coalesce(q.email_review_status,'unverified'),q.suppressed_flag,
 q.matching_applicant,q.matching_contact,
 (q.effective_stage='ready' AND q.email_review_status='verified' AND q.quality='valid'
   AND NOT q.suppressed_flag AND NOT q.matching_applicant AND NOT q.matching_contact),
 q.next_action,q.next_action_due_at
FROM qualified q
$function$
;
REVOKE ALL ON FUNCTION private.crm_recruitment_quality_rows(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.crm_recruitment_communication_timeline(p_tenant_id uuid, p_prospect_id uuid, p_limit integer DEFAULT 80)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v jsonb;v_email text;v_applicant uuid;v_verified boolean;v_matches integer;
BEGIN
 IF (select auth.uid()) IS NULL
 OR NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment timeline access denied' USING ERRCODE='42501'; END IF;
 SELECT lower(btrim(p.email)),w.email_review_status='verified'
 INTO v_email,v_verified FROM public.therapist_outreach_prospects p
 JOIN public.crm_therapist_prospect_workflow w ON w.tenant_id=p.tenant_id AND w.prospect_id=p.id
 WHERE p.tenant_id=p_tenant_id AND p.id=p_prospect_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Prospect not found in tenant' USING ERRCODE='42501'; END IF;
 SELECT applicant_id INTO v_applicant FROM public.crm_therapist_prospect_applicant_links
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id;
 SELECT count(*) INTO v_matches FROM public.therapist_outreach_prospects p
 WHERE p.tenant_id=p_tenant_id AND v_email<>'' AND lower(btrim(p.email))=v_email;
 WITH raw AS (
  SELECT e.created_at AS at,e.id::text AS event_id,'crm_change'::text AS source,
    'internal'::text AS channel,'internal'::text AS direction,
    'recorded'::text AS status,'CRM review history'::text AS subject,
    e.reason AS summary,NULL::text AS thread_id
   FROM public.crm_therapist_prospect_events e
   WHERE e.tenant_id=p_tenant_id AND e.prospect_id=p_prospect_id
  UNION ALL
  SELECT e.occurred_at,e.id::text,'manual_activity',e.channel,e.direction,
   e.outcome,'Recruiter activity',e.summary,NULL::text
  FROM public.crm_therapist_prospect_contact_events e
   WHERE e.tenant_id=p_tenant_id AND e.prospect_id=p_prospect_id
  UNION ALL
  SELECT m.occurred_at,m.id::text,'applicant_email','email',m.direction,
   m.status,coalesce(m.subject,'(No subject)'),
   'Stored applicant email status (content available in applicant communications)',m.provider_thread_id
  FROM public.crm_email_messages m
   WHERE v_applicant IS NOT NULL AND m.tenant_id=p_tenant_id
    AND m.provider_applicant_id=v_applicant
  UNION ALL
  SELECT a.occurred_at,a.id::text,'applicant_activity','internal','internal',
   a.event_type,'Applicant event',
   left(coalesce(nullif(a.note,''),a.event_type),1000),NULL::text
  FROM public.provider_applicant_activity_events a
   WHERE v_applicant IS NOT NULL AND a.tenant_id=p_tenant_id AND a.applicant_id=v_applicant
  UNION ALL
  SELECT c.occurred_at,c.id::text,'relationship_email',c.channel,c.direction,c.status,
   coalesce(c.subject,'(No subject)'),
   'Matched CRM email metadata only; email body is not exposed here',c.provider_thread_id
  FROM public.relationship_communications c
  WHERE coalesce(v_verified,false) AND v_matches=1
   AND v_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
   AND c.tenant_id=p_tenant_id AND c.channel='email'
   AND (CASE WHEN c.direction='inbound' THEN lower(btrim(coalesce(c.sender_email,'')))=v_email
             ELSE lower(btrim(coalesce(c.recipient_email,'')))=v_email END)
 ), recent AS (
 SELECT * FROM raw ORDER BY at DESC,event_id DESC LIMIT greatest(1,least(coalesce(p_limit,80),100))
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'at',at,'id',event_id,'source',source,'channel',channel,'direction',direction,
   'status',status,'subject',subject,'summary',summary,'threadId',thread_id)
   ORDER BY at DESC,event_id DESC),'[]'::jsonb) INTO v FROM recent;
 RETURN v;
END $function$
;
REVOKE ALL ON FUNCTION public.crm_recruitment_communication_timeline(uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_communication_timeline(uuid,uuid,integer) TO authenticated;
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
 UPDATE public.crm_therapist_prospect_workflow
 SET recruiting_stage='applicant_linked',version=version+1,
  updated_by=v_actor,updated_at=now()
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id;
 INSERT INTO public.crm_therapist_prospect_events
 (tenant_id,prospect_id,actor_profile_id,old_status,new_status,reason)
 SELECT p_tenant_id,p_prospect_id,v_actor,w.workflow_status,w.workflow_status,
    'Linked existing applicant '||p_applicant_id::text||': '||btrim(p_reason)
 FROM public.crm_therapist_prospect_workflow w
 WHERE w.tenant_id=p_tenant_id AND w.prospect_id=p_prospect_id;
 RETURN true;
END $function$
;
REVOKE ALL ON FUNCTION public.crm_recruitment_link_existing_applicant(uuid,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_link_existing_applicant(uuid,uuid,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';