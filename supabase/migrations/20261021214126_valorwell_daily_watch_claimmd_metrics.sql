-- Add aggregate-only Claim.MD submission, lifecycle and ERA health metrics.
-- No claim IDs, patient identities, payer details, clinical data or raw errors leave DB.
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
  'claimmd', (
    SELECT jsonb_build_object(
      'uncertain_submission_requests', (
        SELECT count(*) FROM public.claim_submission_requests
        WHERE tenant_id='00000000-0000-0000-0000-000000000001'::uuid
          AND ((submission_state::text IN ('uncertain','failed'))
            OR (external_started_at IS NOT NULL AND external_finalized_at IS NULL
              AND created_at < now()-interval '2 hours'))
      ),
      'failed_automation_24h', (
        SELECT coalesce(sum(failed_count),0) FROM public.claim_submission_automation_runs
        WHERE tenant_id='00000000-0000-0000-0000-000000000001'::uuid
          AND started_at>now()-interval '24 hours'
      ),
      'recent_lifecycle_sync_errors', (
        SELECT count(*) FROM public.claim_clearinghouse_lifecycle
        WHERE tenant_id='00000000-0000-0000-0000-000000000001'::uuid
          AND last_sync_error IS NOT NULL AND updated_at>now()-interval '24 hours'
      ),
      'incomplete_era_imports_24h', (
        SELECT count(*) FROM public.eras
        WHERE tenant_id='00000000-0000-0000-0000-000000000001'::uuid
          AND import_status::text <> 'complete'
          AND created_at>now()-interval '24 hours'
      )
    )
  ),
  'cron', (
    SELECT jsonb_build_object(
      'maintenance_jobs_disabled', (4 - count(*) FILTER (WHERE active)),
      'maintenance_jobs_present', count(*)
    )
    FROM cron.job WHERE jobname IN (
      'relationship-google-hourly-reconciliation',
      'relationship-gmail-historical-backfill',
      'relationship-email-evidence-hourly-refresh',
      'relationship-google-daily-watch-renewal')
  )
);
$watch$;
REVOKE ALL ON FUNCTION public.valorwell_daily_watch_snapshot_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.valorwell_daily_watch_snapshot_v1() TO service_role;
