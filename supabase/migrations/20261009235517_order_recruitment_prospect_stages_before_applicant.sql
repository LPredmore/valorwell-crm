-- Display order only. Existing stage IDs, source status mappings and audit history remain unchanged.
DO $reorder$
DECLARE v_pipeline uuid:='197bfeb7-a1d2-4c26-842f-045b5256d9e4';
BEGIN
 IF (SELECT count(*) FROM public.crm_pipeline_stages WHERE pipeline_id=v_pipeline)<>9
 OR (SELECT count(DISTINCT source_stage_key) FROM public.crm_pipeline_stages WHERE pipeline_id=v_pipeline)<>9
 THEN RAISE EXCEPTION 'Clinician stage configuration changed: review before reordering'; END IF;
 UPDATE public.crm_pipeline_stages SET position=position+100 WHERE pipeline_id=v_pipeline;
 UPDATE public.crm_pipeline_stages SET position=CASE source_stage_key
   WHEN 'outreach_review' THEN 0 WHEN 'outreach_ready' THEN 1
   WHEN 'new' THEN 2 WHEN 'contacted' THEN 3
   WHEN 'website_new' THEN 4 WHEN 'screening' THEN 5
   WHEN 'application' THEN 6 WHEN 'ready' THEN 7
   WHEN 'outreach_blocked' THEN 8 ELSE position
 END WHERE pipeline_id=v_pipeline;
 IF EXISTS (SELECT 1 FROM public.crm_pipeline_stages WHERE pipeline_id=v_pipeline AND position>8)
 THEN RAISE EXCEPTION 'Unexpected clinician stage key: reordering aborted'; END IF;
END $reorder$;
