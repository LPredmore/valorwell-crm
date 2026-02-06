-- Add recipient_type discriminator to bulk_send_logs
ALTER TABLE crm_bulk_send_logs 
ADD COLUMN recipient_type TEXT NOT NULL DEFAULT 'client' 
CHECK (recipient_type IN ('client', 'staff'));

-- Index for filtering by recipient type
CREATE INDEX idx_bulk_send_logs_recipient_type 
ON crm_bulk_send_logs(recipient_type);

-- Create staff recipients table (mirrors crm_bulk_send_recipients structure)
CREATE TABLE crm_bulk_send_staff_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_send_id UUID NOT NULL REFERENCES crm_bulk_send_logs(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX idx_bulk_send_staff_recipients_bulk_send 
ON crm_bulk_send_staff_recipients(bulk_send_id);

CREATE INDEX idx_bulk_send_staff_recipients_status 
ON crm_bulk_send_staff_recipients(bulk_send_id, status);

-- Enable RLS
ALTER TABLE crm_bulk_send_staff_recipients ENABLE ROW LEVEL SECURITY;

-- RLS policies (matching client recipients pattern exactly)
CREATE POLICY "Users can view staff recipients in their tenant"
  ON crm_bulk_send_staff_recipients FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE profile_id = auth.uid()
  ));

CREATE POLICY "Users can insert staff recipients in their tenant"
  ON crm_bulk_send_staff_recipients FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE profile_id = auth.uid()
  ));

CREATE POLICY "Users can update staff recipients in their tenant"
  ON crm_bulk_send_staff_recipients FOR UPDATE
  USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE profile_id = auth.uid()
  ));