-- External OpenRouter daily operations monitoring (read-only source metrics).
-- Deliberately no cron activation here: activation requires a working secret,
-- successful authenticated health check and verified alert delivery.
CREATE TABLE IF NOT EXISTS public.valorwell_monitor_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_day date NOT NULL UNIQUE,
  model text NOT NULL DEFAULT 'z-ai/glm-5.3-flash',
  status text NOT NULL CHECK (status IN ('running','completed','failed','delivery_failed')),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  alert_sent boolean NOT NULL DEFAULT false,
  alert_error text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.valorwell_monitor_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.valorwell_monitor_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.valorwell_monitor_runs TO service_role;

CREATE OR REPLACE FUNCTION public.valorwell_monitor_snapshot()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $func$
  SELECT jsonb_build_object(
    'observed_at', now(),
    'gmail', (
      SELECT jsonb_build_object(
        'last_sync', max(s.last_successful_sync_at),
        'last_push', max(s.last_notification_at),
        'watch_expires', max(s.gmail_watch_expiration),
        'connected', count(*) FILTER (WHERE c.status='active')
      )
      FROM private.relationship_google_connections c
      LEFT JOIN private.relationship_google_sync_state s ON s.connection_id=c.id
      WHERE c.connection_type='gmail' AND c.revoked_at IS NULL
    ),
    'crm', jsonb_build_object(
      'new_replies', (SELECT count(*) FROM public.relationship_replies WHERE status='new'),
      'unowned_replies', (SELECT count(*) FROM public.relationship_replies WHERE status='new' AND owner_profile_id IS NULL),
      'replies_without_due', (SELECT count(*) FROM public.relationship_replies WHERE status='new' AND follow_up_due_at IS NULL),
      'unowned_open_tasks', (SELECT count(*) FROM public.crm_tasks WHERE status::text <> 'completed' AND owner_id IS NULL),
      'overdue_open_tasks', (SELECT count(*) FROM public.crm_tasks WHERE status::text <> 'completed' AND due_at < now()),
      'needs_action_opportunities', (SELECT count(*) FROM public.relationship_opportunities WHERE attention_status IN ('needs_action','manual_review')),
      'overdue_next_actions', (SELECT count(*) FROM public.relationship_opportunities WHERE next_action_due_at < now() AND attention_status IN ('needs_action','manual_review','waiting_external'))
    ),
    'meetings', jsonb_build_object(
      'future_confirmed', (SELECT count(*) FROM public.relationship_meetings WHERE starts_at>=now() AND event_status='confirmed'),
      'future_missing_calendar_event', (SELECT count(*) FROM public.relationship_meetings WHERE starts_at>=now() AND event_status='confirmed' AND (external_event_id IS NULL OR calendar_id IS NULL)),
      'booked_without_future_meeting', (SELECT count(*) FROM public.relationship_opportunities o WHERE o.status='booked' AND NOT EXISTS (SELECT 1 FROM public.relationship_meetings m WHERE m.opportunity_id=o.id AND m.tenant_id=o.tenant_id AND m.starts_at>=now() AND m.event_status NOT IN ('cancelled','declined')))
    ),
    'campaigns', jsonb_build_object(
      'enabled', (SELECT count(*) FROM public.relationship_campaigns WHERE execution_enabled),
      'failed_trigger_jobs', (SELECT count(*) FROM public.crm_campaign_trigger_jobs WHERE status='failed'),
      'stale_trigger_jobs', (SELECT count(*) FROM public.crm_campaign_trigger_jobs WHERE status IN ('pending','retry') AND due_at < now()-interval '2 hours')
    ),
    'integrations', jsonb_build_object(
      'dead_letters', (SELECT count(*) FROM public.integration_outbox WHERE dead_lettered_at IS NOT NULL),
      'new_dead_letters_24h', (SELECT count(*) FROM public.integration_outbox WHERE dead_lettered_at >= now()-interval '1 day'),
      'recent_failed_emails', (SELECT count(*) FROM public.relationship_communications WHERE status='failed' AND occurred_at>=now()-interval '1 day')
    ),
    'stripe', jsonb_build_object(
      'failed_webhook_events_24h', (SELECT count(*) FROM public.stripe_webhook_events WHERE processing_status IN ('failed','error') AND received_at>=now()-interval '1 day'),
      'unprocessed_webhook_events_over_hour', (SELECT count(*) FROM public.stripe_webhook_events WHERE processed_at IS NULL AND received_at<now()-interval '1 hour' AND processing_status NOT IN ('ignored','skipped'))
    ),
    'cron', jsonb_build_object(
      'failed_jobs_24h', (SELECT count(*) FROM cron.job_run_details WHERE start_time>=now()-interval '1 day' AND status NOT IN ('succeeded','running')),
      'failed_monitor_jobs_24h', (SELECT count(*) FROM cron.job_run_details d JOIN cron.job j ON d.jobid=j.jobid WHERE d.start_time>=now()-interval '1 day' AND d.status NOT IN ('succeeded','running') AND j.jobname ~* '(relationship|gmail|google|campaign|billing|claim)')
    )
  );
$func$;
REVOKE ALL ON FUNCTION public.valorwell_monitor_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.valorwell_monitor_snapshot() TO service_role;
COMMENT ON FUNCTION public.valorwell_monitor_snapshot() IS 'Read-only operational counts/timestamps for GLM monitoring. No PHI, raw messages, names, contact details or credentials. Service-role only.';