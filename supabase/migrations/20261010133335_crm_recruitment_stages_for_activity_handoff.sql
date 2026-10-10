-- Show recruitment progress alongside authoritative applicant stages, without
-- changing any existing stage IDs, underlying applicant statuses or send systems.
DO $setup$
DECLARE v_pipeline uuid:='197bfeb7-a1d2-4c26-842f-045b5256d9e4';
DECLARE v_tenant uuid:='00000000-0000-0000-0000-000000000001';
BEGIN
 IF (SELECT count(*) FROM public.crm_pipeline_stages WHERE pipeline_id=v_pipeline)<>9
 THEN RAISE EXCEPTION 'Expected nine existing clinician stages; inspect before altering'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.crm_pipelines WHERE id=v_pipeline
   AND tenant_id=v_tenant AND source_key='provider_applicants') THEN
  RAISE EXCEPTION 'Unexpected clinician pipeline tenant/source'; END IF;
 UPDATE public.crm_pipeline_stages SET position=position+100 WHERE pipeline_id=v_pipeline;
 INSERT INTO public.crm_pipeline_stages(tenant_id,pipeline_id,name,position,is_terminal,source_stage_key)
 VALUES
 (v_tenant,v_pipeline,'Prospects — Contact Attempted',2,false,'outreach_contact_attempted'),
 (v_tenant,v_pipeline,'Prospects — Responded',3,false,'outreach_replied'),
 (v_tenant,v_pipeline,'Prospects — Interested',4,false,'outreach_interested'),
 (v_tenant,v_pipeline,'Prospects — Application Handoff',5,false,'outreach_application_handoff'),
 (v_tenant,v_pipeline,'Prospects — Application Linked',6,false,'outreach_applicant_linked'),
 (v_tenant,v_pipeline,'Prospects — Closed',14,true,'outreach_closed');
 UPDATE public.crm_pipeline_stages SET position=CASE source_stage_key
  WHEN 'outreach_review' THEN 0
  WHEN 'outreach_ready' THEN 1
  WHEN 'new' THEN 7 WHEN 'contacted' THEN 8 WHEN 'website_new' THEN 9
  WHEN 'screening' THEN 10 WHEN 'application' THEN 11 WHEN 'ready' THEN 12
  WHEN 'outreach_blocked' THEN 13
  ELSE position END
 WHERE pipeline_id=v_pipeline AND position>=100;
 IF (SELECT count(*) FROM public.crm_pipeline_stages WHERE pipeline_id=v_pipeline)<>15
 THEN RAISE EXCEPTION 'Unexpected clinician stage count after migration'; END IF;
END $setup$;