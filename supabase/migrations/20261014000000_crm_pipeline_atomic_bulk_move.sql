-- Phase 23: atomic bulk stage moves for manual CRM records.
-- A single PostgREST RPC executes one database transaction. Any individual
-- version, authorization, RLS or transition-rule failure rolls back ALL moves
-- and all audit events. Source-connected workflows remain protected.
CREATE OR REPLACE FUNCTION public.crm_bulk_move_manual_pipeline_records(
  p_items jsonb,
  p_to_stage_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  item record;
  moved integer := 0;
  item_count integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'CRM_AUTH_REQUIRED' USING errcode='42501';
  END IF;
  IF p_to_stage_id IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'BULK_SELECTION_INVALID' USING errcode='22023';
  END IF;
  item_count := jsonb_array_length(p_items);
  IF item_count < 1 OR item_count > 20 THEN
    RAISE EXCEPTION 'BULK_SELECTION_OUT_OF_RANGE' USING errcode='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS element(value)
    WHERE jsonb_typeof(element.value) IS DISTINCT FROM 'object'
      OR NOT(element.value ? 'id' AND element.value ? 'version')
  ) THEN
    RAISE EXCEPTION 'BULK_SELECTION_MISSING_ID_OR_VERSION' USING errcode='22023';
  END IF;
  -- Parse types up-front so malformed UUIDs/versions reject the entire call.
  IF (
    SELECT count(DISTINCT rec.id)
    FROM jsonb_to_recordset(p_items) AS rec(id uuid,version bigint)
  ) <> item_count THEN
    RAISE EXCEPTION 'BULK_SELECTION_DUPLICATE_OR_NULL_ID' USING errcode='22023';
  END IF;
  -- Stable lock order reduces deadlocks for overlapping simultaneous batches.
  -- Reuse the existing permission/version/source/transition/audit contract.
  FOR item IN
    SELECT rec.id, rec.version
    FROM jsonb_to_recordset(p_items) AS rec(id uuid,version bigint)
    ORDER BY rec.id
  LOOP
    IF item.version IS NULL THEN
      RAISE EXCEPTION 'BULK_SELECTION_MISSING_VERSION' USING errcode='22023';
    END IF;
    PERFORM public.crm_move_manual_pipeline_record(
      item.id,item.version,p_to_stage_id
    );
    moved := moved + 1;
  END LOOP;
  RETURN moved;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_bulk_move_manual_pipeline_records(jsonb,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_bulk_move_manual_pipeline_records(jsonb,uuid)
  TO authenticated;
COMMENT ON FUNCTION public.crm_bulk_move_manual_pipeline_records(jsonb,uuid)
  IS 'All-or-nothing manual CRM stage moves, 1..20 versioned IDs, via existing RLS/permissioned transition RPC and audit triggers.';
