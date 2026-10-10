-- Read-only, no send/enrollment/automation.
CREATE OR REPLACE FUNCTION public.crm_recruitment_campaign_preview(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_count integer; v_i integer; v_page jsonb; v_items jsonb:='[]'::jsonb; v_res jsonb;
BEGIN
 v_page:=public.crm_recruitment_review_queue(p_tenant_id,1,200,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
 v_count:=coalesce((v_page->>'total')::integer,0);
 v_items:=coalesce(v_page->'items','[]'::jsonb);
 FOR v_i IN 2..least(1000,ceil(v_count/200.0)::integer) LOOP
   v_page:=public.crm_recruitment_review_queue(p_tenant_id,v_i,200,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
   v_items:=v_items||coalesce(v_page->'items','[]'::jsonb);
 END LOOP;
 SELECT jsonb_build_object(
  'total',count(*),
  'review',count(*) FILTER(WHERE item->>'status'='review'),
  'ready',count(*) FILTER(WHERE item->>'status'='ready'),
  'blocked',count(*) FILTER(WHERE item->>'status'='blocked'),
  'emailMissing',count(*) FILTER(WHERE item->>'emailQuality'='missing'),
  'emailInvalid',count(*) FILTER(WHERE item->>'emailQuality'='invalid'),
  'emailDuplicate',count(*) FILTER(WHERE item->>'emailQuality'='duplicate'),
  'emailValid',count(*) FILTER(WHERE item->>'emailQuality'='valid'),
  'suppressed',count(*) FILTER(WHERE item->>'suppressed'='true'),
  'possibleIdentityMatch',count(*) FILTER(WHERE item->>'possibleApplicant'='true' OR item->>'possibleContact'='true'),
  'emailReviewed',count(*) FILTER(WHERE item->>'emailReviewStatus'='verified'),
  'technicallyReady',count(*) FILTER(WHERE item->>'emailPreviewEligible'='true'),
  'sendingEnabled',false,
  'note','Read-only dry-run. Contact review does not establish consent or authorize delivery. No contacts enrolled or messages sent.')
 INTO v_res FROM jsonb_array_elements(v_items) t(item);
 RETURN v_res;
END $function$
;
REVOKE ALL ON FUNCTION public.crm_recruitment_campaign_preview(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_campaign_preview(uuid) TO authenticated;