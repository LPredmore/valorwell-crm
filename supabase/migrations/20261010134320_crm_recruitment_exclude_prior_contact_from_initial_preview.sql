-- A previously contacted, responded, linked, handed off or closed prospect
-- is NOT eligible for the *initial* recruitment outreach campaign preview,
-- even with manually verified email identity. Does not enable sends.
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
   q.effective_stage='ready' AND coalesce(q.recruiting_stage,'not_contacted')='not_contacted' AND q.email_review_status='verified'
   AND q.quality='valid' AND NOT q.suppressed_flag
   AND NOT q.matching_applicant AND NOT q.matching_contact
  )
 ),q.id,q.created_at,q.effective_stage,q.owner_profile_id,q.state,q.licensed_states,
 q.quality,coalesce(q.email_review_status,'unverified'),q.suppressed_flag,
 q.matching_applicant,q.matching_contact,
 (q.effective_stage='ready' AND coalesce(q.recruiting_stage,'not_contacted')='not_contacted' AND q.email_review_status='verified' AND q.quality='valid'
   AND NOT q.suppressed_flag AND NOT q.matching_applicant AND NOT q.matching_contact),
 q.next_action,q.next_action_due_at
FROM qualified q
$function$
;
REVOKE ALL ON FUNCTION private.crm_recruitment_quality_rows(uuid) FROM PUBLIC,anon,authenticated;