-- Daily, read-only ValorWell operational exception watch.
-- No personal, clinical, message-body, or payment data is returned to the model.
CREATE TABLE IF NOT EXISTS public.valorwell_daily_watch_runs (
  run_day date PRIMARY KEY,
  model text NOT NULL DEFAULT 'z-ai/glm-5.3-flash',
  status text NOT NULL CHECK (status IN ('ok','notify_failed','model_failed')),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  notified boolean NOT NULL DEFAULT false,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.valorwell_daily_watch_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.valorwell_daily_watch_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.valorwell_daily_watch_runs TO service_role;

CREATE OR REPLACE FUNCTION public.valorwell_daily_watch_snapshot_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $watch$
SELECT jsonb_build_object(
  'observed_at_utc', now(),
  'gmail', (
    SELECT jsonb_build_object(
      'sync_age_minutes', CASE WHEN max(s.last_successful_sync_at) IS NULL THEN null
        ELSE floor(extract(epoch FROM now()-max(s.last_successful_sync_at))/60)::integer END,
      'watch_expires_in_hours', CASE WHEN max(s.gmail_watch_expiration) IS NULL THEN null
        ELSE floor(extract(epoch FROM max(s.gmail_watch_expiration)-now())/3600)::integer END,
      'push_ever_observed', (max(s.last_notification_at) IS NOT NULL),
      'recent_error_count', count(*) FILTER (WHERE s.last_error_code IS NOT NULL)
    )
    FROM private.relationship_google_connections c
      JOIN private.relationship_google_sync_state s ON s.connection_id = c.id
    WHERE c.connection_type='gmail' AND c.revoked_at IS NULL
      AND lower(c.google_account_email)='info@valorwell.org'
  ),
  'new_replies', (
    SELECT jsonb_build_object(
      'count', count(*),
      'unassigned', count(*) FILTER (WHERE owner_profile_id IS NULL),
      'without_followup_due', count(*) FILTER (WHERE follow_up_due_at IS NULL)
    )
    FROM public.relationship_replies
    WHERE tenant_id='00000000-0000-0000-0000-000000000001'::uuid AND status='new'
  ),
  'crm_tasks', (
    SELECT jsonb_build_object(
      'open', count(*),
      'unassigned_open', count(*) FILTER (WHERE owner_id IS NULL),
      'overdue_open', count(*) FILTER (WHERE due_at<now())
    )
    FROM public.crm_tasks
    WHERE tenant_id='00000000-0000-0000-0000-000000000001'::uuid AND status::text <> 'completed'
  ),
  'opportunities', (
    SELECT jsonb_build_object(
      'actionable_overdue', count(*) FILTER (
         WHERE next_action_due_at<now()
           AND attention_status IN ('manual_review','needs_action','waiting_external')),
      'unowned', count(*) FILTER (WHERE owner_profile_id IS NULL)
    )
    FROM public.relationship_opportunities
    WHERE tenant_id='00000000-0000-0000-0000-000000000001'::uuid
  ),
  'campaigns', (
    SELECT jsonb_build_object(
      'enabled', count(*) FILTER (WHERE execution_enabled),
      'inactive', count(*) FILTER (WHERE NOT execution_enabled)
    )
    FROM public.relationship_campaigns
    WHERE tenant_id='00000000-0000-0000-0000-000000000001'::uuid
  ),
  'campaign_trigger_jobs', (
    SELECT jsonb_build_object(
      'failed', count(*) FILTER (WHERE status IN ('failed','dead_letter')),
      'overdue_unprocessed', count(*) FILTER (WHERE due_at<now() AND status IN ('pending','queued'))
    )
    FROM public.crm_campaign_trigger_jobs
    WHERE tenant_id='00000000-0000-0000-0000-000000000001'::uuid
  ),
  'meetings', (
    SELECT jsonb_build_object(
      'future', count(*),
      'future_unlinked', count(*) FILTER (WHERE external_event_id IS NULL OR opportunity_id IS NULL)
    )
    FROM public.relationship_meetings
    WHERE tenant_id='00000000-0000-0000-0000-000000000001'::uuid
      AND starts_at > now() AND event_status NOT IN ('cancelled','declined')
  ),
  'outbox', (
    SELECT jsonb_build_object(
      'dead_lettered_24h', count(*) FILTER (WHERE dead_lettered_at > now()-interval '24 hours'),
      'stuck_ready', count(*) FILTER (WHERE available_at < now()-interval '2 hours'
        AND delivered_at IS NULL AND dead_lettered_at IS NULL AND status::text IN ('pending','retry'))
    )
    FROM public.integration_outbox
    WHERE tenant_id='00000000-0000-0000-0000-000000000001'::uuid
  ),
  'stripe', (
    SELECT jsonb_build_object(
      'failed_24h', count(*) FILTER (WHERE processing_status IN ('failed','error') AND received_at>now()-interval '24 hours'),
      'unprocessed_older_than_hour', count(*) FILTER (
        WHERE processing_status NOT IN ('processed','ignored','completed')
          AND received_at<now()-interval '1 hour')
    )
    FROM public.stripe_webhook_events WHERE stripe_account_id='acct_1OprKCK6NXPL7Vzo'
  ),
  'cron', (
    SELECT jsonb_build_object(
      'failed_runs_24h', count(*)
    )
    FROM cron.job_run_details
    WHERE start_time>now()-interval '24 hours'
      AND status='failed'
      AND jobid IN (SELECT jobid FROM cron.job WHERE jobname IN (
        'relationship-google-hourly-reconciliation',
        'relationship-gmail-historical-backfill',
        'relationship-email-evidence-hourly-refresh',
        'relationship-google-daily-watch-renewal'))
  )
);
$watch$;
REVOKE ALL ON FUNCTION public.valorwell_daily_watch_snapshot_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.valorwell_daily_watch_snapshot_v1() TO service_role;
COMMENT ON FUNCTION public.valorwell_daily_watch_snapshot_v1() IS
'Operational aggregate-only health snapshot for server-side OpenRouter watch; no names, PHI, message content, or tokens.';
