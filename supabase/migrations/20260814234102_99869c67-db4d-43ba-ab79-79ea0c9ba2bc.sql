-- =========================================================
-- Phase 27: permissions / RLS tightening pass
-- Read policies already exist but no table privileges were granted,
-- so PostgREST reads failed and worker writes relied on implicit access.
-- =========================================================

-- Staff-readable control-plane tables (RLS already restricts to tenant members).
GRANT SELECT ON public.crm_newsletters TO authenticated;
GRANT SELECT ON public.crm_newsletter_recipients TO authenticated;
GRANT SELECT ON public.crm_newsletter_suppressions TO authenticated;
GRANT SELECT ON public.crm_audience_campaigns TO authenticated;
GRANT SELECT ON public.crm_audience_campaign_steps TO authenticated;
GRANT SELECT ON public.crm_audience_enrollments TO authenticated;
GRANT SELECT ON public.crm_audience_step_logs TO authenticated;
GRANT SELECT ON public.crm_automation_events TO authenticated;
GRANT SELECT ON public.crm_campaign_registry TO authenticated;
GRANT SELECT ON public.crm_campaign_trigger_rules TO authenticated;
GRANT SELECT ON public.crm_campaign_trigger_jobs TO authenticated;
GRANT SELECT ON public.crm_donors TO authenticated;
GRANT SELECT ON public.crm_bty_outreach_states TO authenticated;
GRANT SELECT ON public.crm_bty_outreach_state_history TO authenticated;

-- Backend workers / security-definer admin paths.
GRANT ALL ON public.crm_newsletters TO service_role;
GRANT ALL ON public.crm_newsletter_recipients TO service_role;
GRANT ALL ON public.crm_newsletter_suppressions TO service_role;
GRANT ALL ON public.crm_audience_campaigns TO service_role;
GRANT ALL ON public.crm_audience_campaign_steps TO service_role;
GRANT ALL ON public.crm_audience_enrollments TO service_role;
GRANT ALL ON public.crm_audience_step_logs TO service_role;
GRANT ALL ON public.crm_automation_events TO service_role;
GRANT ALL ON public.crm_campaign_registry TO service_role;
GRANT ALL ON public.crm_campaign_trigger_rules TO service_role;
GRANT ALL ON public.crm_campaign_trigger_jobs TO service_role;
GRANT ALL ON public.crm_donors TO service_role;
GRANT ALL ON public.crm_donor_ingest_queue TO service_role;
GRANT ALL ON public.crm_bty_outreach_states TO service_role;
GRANT ALL ON public.crm_bty_outreach_state_history TO service_role;
GRANT ALL ON public.crm_idempotency_keys TO service_role;

-- Explicitly ensure no anonymous access to any of these tables.
REVOKE ALL ON public.crm_newsletters FROM anon;
REVOKE ALL ON public.crm_newsletter_recipients FROM anon;
REVOKE ALL ON public.crm_newsletter_suppressions FROM anon;
REVOKE ALL ON public.crm_audience_campaigns FROM anon;
REVOKE ALL ON public.crm_audience_campaign_steps FROM anon;
REVOKE ALL ON public.crm_audience_enrollments FROM anon;
REVOKE ALL ON public.crm_audience_step_logs FROM anon;
REVOKE ALL ON public.crm_automation_events FROM anon;
REVOKE ALL ON public.crm_campaign_registry FROM anon;
REVOKE ALL ON public.crm_campaign_trigger_rules FROM anon;
REVOKE ALL ON public.crm_campaign_trigger_jobs FROM anon;
REVOKE ALL ON public.crm_donors FROM anon;
REVOKE ALL ON public.crm_donor_ingest_queue FROM anon;
REVOKE ALL ON public.crm_bty_outreach_states FROM anon;
REVOKE ALL ON public.crm_bty_outreach_state_history FROM anon;
REVOKE ALL ON public.crm_idempotency_keys FROM anon;

-- Donor ingest queue is worker-only: ensure RLS with no permissive policy for clients.
ALTER TABLE public.crm_donor_ingest_queue ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- Phase 28: indexing pass
-- =========================================================

-- Redundant duplicates (identical column lists).
DROP INDEX IF EXISTS public.crm_newsletter_recipients_newsletter_status_idx;
DROP INDEX IF EXISTS public.crm_newsletter_suppressions_mailbox_idx;
DROP INDEX IF EXISTS public.idx_crm_idempotency_expires;

-- Suppression growth reporting.
CREATE INDEX IF NOT EXISTS crm_newsletter_suppressions_growth_idx
  ON public.crm_newsletter_suppressions (tenant_id, created_at DESC);

-- Newsletter failure / outcome rollups.
CREATE INDEX IF NOT EXISTS crm_newsletter_recipients_tenant_status_idx
  ON public.crm_newsletter_recipients (tenant_id, status, updated_at DESC);

-- Audience step log failure rates.
CREATE INDEX IF NOT EXISTS crm_audience_step_logs_tenant_status_idx
  ON public.crm_audience_step_logs (tenant_id, status, created_at DESC);

-- Trigger job failure inspection (due path is already covered by a partial index).
CREATE INDEX IF NOT EXISTS crm_campaign_trigger_jobs_status_idx
  ON public.crm_campaign_trigger_jobs (tenant_id, status, created_at DESC);

