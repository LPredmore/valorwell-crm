-- Keep the CRM activity-event vocabulary aligned with the campaign action RPCs.

alter table public.crm_activity_events
  drop constraint if exists crm_activity_events_event_type_check;

alter table public.crm_activity_events
  add constraint crm_activity_events_event_type_check
  check (
    event_type = any (
      array[
        'status_change',
        'note_added',
        'email_sent',
        'email_received',
        'email_suppressed',
        'sms_sent',
        'sms_received',
        'sms_suppressed',
        'conversation_linked',
        'bulk_send',
        'campaign_auto_cancelled',
        'campaign_auto_enrolled',
        'campaign_enrolled',
        'campaign_cancelled_by_policy',
        'campaign_completion_state_action_deferred',
        'campaign_enrollment_paused',
        'campaign_enrollment_resumed',
        'campaign_enrollment_cancelled',
        'campaign_enrollment_responded',
        'campaign_enrollment_restarted',
        'client_synced_to_clickup',
        'lifecycle_changed',
        'engagement_changed',
        'contact_policy_changed',
        'service_policy_changed',
        'eligibility_changed',
        'care_cadence_changed',
        'clinician_assigned',
        'closed',
        'reopened'
      ]::text[]
    )
  );
