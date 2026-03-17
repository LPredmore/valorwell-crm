DELETE FROM crm_activity_events
WHERE event_type = 'email_received'
  AND metadata->>'source' = 'webhook'
  AND metadata->>'helpscout_event' = 'convo.created';