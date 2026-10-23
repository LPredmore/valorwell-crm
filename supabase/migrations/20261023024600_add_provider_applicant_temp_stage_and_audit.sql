-- Display the temporary applicant state in the CRM without losing the original records.
-- This migration does not change applicant records or activate any campaign.
DO $temp_stage$
DECLARE
  v_pipeline uuid := '197bfeb7-a1d2-4c26-842f-045b5256d9e4';
  v_tenant uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_pipelines
    WHERE id=v_pipeline AND tenant_id=v_tenant AND source_key='provider_applicants'
  ) THEN
    RAISE EXCEPTION 'Unexpected provider-applicant pipeline identity';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages
    WHERE pipeline_id=v_pipeline AND source_stage_key='temp'
  ) THEN
    -- Move existing stages up by one while avoiding temporary uniqueness conflicts.
    UPDATE public.crm_pipeline_stages SET position=position+100
    WHERE pipeline_id=v_pipeline AND position>=8;
    UPDATE public.crm_pipeline_stages SET position=position-99
    WHERE pipeline_id=v_pipeline AND position>=108;
    INSERT INTO public.crm_pipeline_stages
      (tenant_id,pipeline_id,name,position,is_terminal,source_stage_key)
    VALUES (v_tenant,v_pipeline,'Temp',8,false,'temp');
  END IF;
END $temp_stage$;

-- Administrator-only audit for restoring the intentionally parked legacy records.
CREATE TABLE IF NOT EXISTS private.provider_applicant_temp_pilot_audit (
  pilot_key text NOT NULL,
  tenant_id uuid NOT NULL,
  applicant_id uuid NOT NULL,
  previous_status text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (pilot_key, applicant_id)
);
ALTER TABLE private.provider_applicant_temp_pilot_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.provider_applicant_temp_pilot_audit FROM PUBLIC, anon, authenticated;
