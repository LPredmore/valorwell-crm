-- Phase 23: full-dataset manual CRM pipeline search with RLS intact.
-- The RPC is strictly READ ONLY, SECURITY INVOKER, and authenticated-only.
-- It does not query clinical tables, create shadow records, or mutate stages.
CREATE OR REPLACE FUNCTION public.crm_find_manual_pipeline_records(
  p_tenant_id uuid,
  p_pipeline_id uuid,
  p_after_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_stage_id uuid DEFAULT NULL,
  p_owner_filter text DEFAULT 'all',
  p_attention text DEFAULT 'all',
  p_page_size integer DEFAULT 200
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
    AND (p_after_id IS NULL OR r.id > p_after_id)
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
  ORDER BY r.id ASC
  LIMIT greatest(1,least(coalesce(p_page_size,200),201));
$function$;

REVOKE ALL ON FUNCTION public.crm_find_manual_pipeline_records(
  uuid,uuid,uuid,text,uuid,text,text,integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_find_manual_pipeline_records(
  uuid,uuid,uuid,text,uuid,text,text,integer
) TO authenticated;
COMMENT ON FUNCTION public.crm_find_manual_pipeline_records(
  uuid,uuid,uuid,text,uuid,text,text,integer
) IS 'Tenant and RLS-scoped read-only manual CRM pipeline keyset search (up to 201 rows per call). No clinical sources.';
