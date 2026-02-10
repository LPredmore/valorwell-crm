ALTER TABLE crm_activity_events
  DROP CONSTRAINT crm_activity_events_event_type_check;

ALTER TABLE crm_activity_events
  ADD CONSTRAINT crm_activity_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'status_change',
    'note_added',
    'email_sent',
    'email_received',
    'conversation_linked',
    'bulk_send',
    'campaign_auto_cancelled',
    'sms_sent',
    'sms_received'
  ]));