
-- ============================================================
-- PHASE 3: A2 report read-model views (tenant-scoped, security_invoker)
-- ============================================================

-- Helper: tenant membership predicate reused in each view
-- (inlined via subquery on tenant_memberships; security_invoker=true)

-- ---------- A2.1 v_crm_reports_funnel ----------
DROP VIEW IF EXISTS public.v_crm_reports_funnel;
CREATE VIEW public.v_crm_reports_funnel WITH (security_invoker=true) AS
WITH weeks AS (
  SELECT date_trunc('week', a.created_at)::date AS bucket_start,
         (date_trunc('week', a.created_at) + interval '7 days')::date AS bucket_end,
         a.tenant_id,
         a.to_value   AS stage,
         COUNT(*)     AS entered_count
  FROM public.crm_client_state_audit a
  WHERE a.dimension='lifecycle_stage'::public.client_state_dimension_enum
  GROUP BY 1,2,3,4
),
exits AS (
  SELECT date_trunc('week', a.created_at)::date AS bucket_start,
         a.tenant_id, a.from_value AS stage, COUNT(*) AS exited_count
  FROM public.crm_client_state_audit a
  WHERE a.dimension='lifecycle_stage'::public.client_state_dimension_enum
    AND a.from_value IS NOT NULL
  GROUP BY 1,2,3
),
cur AS (
  SELECT c.tenant_id, c.lifecycle_stage::text AS stage, COUNT(*) AS current_count
  FROM public.clients c GROUP BY 1,2
),
dwell AS (
  SELECT c.tenant_id, c.lifecycle_stage::text AS stage,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (now()-c.lifecycle_stage_changed_at))/86400.0)
           AS median_days_in_stage
  FROM public.clients c
  WHERE c.lifecycle_stage_changed_at IS NOT NULL
  GROUP BY 1,2
)
SELECT
  w.tenant_id, w.bucket_start, w.bucket_end, w.stage,
  w.entered_count::int,
  COALESCE(e.exited_count,0)::int AS exited_count,
  COALESCE(cur.current_count,0)::int AS current_count,
  COALESCE(d.median_days_in_stage,0)::numeric AS median_days_in_stage
FROM weeks w
LEFT JOIN exits e  ON e.tenant_id=w.tenant_id AND e.bucket_start=w.bucket_start AND e.stage=w.stage
LEFT JOIN cur      ON cur.tenant_id=w.tenant_id AND cur.stage=w.stage
LEFT JOIN dwell d  ON d.tenant_id=w.tenant_id  AND d.stage=w.stage
WHERE w.tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id=auth.uid());

GRANT SELECT ON public.v_crm_reports_funnel TO authenticated;
REVOKE ALL ON public.v_crm_reports_funnel FROM PUBLIC, anon;

-- ---------- A2.2 v_crm_reports_engagement ----------
DROP VIEW IF EXISTS public.v_crm_reports_engagement;
CREATE VIEW public.v_crm_reports_engagement WITH (security_invoker=true) AS
WITH weeks AS (
  SELECT date_trunc('week', a.created_at)::date AS bucket_start,
         (date_trunc('week', a.created_at) + interval '7 days')::date AS bucket_end,
         a.tenant_id, a.to_value AS engagement, COUNT(*) AS entered_count
  FROM public.crm_client_state_audit a
  WHERE a.dimension='engagement_state'::public.client_state_dimension_enum
  GROUP BY 1,2,3,4
),
cur AS (
  SELECT c.tenant_id, c.engagement_state::text AS engagement, COUNT(*) AS current_count
  FROM public.clients c GROUP BY 1,2
)
SELECT
  w.tenant_id, w.bucket_start, w.bucket_end, w.engagement,
  COALESCE(cur.current_count,0)::int AS current_count,
  w.entered_count::int,
  0::numeric AS avg_days_to_normal
FROM weeks w
LEFT JOIN cur ON cur.tenant_id=w.tenant_id AND cur.engagement=w.engagement
WHERE w.tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id=auth.uid());

GRANT SELECT ON public.v_crm_reports_engagement TO authenticated;
REVOKE ALL ON public.v_crm_reports_engagement FROM PUBLIC, anon;

-- ---------- A2.3 v_crm_reports_closure ----------
DROP VIEW IF EXISTS public.v_crm_reports_closure;
CREATE VIEW public.v_crm_reports_closure WITH (security_invoker=true) AS
WITH closed AS (
  SELECT date_trunc('week', a.created_at)::date AS bucket_start,
         (date_trunc('week', a.created_at) + interval '7 days')::date AS bucket_end,
         a.tenant_id, COALESCE(a.disposition_reason,'unspecified') AS disposition_reason,
         COUNT(*) AS closed_count
  FROM public.crm_client_state_audit a
  WHERE a.dimension='lifecycle_stage'::public.client_state_dimension_enum AND a.to_value='closed'
  GROUP BY 1,2,3,4
),
reopened AS (
  SELECT date_trunc('week', a.created_at)::date AS bucket_start,
         a.tenant_id, COUNT(*) AS reopened_count
  FROM public.crm_client_state_audit a
  WHERE a.dimension='lifecycle_stage'::public.client_state_dimension_enum AND a.from_value='closed'
  GROUP BY 1,2
)
SELECT c.tenant_id, c.bucket_start, c.bucket_end, c.disposition_reason,
       c.closed_count::int,
       COALESCE(r.reopened_count,0)::int AS reopened_count,
       (c.closed_count - COALESCE(r.reopened_count,0))::int AS net_closed
