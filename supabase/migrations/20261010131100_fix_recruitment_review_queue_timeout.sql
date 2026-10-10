-- Phase 25–28 recruitment production timeout fix: all qualifying rows in one
-- set-based pass, no repeated nested page scans or quadratic JSON concatenation.
-- Auth guards and service-only data isolation preserved.
CREATE OR REPLACE FUNCTION private.crm_recruitment_quality_rows(p_tenant_id uuid)
 RETURNS TABLE(item jsonb, prospect_id uuid, created_at timestamp with time zone, stage text, owner_id uuid, state_code text, licensed_states jsonb, email_quality text, email_review text, suppressed boolean, possible_applicant boolean, possible_contact boolean, preview_eligible boolean, next_action text, due_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
WITH source AS MATERIALIZED (
 SELECT p.*,w.owner_profile_id,w.workflow_status,w.next_action,w.next_action_due_at,
  w.notes,w.email_review_status,coalesce(w.version,0) as version,
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
  'status',q.effective_stage,'createdAt',q.created_at,'updatedAt',q.updated_at,
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
CREATE OR REPLACE FUNCTION public.crm_recruitment_review_queue(p_tenant_id uuid, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_search text DEFAULT NULL::text, p_prospect_id uuid DEFAULT NULL::uuid, p_state text DEFAULT NULL::text, p_workflow text DEFAULT NULL::text, p_quality text DEFAULT NULL::text, p_due text DEFAULT NULL::text, p_owner uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_out jsonb;
 v_page integer:=greatest(1,least(coalesce(p_page,1),1000));
 v_size integer:=greatest(1,least(coalesce(p_page_size,50),200));
 v_search text:=left(lower(btrim(coalesce(p_search,''))),120);
 v_search_state text;v_state text;
 v_state_names constant jsonb := '{"alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA","colorado":"CO","connecticut":"CT","delaware":"DE","district of columbia":"DC","florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS","kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI","minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV","new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK","oregon":"OR","pennsylvania":"PA","puerto rico":"PR","rhode island":"RI","south carolina":"SC","south dakota":"SD","tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA","west virginia":"WV","wisconsin":"WI","wyoming":"WY"}'::jsonb;
BEGIN
 IF (select auth.uid()) IS NULL OR
  NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
  OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'CRM therapist prospect access denied' USING ERRCODE='42501'; END IF;
 SELECT value INTO v_search_state FROM jsonb_each_text(v_state_names)
 WHERE key=v_search OR value=upper(v_search) LIMIT 1;
 SELECT value INTO v_state FROM jsonb_each_text(v_state_names)
 WHERE key=lower(btrim(coalesce(p_state,''))) OR value=upper(btrim(coalesce(p_state,''))) LIMIT 1;
 IF nullif(btrim(coalesce(p_state,'')),'') IS NOT NULL AND v_state IS NULL
 THEN RAISE EXCEPTION 'Unknown US state filter'; END IF;
 WITH filtered AS MATERIALIZED (
 SELECT q.* FROM private.crm_recruitment_quality_rows(p_tenant_id) q
 WHERE (p_prospect_id IS NULL OR q.prospect_id=p_prospect_id)
  AND (v_state IS NULL OR upper(btrim(coalesce(q.state_code,'')))=v_state
   OR coalesce(q.licensed_states,'[]'::jsonb) ? v_state)
  AND (v_search='' OR
   (v_search_state IS NOT NULL AND (upper(btrim(coalesce(q.state_code,'')))=v_search_state
    OR coalesce(q.licensed_states,'[]'::jsonb) ? v_search_state))
   OR (v_search_state IS NULL AND (
    strpos(lower(coalesce(q.item->>'firstName','')),v_search)>0 OR
    strpos(lower(coalesce(q.item->>'lastName','')),v_search)>0 OR
    strpos(lower(coalesce(q.item->>'email','')),v_search)>0 OR
    strpos(lower(coalesce(q.item->>'licenseType','')),v_search)>0 OR
    strpos(lower(coalesce(q.state_code,'')),v_search)>0)))
  AND (nullif(btrim(coalesce(p_workflow,'')),'') IS NULL OR q.stage=p_workflow)
  AND (p_owner IS NULL OR q.owner_id=p_owner)
  AND (nullif(btrim(coalesce(p_quality,'')),'') IS NULL OR
   CASE p_quality
    WHEN 'email_missing' THEN q.email_quality='missing'
    WHEN 'email_invalid' THEN q.email_quality='invalid'
    WHEN 'email_duplicate' THEN q.email_quality='duplicate'
    WHEN 'email_valid' THEN q.email_quality='valid'
    WHEN 'suppressed' THEN q.suppressed
    WHEN 'possible_match' THEN q.possible_applicant OR q.possible_contact
    WHEN 'email_unverified' THEN q.email_review='unverified'
    WHEN 'preview_eligible' THEN q.preview_eligible
    ELSE false END)
  AND (nullif(btrim(coalesce(p_due,'')),'') IS NULL OR
   CASE p_due
    WHEN 'overdue' THEN q.due_at<now()
    WHEN 'next_7_days' THEN q.due_at>=now() AND q.due_at<now()+interval '7 days'
    WHEN 'missing_action' THEN nullif(btrim(coalesce(q.next_action,'')),'') IS NULL
    WHEN 'no_due_date' THEN q.due_at IS NULL
    ELSE false END)
 ), page_rows AS (
  SELECT * FROM filtered ORDER BY created_at DESC,prospect_id DESC
  LIMIT v_size OFFSET (v_page-1)*v_size
 )
 SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),
  'page',v_page,'pageSize',v_size,
  'items',coalesce((SELECT jsonb_agg(item ORDER BY created_at DESC,prospect_id DESC)
    FROM page_rows),'[]'::jsonb))
 INTO v_out;
 RETURN v_out;
END $function$
;
REVOKE ALL ON FUNCTION public.crm_recruitment_review_queue(uuid,integer,integer,text,uuid,text,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_review_queue(uuid,integer,integer,text,uuid,text,text,text,text,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.crm_recruitment_campaign_preview(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN
 IF (select auth.uid()) IS NULL OR
  NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
  OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'CRM recruitment preview access denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
  'total',count(*),
  'review',count(*) FILTER(WHERE q.stage='review'),
  'ready',count(*) FILTER(WHERE q.stage='ready'),
  'blocked',count(*) FILTER(WHERE q.stage='blocked'),
  'emailMissing',count(*) FILTER(WHERE q.email_quality='missing'),
  'emailInvalid',count(*) FILTER(WHERE q.email_quality='invalid'),
  'emailDuplicate',count(*) FILTER(WHERE q.email_quality='duplicate'),
  'emailValid',count(*) FILTER(WHERE q.email_quality='valid'),
  'suppressed',count(*) FILTER(WHERE q.suppressed),
  'possibleIdentityMatch',count(*) FILTER(WHERE q.possible_applicant OR q.possible_contact),
  'emailReviewed',count(*) FILTER(WHERE q.email_review='verified'),
  'technicallyReady',count(*) FILTER(WHERE q.preview_eligible),
  'sendingEnabled',false,
  'note','Read-only dry-run. Contact review does not establish consent or authorize delivery. No contacts enrolled or messages sent.')
 INTO result FROM private.crm_recruitment_quality_rows(p_tenant_id) q;
 RETURN result;
END $function$
;
REVOKE ALL ON FUNCTION public.crm_recruitment_campaign_preview(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_campaign_preview(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';