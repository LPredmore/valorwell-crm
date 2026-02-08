-- Add read status to inbound SMS
ALTER TABLE crm_inbound_sms_logs 
ADD COLUMN is_read BOOLEAN NOT NULL DEFAULT false;

-- Index for efficient filtering on unread messages
CREATE INDEX idx_crm_inbound_sms_is_read 
ON crm_inbound_sms_logs(tenant_id, is_read) 
WHERE is_read = false;