-- =========================================================
-- Phase 29: observability metrics
-- =========================================================

CREATE OR REPLACE FUNCTION public.crm_communications_observability(p_window_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_days integer := greatest(1, least(coalesce(p_window_days, 7), 90));
  v_since timestamptz;
  v_result jsonb;
BEGIN
  SELECT m.tenant_id INTO v_tenant
  FROM public.tenant_memberships m
  WHERE m.profile_id = auth.uid()
  LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_since := now() - make_interval(days => v_days);

  SELECT jsonb_build_object(
    'windowDays', v_days,
    'generatedAt', now(),
    'queueDepth', jsonb_build_object(
      'triggerJobsPending', (
        SELECT count(*) FROM public.crm_campaign_trigger_jobs j
        WHERE j.tenant_id = v_tenant AND j.status = 'pending'
      ),
      'triggerJobsOverdue', (
        SELECT count(*) FROM public.crm_campaign_trigger_jobs j
        WHERE j.tenant_id = v_tenant AND j.status = 'pending' AND j.due_at <= now()
      ),
      'automationEventsUnprocessed', (
        SELECT count(*) FROM public.crm_automation_events e
        WHERE e.tenant_id = v_tenant AND e.processed_at IS NULL
      ),
      'audienceEnrollmentsDue', (
        SELECT count(*) FROM public.crm_audience_enrollments a
        WHERE a.tenant_id = v_tenant AND a.status = 'active' AND a.next_send_at <= now()
      ),
      'newsletterRecipientsPending', (
        SELECT count(*) FROM public.crm_newsletter_recipients r
        WHERE r.tenant_id = v_tenant AND r.status = 'pending'
      ),
      'newsletterRecipientsClaimed', (
        SELECT count(*) FROM public.crm_newsletter_recipients r
        WHERE r.tenant_id = v_tenant AND r.status = 'claimed'
      ),
      'newslettersSending', (
        SELECT count(*) FROM public.crm_newsletters n
        WHERE n.tenant_id = v_tenant AND n.status = 'sending'
      ),
      'newslettersScheduled', (
        SELECT count(*) FROM public.crm_newsletters n
        WHERE n.tenant_id = v_tenant AND n.status = 'scheduled'
      )
    ),
    'failureRates', jsonb_build_object(
      'triggerJobs', (
        SELECT jsonb_build_object(
          'total', count(*),
          'failed', count(*) FILTER (WHERE j.status = 'failed'),
          'rate', CASE WHEN count(*) = 0 THEN 0
            ELSE round((count(*) FILTER (WHERE j.status = 'failed'))::numeric / count(*), 4) END
        )
        FROM public.crm_campaign_trigger_jobs j
        WHERE j.tenant_id = v_tenant AND j.created_at >= v_since
      ),
      'audienceSteps', (
        SELECT jsonb_build_object(
          'total', count(*),
          'failed', count(*) FILTER (WHERE l.status = 'failed'),
          'rate', CASE WHEN count(*) = 0 THEN 0
            ELSE round((count(*) FILTER (WHERE l.status = 'failed'))::numeric / count(*), 4) END
        )
        FROM public.crm_audience_step_logs l
        WHERE l.tenant_id = v_tenant AND l.created_at >= v_since
      ),
      'newsletterRecipients', (
        SELECT jsonb_build_object(
          'total', count(*),
          'failed', count(*) FILTER (WHERE r.status = 'failed'),
          'bounced', count(*) FILTER (WHERE r.status = 'bounced'),
          'sent', count(*) FILTER (WHERE r.status = 'sent'),
          'rate', CASE WHEN count(*) = 0 THEN 0
            ELSE round((count(*) FILTER (WHERE r.status IN ('failed','bounced')))::numeric / count(*), 4) END
        )
        FROM public.crm_newsletter_recipients r
        WHERE r.tenant_id = v_tenant AND r.created_at >= v_since
      )
    ),
    'suppressionGrowth', jsonb_build_object(
      'total', (
        SELECT count(*) FROM public.crm_newsletter_suppressions s
        WHERE s.tenant_id = v_tenant
      ),
      'addedInWindow', (
        SELECT count(*) FROM public.crm_newsletter_suppressions s
        WHERE s.tenant_id = v_tenant AND s.created_at >= v_since
      ),
      'daily', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('day', d.day, 'added', d.added) ORDER BY d.day)
        FROM (
          SELECT date_trunc('day', s.created_at)::date AS day, count(*) AS added
          FROM public.crm_newsletter_suppressions s
          WHERE s.tenant_id = v_tenant AND s.created_at >= v_since
          GROUP BY 1
        ) d
      ), '[]'::jsonb),
      'byReason', COALESCE((
        SELECT jsonb_object_agg(x.reason, x.count)
        FROM (
          SELECT COALESCE(s.reason, 'unspecified') AS reason, count(*) AS count
          FROM public.crm_newsletter_suppressions s
          WHERE s.tenant_id = v_tenant AND s.created_at >= v_since
          GROUP BY 1
        ) x
      ), '{}'::jsonb)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_communications_observability(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_communications_observability(integer) TO authenticated;