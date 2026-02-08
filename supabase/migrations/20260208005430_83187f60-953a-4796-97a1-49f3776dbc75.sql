-- Add completion action columns to crm_campaigns
ALTER TABLE crm_campaigns 
ADD COLUMN on_complete_action TEXT NOT NULL DEFAULT 'do_nothing';

ALTER TABLE crm_campaigns 
ADD COLUMN on_complete_status TEXT DEFAULT NULL;

-- Add constraint to validate action values
ALTER TABLE crm_campaigns 
ADD CONSTRAINT crm_campaigns_on_complete_action_check 
CHECK (on_complete_action IN ('do_nothing', 'change_status'));