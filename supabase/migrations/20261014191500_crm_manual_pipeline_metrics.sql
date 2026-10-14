-- Phase 24: authoritative stage and next-action counts for a manual CRM pipeline.
-- This invoker function reads only existing tenant-RLS-protected pipeline tables.
-- It never aggregates connected-source records or exposes clinical data.
CREATE OR REPLACE FUNCTION public.crm_manual_pipeline_metrics(
  p_tenant_id uuid,
  p_pipeline_id uuid
)
RETURNS TABLE (
  stage_id uuid,
  record_count bigint,
  overdue_count bigint,
  missing_action_count bigint,
  unassigned_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT s.id AS stage_id,
         count(r.id) AS record_count,
         count(r.id) FILTER (
           WHERE r.next_action_due_at < now()
         ) AS overdue_count,
         count(r.id) FILTER (
           WHERE nullif(btrim(r.next_action), '') IS NULL
         ) AS missing_action_count,
         count(r.id) FILTER (
           WHERE r.owner_profile_id IS NULL
         ) AS unassigned_count
    FROM public.crm_pipeline_stages s
    JOIN public.crm_pipelines p
      ON p.id = s.pipeline_id
     AND p.tenant_id = s.tenant_id
     AND p.source_mode = 'manual'
     AND p.archived_at IS NULL
    LEFT JOIN public.crm_pipeline_records r
      ON r.tenant_id = s.tenant_id
     AND r.pipeline_id = s.pipeline_id
     AND r.stage_id = s.id
   WHERE s.tenant_id = p_tenant_id
     AND s.pipeline_id = p_pipeline_id
   GROUP BY s.id, s.position
   ORDER BY s.position;
$function$;

REVOKE ALL ON FUNCTION public.crm_manual_pipeline_metrics(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_manual_pipeline_metrics(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.crm_manual_pipeline_metrics(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.crm_manual_pipeline_metrics(uuid, uuid)
IS 'Tenant-RLS-respecting, unfiltered manual pipeline stage and action-health metrics; source-connected pipelines are excluded.';
