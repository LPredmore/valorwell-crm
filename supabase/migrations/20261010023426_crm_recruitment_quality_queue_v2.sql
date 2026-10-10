CREATE OR REPLACE FUNCTION public.crm_recruitment_review_queue(p_tenant_id uuid, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_search text DEFAULT NULL::text, p_prospect_id uuid DEFAULT NULL::uuid, p_state text DEFAULT NULL::text, p_workflow text DEFAULT NULL::text, p_quality text DEFAULT NULL::text, p_due text DEFAULT NULL::text, p_owner uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_all jsonb:='[]'::jsonb;
 v_page jsonb;
 v_total integer;
 v_index integer;
 v_out jsonb;
 v_p integer:=greatest(1,least(coalesce(p_page,1),1000));
 v_n integer:=greatest(1,least(coalesce(p_page_size,50),200));
BEGIN
 -- This existing RPC verifies auth.uid, tenant and CRM view permission on each call
 -- and handles full-name/abbreviation state search. Never bypass its controls.
 v_page:=public.crm_list_therapist_prospects_filtered(p_tenant_id,1,200,p_search,p_prospect_id,p_state);
 v_total:=coalesce((v_page->>'total')::integer,0);
 v_all:=coalesce(v_page->'items','[]'::jsonb);
 FOR v_index IN 2..least(1000,ceil(v_total/200.0)::integer) LOOP
  v_page:=public.crm_list_therapist_prospects_filtered(p_tenant_id,v_index,200,p_search,p_prospect_id,p_state);
  v_all:=v_all||coalesce(v_page->'items','[]'::jsonb);
 END LOOP;
 WITH base AS MATERIALIZED (
  SELECT j.value AS item,p.id,p.tenant_id,p.email,p.phone,p.outreach_contactable,p.outreach_exclusion_reason,
   w.email_review_status,
   (coalesce(p.email,'') ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') AS email_valid,
   (regexp_replace(coalesce(p.phone,''),'[^0-9]','','g') ~ '^[0-9]{10,11}$') AS phone_valid
  FROM jsonb_array_elements(v_all) j(value)
  JOIN public.therapist_outreach_prospects p ON p.id=(j.value->>'id')::uuid AND p.tenant_id=p_tenant_id
  LEFT JOIN public.crm_therapist_prospect_workflow w ON w.tenant_id=p.tenant_id AND w.prospect_id=p.id
 ), enriched AS MATERIALIZED (
  SELECT b.*,
   (SELECT count(*) FROM public.therapist_outreach_prospects d
     WHERE d.tenant_id=b.tenant_id AND nullif(btrim(coalesce(b.email,'')),'') IS NOT NULL
      AND lower(btrim(d.email))=lower(btrim(b.email))) AS email_shares,
   EXISTS (SELECT 1 FROM public.provider_applicants a WHERE a.tenant_id=b.tenant_id
    AND ((nullif(btrim(coalesce(b.email,'')),'') IS NOT NULL
      AND lower(btrim(a.email))=lower(btrim(b.email)))
     OR (b.phone_valid AND regexp_replace(coalesce(a.phone,''),'[^0-9]','','g')=regexp_replace(b.phone,'[^0-9]','','g')))
   ) AS possible_applicant,
   EXISTS (SELECT 1 FROM public.relationship_contacts c WHERE c.tenant_id=b.tenant_id
    AND ((nullif(btrim(coalesce(b.email,'')),'') IS NOT NULL
      AND lower(btrim(c.email))=lower(btrim(b.email)))
     OR (b.phone_valid AND regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=regexp_replace(b.phone,'[^0-9]','','g')))
   ) AS possible_contact,
   (EXISTS(SELECT 1 FROM public.relationship_suppressions s
     WHERE s.tenant_id=b.tenant_id AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>now())
      AND nullif(btrim(coalesce(b.email,'')),'') IS NOT NULL AND lower(btrim(s.email))=lower(btrim(b.email)))
    OR EXISTS(SELECT 1 FROM public.crm_newsletter_suppressions ns WHERE ns.tenant_id=b.tenant_id
     AND ns.revoked_at IS NULL AND nullif(btrim(coalesce(b.email,'')),'') IS NOT NULL
     AND lower(btrim(ns.example_email))=lower(btrim(b.email)))
    OR EXISTS(SELECT 1 FROM public.relationship_contacts c WHERE c.tenant_id=b.tenant_id AND c.do_not_contact
     AND ((nullif(btrim(coalesce(b.email,'')),'') IS NOT NULL AND lower(btrim(c.email))=lower(btrim(b.email)))
     OR (b.phone_valid AND regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=regexp_replace(b.phone,'[^0-9]','','g'))))
   ) AS external_suppression
  FROM base b
 ), qualified AS MATERIALIZED (
  SELECT e.*,
   (NOT e.outreach_contactable OR e.outreach_exclusion_reason IS NOT NULL OR e.external_suppression) AS suppressed,
   CASE WHEN nullif(btrim(coalesce(e.email,'')),'') IS NULL THEN 'missing'
        WHEN NOT e.email_valid THEN 'invalid'
        WHEN e.email_shares>1 THEN 'duplicate'
        ELSE 'valid' END AS email_quality,
   ((e.item->>'status')='ready' AND e.email_review_status='verified' AND e.email_valid
     AND e.email_shares=1 AND e.outreach_contactable AND e.outreach_exclusion_reason IS NULL
     AND NOT e.external_suppression AND NOT e.possible_applicant AND NOT e.possible_contact
   ) AS email_preview_eligible
  FROM enriched e
 ), eligible AS MATERIALIZED (
  SELECT * FROM qualified q
  WHERE (nullif(btrim(coalesce(p_workflow,'')),'') IS NULL OR (q.item->>'status')=p_workflow)
   AND (p_owner IS NULL OR (q.item->>'ownerProfileId')=p_owner::text)
   AND (nullif(btrim(coalesce(p_quality,'')),'') IS NULL OR
     CASE p_quality
      WHEN 'email_missing' THEN q.email_quality='missing'
      WHEN 'email_invalid' THEN q.email_quality='invalid'
      WHEN 'email_duplicate' THEN q.email_quality='duplicate'
      WHEN 'email_valid' THEN q.email_quality='valid'
      WHEN 'suppressed' THEN q.suppressed
      WHEN 'possible_match' THEN q.possible_applicant OR q.possible_contact
      WHEN 'email_unverified' THEN coalesce(q.email_review_status,'unverified')='unverified'
      WHEN 'preview_eligible' THEN q.email_preview_eligible
      ELSE false END)
   AND (nullif(btrim(coalesce(p_due,'')),'') IS NULL OR
     CASE p_due
      WHEN 'overdue' THEN (q.item->>'nextActionDueAt')::timestamptz<now()
      WHEN 'next_7_days' THEN (q.item->>'nextActionDueAt')::timestamptz>=now()
        AND (q.item->>'nextActionDueAt')::timestamptz<now()+interval '7 days'
      WHEN 'missing_action' THEN nullif(btrim(coalesce(q.item->>'nextAction','')),'') IS NULL
      WHEN 'no_due_date' THEN q.item->>'nextActionDueAt' IS NULL
      ELSE false END)
 ), paged AS (
  SELECT * FROM eligible ORDER BY (item->>'createdAt')::timestamptz DESC,id DESC
  LIMIT v_n OFFSET (v_p-1)*v_n
 )
 SELECT jsonb_build_object('total',(SELECT count(*) FROM eligible),
  'page',v_p,'pageSize',v_n,'items',
  coalesce((SELECT jsonb_agg(item || jsonb_build_object(
   'emailQuality',email_quality,'phoneValid',phone_valid,'duplicateEmailCount',email_shares,
   'emailReviewStatus',coalesce(email_review_status,'unverified'),'suppressed',suppressed,
   'possibleApplicant',possible_applicant,'possibleContact',possible_contact,
   'emailPreviewEligible',email_preview_eligible)
   ORDER BY (item->>'createdAt')::timestamptz DESC,id DESC) FROM paged),'[]'::jsonb)
 ) INTO v_out;
 RETURN v_out;
END $function$
;
REVOKE ALL ON FUNCTION public.crm_recruitment_review_queue(uuid,integer,integer,text,uuid,text,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_review_queue(uuid,integer,integer,text,uuid,text,text,text,text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
