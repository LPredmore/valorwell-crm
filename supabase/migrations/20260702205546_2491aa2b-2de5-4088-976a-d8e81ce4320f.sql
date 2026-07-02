-- Prevent duplicate scheduled campaign step logs (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS crm_campaign_step_logs_one_scheduled
  ON public.crm_campaign_step_logs (enrollment_id, step_id)
  WHERE status = 'scheduled';

-- Allow inbound SMS to log without a tenant match rather than silent-fail or mis-attribute
ALTER TABLE public.crm_inbound_sms_logs ALTER COLUMN tenant_id DROP NOT NULL;