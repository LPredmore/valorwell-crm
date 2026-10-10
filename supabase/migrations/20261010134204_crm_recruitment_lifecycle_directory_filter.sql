-- Allow filtering the recruitment directory by audited contact lifecycle stages
-- without changing the authorized RPC signature or sending messages.
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
  AND (nullif(btrim(coalesce(p_workflow,'')),'') IS NULL OR q.stage=p_workflow
    OR (left(p_workflow,11)='recruiting:' AND (q.item->>'recruitingStage')=substring(p_workflow from 12)))
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
NOTIFY pgrst,'reload schema';