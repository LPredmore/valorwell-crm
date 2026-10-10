-- CRM recruiter state search (Phase 25/26):
-- full US state name or abbreviation, plus independent exact location/licensure state filter.
-- Existing v1 CRM prospect RPC intentionally retained for backward compatibility.
-- Direct access to protected therapist_outreach_prospects remains revoked.
CREATE OR REPLACE FUNCTION public.crm_list_therapist_prospects_filtered(p_tenant_id uuid, p_page integer DEFAULT 1, p_page_size integer DEFAULT 200, p_search text DEFAULT NULL::text, p_prospect_id uuid DEFAULT NULL::uuid, p_state text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
DECLARE v_page integer := greatest(1,least(coalesce(p_page,1),1000));
DECLARE v_size integer := greatest(1,least(coalesce(p_page_size,200),200));
DECLARE v_search text := left(lower(btrim(coalesce(p_search,''))),120);
DECLARE v_state_names constant jsonb := '{"alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA","colorado":"CO","connecticut":"CT","delaware":"DE","district of columbia":"DC","florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS","kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI","minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV","new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK","oregon":"OR","pennsylvania":"PA","puerto rico":"PR","rhode island":"RI","south carolina":"SC","south dakota":"SD","tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA","west virginia":"WV","wisconsin":"WI","wyoming":"WY"}'::jsonb;
DECLARE v_search_state text;
DECLARE v_filter_state text;
BEGIN
 IF (select auth.uid()) IS NULL
  OR NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
  OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'CRM therapist prospect access denied' USING ERRCODE='42501'; END IF;
 -- Resolve full state names and postal abbreviations exactly; never treat
 -- two-letter state codes as arbitrary substrings of another person's name.
 SELECT st.value INTO v_search_state FROM jsonb_each_text(v_state_names) st
 WHERE st.key=v_search OR st.value=upper(v_search) LIMIT 1;
 SELECT st.value INTO v_filter_state FROM jsonb_each_text(v_state_names) st
 WHERE st.key=lower(btrim(coalesce(p_state,''))) OR st.value=upper(btrim(coalesce(p_state,'')))
 LIMIT 1;
 IF nullif(btrim(coalesce(p_state,'')),'') IS NOT NULL AND v_filter_state IS NULL THEN
   RAISE EXCEPTION 'Unknown US state filter';
 END IF;
 WITH matches AS MATERIALIZED (
  SELECT p.id,p.tenant_id,p.first_name,p.last_name,p.email,p.phone,
   p.linkedin_profile,p.license_type,p.state,p.licensed_states,
   p.outreach_contactable,p.outreach_exclusion_reason,
   p.created_at,p.updated_at,
   coalesce(w.owner_profile_id,NULL::uuid) AS owner_profile_id,
   coalesce(w.next_action,NULL::text) AS next_action,
   w.next_action_due_at,w.notes,coalesce(w.version,0) AS version,
   CASE WHEN NOT p.outreach_contactable OR p.outreach_exclusion_reason IS NOT NULL THEN 'blocked'
        ELSE coalesce(w.workflow_status,'review') END AS workflow_status
  FROM public.therapist_outreach_prospects p
  LEFT JOIN public.crm_therapist_prospect_workflow w
    ON w.tenant_id=p.tenant_id AND w.prospect_id=p.id
  WHERE p.tenant_id=p_tenant_id
    AND (p_prospect_id IS NULL OR p.id=p_prospect_id)
    AND (v_filter_state IS NULL OR (upper(btrim(coalesce(p.state,'')))=v_filter_state
      OR coalesce(p.licensed_states,'[]'::jsonb) ? v_filter_state))
    AND (v_search='' OR
        (v_search_state IS NOT NULL AND (upper(btrim(coalesce(p.state,'')))=v_search_state
      OR coalesce(p.licensed_states,'[]'::jsonb) ? v_search_state))
        OR (v_search_state IS NULL AND
         (strpos(lower(coalesce(p.first_name,'')),v_search)>0
         OR strpos(lower(coalesce(p.last_name,'')),v_search)>0
         OR strpos(lower(coalesce(p.email,'')),v_search)>0
         OR strpos(lower(coalesce(p.license_type,'')),v_search)>0
         OR strpos(lower(coalesce(p.state,'')),v_search)>0)))
 ), page_rows AS (
  SELECT * FROM matches ORDER BY created_at DESC,id DESC
  LIMIT v_size OFFSET (v_page-1)*v_size
 )
 SELECT jsonb_build_object(
  'total',(SELECT count(*) FROM matches),
  'page',v_page,
  'pageSize',v_size,
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'firstName',first_name,'lastName',last_name,
   'email',email,'phone',phone,'linkedIn',linkedin_profile,
   'licenseType',license_type,'state',state,'licensedStates',licensed_states,
   'contactable',outreach_contactable,'exclusionReason',outreach_exclusion_reason,
   'ownerProfileId',owner_profile_id,'nextAction',next_action,
   'nextActionDueAt',next_action_due_at,'notes',notes,'version',version,
   'status',workflow_status,'createdAt',created_at,'updatedAt',updated_at
  ) ORDER BY created_at DESC,id DESC) FROM page_rows),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $function$
;
REVOKE ALL ON FUNCTION public.crm_list_therapist_prospects_filtered(uuid,integer,integer,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_list_therapist_prospects_filtered(uuid,integer,integer,text,uuid,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