FROM closed c
LEFT JOIN reopened r ON r.tenant_id=c.tenant_id AND r.bucket_start=c.bucket_start
WHERE c.tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id=auth.uid());

GRANT SELECT ON public.v_crm_reports_closure TO authenticated;
REVOKE ALL ON public.v_crm_reports_closure FROM PUBLIC, anon;

-- ---------- A2.4 v_crm_reports_campaigns ----------
DROP VIEW IF EXISTS public.v_crm_reports_campaigns;
CREATE VIEW public.v_crm_reports_campaigns WITH (security_invoker=true) AS
WITH enr AS (
  SELECT date_trunc('week', enrolled_at)::date AS bucket_start,
         (date_trunc('week', enrolled_at)+interval '7 days')::date AS bucket_end,
         tenant_id, campaign_id,
         COUNT(*) FILTER (WHERE status IN ('active','completed','cancelled','paused')) AS enrolled_count,
         COUNT(*) FILTER (WHERE status='completed') AS completed_count,
         COUNT(*) FILTER (WHERE status='cancelled') AS cancelled_count
  FROM public.crm_campaign_enrollments
  GROUP BY 1,2,3,4
),
steps AS (
  SELECT date_trunc('week', sl.created_at)::date AS bucket_start,
         sl.tenant_id, cs.campaign_id,
         COUNT(*) FILTER (WHERE sl.status='responded') AS responded_count,
         COUNT(*) FILTER (WHERE sl.status='suppressed') AS suppressed_count,
         COUNT(*) FILTER (WHERE sl.status='failed') AS failed_count
  FROM public.crm_campaign_step_logs sl
  JOIN public.crm_campaign_steps cs ON cs.id=sl.step_id
  GROUP BY 1,2,3
)
SELECT enr.tenant_id, enr.bucket_start, enr.bucket_end, enr.campaign_id,
       enr.enrolled_count::int, enr.completed_count::int, enr.cancelled_count::int,
       COALESCE(steps.responded_count,0)::int  AS responded_count,
       COALESCE(steps.suppressed_count,0)::int AS suppressed_count,
       COALESCE(steps.failed_count,0)::int     AS failed_count
FROM enr
LEFT JOIN steps ON steps.tenant_id=enr.tenant_id AND steps.campaign_id=enr.campaign_id
                AND steps.bucket_start=enr.bucket_start
WHERE enr.tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id=auth.uid());

GRANT SELECT ON public.v_crm_reports_campaigns TO authenticated;
REVOKE ALL ON public.v_crm_reports_campaigns FROM PUBLIC, anon;

-- ---------- A2.5 v_crm_reports_tasks ----------
DROP VIEW IF EXISTS public.v_crm_reports_tasks;
CREATE VIEW public.v_crm_reports_tasks WITH (security_invoker=true) AS
WITH weekly AS (
  SELECT date_trunc('week', created_at)::date AS bucket_start,
         (date_trunc('week', created_at)+interval '7 days')::date AS bucket_end,
         tenant_id, owner_id AS assignee_id,
         COUNT(*) FILTER (WHERE completed_at IS NULL) AS open_count,
         COUNT(*) FILTER (WHERE completed_at IS NOT NULL) AS completed_count,
         COUNT(*) FILTER (WHERE completed_at IS NULL AND due_at IS NOT NULL AND due_at < now()) AS overdue_count,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(epoch FROM (completed_at - created_at))/3600.0
         ) FILTER (WHERE completed_at IS NOT NULL) AS median_hours_to_complete
  FROM public.crm_tasks
  GROUP BY 1,2,3,4
)
SELECT tenant_id, bucket_start, bucket_end, assignee_id,
       open_count::int, completed_count::int, overdue_count::int,
       COALESCE(median_hours_to_complete,0)::numeric AS median_hours_to_complete
FROM weekly
WHERE tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id=auth.uid());

GRANT SELECT ON public.v_crm_reports_tasks TO authenticated;
REVOKE ALL ON public.v_crm_reports_tasks FROM PUBLIC, anon;

-- ---------- A2.6 v_crm_reports_exceptions ----------
DROP VIEW IF EXISTS public.v_crm_reports_exceptions;
CREATE VIEW public.v_crm_reports_exceptions WITH (security_invoker=true) AS
WITH weekly AS (
  SELECT date_trunc('week', created_at)::date AS bucket_start,
         (date_trunc('week', created_at)+interval '7 days')::date AS bucket_end,
         tenant_id, type::text AS exception_type,
         COUNT(*) AS raised_count,
         COUNT(*) FILTER (WHERE status::text='resolved') AS resolved_count,
         COUNT(*) FILTER (WHERE status::text NOT IN ('resolved','cancelled','closed')) AS open_count,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(epoch FROM (updated_at - created_at))/3600.0
         ) FILTER (WHERE status::text='resolved') AS median_hours_to_resolve
  FROM public.crm_exceptions
  GROUP BY 1,2,3,4
)
SELECT tenant_id, bucket_start, bucket_end, exception_type,
       raised_count::int, resolved_count::int, open_count::int,
       COALESCE(median_hours_to_resolve,0)::numeric AS median_hours_to_resolve
FROM weekly
WHERE tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id=auth.uid());

GRANT SELECT ON public.v_crm_reports_exceptions TO authenticated;
REVOKE ALL ON public.v_crm_reports_exceptions FROM PUBLIC, anon;

-- Supporting index for report window scans
CREATE INDEX IF NOT EXISTS crm_client_state_audit_tenant_created_idx
  ON public.crm_client_state_audit (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_activity_events_tenant_created_idx
  ON public.crm_activity_events (tenant_id, created_at DESC);
