-- Phase 23: global chronological sorting and deterministic keyset pagination.
-- Compatibility: previous crm_find_manual_pipeline_records remains intact.
-- Every allowed builtin sort uses (coalesced timestamp, id) as stable cursor.
-- Infinity sorts missing dates after non-null values, matching board behavior.
-- Cursor's sort value is derived from the visible row under RLS, never caller input.
-- The RPC is strictly READ ONLY, SECURITY INVOKER, and authenticated-only.
-- It does not query clinical tables, create shadow records, or mutate stages.
CREATE OR REPLACE FUNCTION public.crm_find_manual_pipeline_records_sorted(
  p_tenant_id uuid,
  p_pipeline_id uuid,
  p_after_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_stage_id uuid DEFAULT NULL,
  p_owner_filter text DEFAULT 'all',
  p_attention text DEFAULT 'all',
  p_page_size integer DEFAULT 200,
  p_sort_key text DEFAULT 'updated_at'
)
RETURNS SETOF public.crm_pipeline_records
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT r.*
  FROM public.crm_pipeline_records AS r
  JOIN public.crm_pipelines AS pipeline
    ON pipeline.id = r.pipeline_id AND pipeline.tenant_id = r.tenant_id
  LEFT JOIN public.relationship_contacts AS person
    ON person.id = r.contact_id AND person.tenant_id = r.tenant_id
  LEFT JOIN public.relationship_organizations AS organization
    ON organization.id = r.organization_id AND organization.tenant_id = r.tenant_id
  CROSS JOIN LATERAL (
    SELECT lower(btrim(left(coalesce(p_search,''),200))) AS term
  ) AS search
  WHERE auth.uid() IS NOT NULL
    AND pipeline.source_mode = 'manual'
    AND pipeline.archived_at IS NULL
    AND r.tenant_id = p_tenant_id AND r.pipeline_id = p_pipeline_id
    AND p_sort_key IN ('updated_at','created_at','next_action_due_at')
    AND (p_after_id IS NULL OR EXISTS (
      SELECT 1 FROM public.crm_pipeline_records AS c
      WHERE c.tenant_id = p_tenant_id AND c.pipeline_id = p_pipeline_id
        AND c.id = p_after_id
    ))
    AND (p_after_id IS NULL OR (
      (COALESCE(CASE p_sort_key
        WHEN 'created_at' THEN r.created_at
        WHEN 'next_action_due_at' THEN r.next_action_due_at
        ELSE r.updated_at END, 'infinity'::timestamptz), r.id) >
      (
        (SELECT COALESCE(CASE p_sort_key
        WHEN 'created_at' THEN c.created_at
        WHEN 'next_action_due_at' THEN c.next_action_due_at
        ELSE c.updated_at END, 'infinity'::timestamptz)
         FROM public.crm_pipeline_records AS c
         WHERE c.tenant_id = p_tenant_id AND c.pipeline_id = p_pipeline_id
           AND c.id = p_after_id),
        p_after_id
      )
    ))
    AND (p_stage_id IS NULL OR r.stage_id = p_stage_id)
    AND CASE p_owner_filter
      WHEN 'mine' THEN r.owner_profile_id = auth.uid()
      WHEN 'unassigned' THEN r.owner_profile_id IS NULL
      WHEN 'all' THEN true
      ELSE false
    END
    AND CASE p_attention
      WHEN 'overdue' THEN r.next_action_due_at < now()
      WHEN 'no_next_action' THEN nullif(btrim(coalesce(r.next_action,'')),'') IS NULL
      WHEN 'all' THEN true
      ELSE false
    END
    AND (
      search.term = ''
      OR position(search.term IN lower(concat_ws(' ',person.first_name,person.last_name))) > 0
      OR position(search.term IN lower(coalesce(organization.name,''))) > 0
      OR position(search.term IN lower(coalesce(r.next_action,''))) > 0
      OR EXISTS (
        SELECT 1 FROM jsonb_each(
          CASE WHEN jsonb_typeof(r.field_values) = 'object'
            THEN r.field_values ELSE '{}'::jsonb END
        ) AS field_value(key,value)
        WHERE position(search.term IN lower(field_value.value::text)) > 0
      )
      OR EXISTS (
        SELECT 1
        FROM public.relationship_contact_organizations AS primary_link
        JOIN public.relationship_contacts AS primary_person
          ON primary_person.id = primary_link.contact_id
         AND primary_person.tenant_id = primary_link.tenant_id
        WHERE primary_link.tenant_id = r.tenant_id
          AND primary_link.organization_id = r.organization_id
          AND primary_link.is_primary = true
          AND position(search.term IN lower(concat_ws(' ',primary_person.first_name,primary_person.last_name))) > 0
      )
    )
  ORDER BY COALESCE(CASE p_sort_key
        WHEN 'created_at' THEN r.created_at
        WHEN 'next_action_due_at' THEN r.next_action_due_at
        ELSE r.updated_at END, 'infinity'::timestamptz) ASC, r.id ASC
  LIMIT greatest(1,least(coalesce(p_page_size,200),201));
$function$;

REVOKE ALL ON FUNCTION public.crm_find_manual_pipeline_records_sorted(
  uuid,uuid,uuid,text,uuid,text,text,integer,text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_find_manual_pipeline_records_sorted(
  uuid,uuid,uuid,text,uuid,text,text,integer,text
) TO authenticated;
COMMENT ON FUNCTION public.crm_find_manual_pipeline_records_sorted(
  uuid,uuid,uuid,text,uuid,text,text,integer,text
) IS 'RLS-invoker full manual pipeline date-sorted search with ID-derived stable timestamp cursor; no source-connected mutations.';
