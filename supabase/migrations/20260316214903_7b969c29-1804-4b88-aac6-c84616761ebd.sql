
-- Drop the old check constraint and recreate with 'campaign_auto_enrolled' added
ALTER TABLE crm_activity_events DROP CONSTRAINT crm_activity_events_event_type_check;

ALTER TABLE crm_activity_events ADD CONSTRAINT crm_activity_events_event_type_check
CHECK (event_type IN (
  'status_change',
  'note_added',
  'email_sent',
  'email_received',
  'conversation_linked',
  'bulk_send',
  'campaign_auto_cancelled',
  'campaign_auto_enrolled',
  'sms_sent',
  'sms_received'
));
