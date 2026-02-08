-- Create inbound SMS log table for SMS tab visibility
CREATE TABLE crm_inbound_sms_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  client_id UUID REFERENCES clients(id),
  from_phone TEXT NOT NULL,
  to_phone TEXT NOT NULL,
  message_body TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ringcentral_message_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient client lookups
CREATE INDEX idx_crm_inbound_sms_client ON crm_inbound_sms_logs(client_id);
CREATE INDEX idx_crm_inbound_sms_tenant ON crm_inbound_sms_logs(tenant_id);
CREATE INDEX idx_crm_inbound_sms_from_phone ON crm_inbound_sms_logs(from_phone);

-- RLS policies
ALTER TABLE crm_inbound_sms_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view inbound SMS for their tenant"
ON crm_inbound_sms_logs FOR SELECT
USING (
  tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE profile_id = auth.uid()
  )
);

-- Service role needs insert access for edge function
CREATE POLICY "Service role can insert inbound SMS logs"
ON crm_inbound_sms_logs FOR INSERT
WITH CHECK (true);