-- Detect new ambiguous, non-clinical relationship email issues without exporting identities.
-- Restricted aggregate-only API used by ValorWell's existing daily OpenRouter watch.
CREATE OR REPLACE FUNCTION public.valorwell_daily_watch_ambiguity_snapshot_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $body$
  SELECT jsonb_build_object(
    'open_issues', count(*),
    'pending_review', count(*) FILTER (WHERE t.review_state='needs_review'),
    'without_review_task', count(*) FILTER (WHERE t.review_task_id IS NULL),
    'new_last_24h', count(*) FILTER (WHERE i.created_at > now() - interval '24 hours'),
    'latest_created_epoch', coalesce(max(extract(epoch FROM i.created_at))::bigint,0)
  )
  FROM public.relationship_reconciliation_issues i
  LEFT JOIN private.relationship_email_issue_triage t
    ON t.tenant_id=i.tenant_id AND t.issue_id=i.id
  WHERE i.tenant_id='00000000-0000-0000-0000-000000000001'::uuid
    AND i.status='open' AND i.source IN ('gmail','resend')
    AND i.issue_type='ambiguous_email_thread';
$body$;
REVOKE ALL ON FUNCTION public.valorwell_daily_watch_ambiguity_snapshot_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.valorwell_daily_watch_ambiguity_snapshot_v1()
  TO service_role;
COMMENT ON FUNCTION public.valorwell_daily_watch_ambiguity_snapshot_v1()
  IS 'Aggregate ambiguous Gmail/Resend relationship issue counts and latest timestamp. Internal watch only; no PHI, addresses, names, or message content.';
