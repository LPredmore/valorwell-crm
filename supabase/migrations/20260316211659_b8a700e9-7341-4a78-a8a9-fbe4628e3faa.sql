-- Drop the overly broad unique constraint
ALTER TABLE crm_campaign_enrollments DROP CONSTRAINT crm_campaign_enrollments_unique_client;

-- Replace with partial unique index: only one active enrollment per client per tenant
CREATE UNIQUE INDEX crm_campaign_enrollments_one_active
ON crm_campaign_enrollments (tenant_id, client_id)
WHERE status = 'active';