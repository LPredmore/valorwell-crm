-- Make Gemini 3.6 Flash the authoritative model for every active Gemini-backed
-- automation and AI Operations queue path. Completed historical work retains the
-- model that actually ran for provenance.

DO $migration$
DECLARE
  r record;
  v_definition text;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prokind = 'f'
      AND n.nspname IN ('public', 'private')
      AND (
        pg_get_functiondef(p.oid) LIKE '%gemini-2.5-flash%'
        OR pg_get_functiondef(p.oid) LIKE '%gemini-2.5-pro%'
        OR pg_get_functiondef(p.oid) LIKE '%gemini-flash-latest%'
        OR pg_get_functiondef(p.oid) LIKE '%gemini-3.1-pro-preview%'
      )
  LOOP
    v_definition := pg_get_functiondef(r.oid);
    v_definition := replace(v_definition, 'gemini-2.5-flash', 'gemini-3.6-flash');
    v_definition := replace(v_definition, 'gemini-2.5-pro', 'gemini-3.6-flash');
    v_definition := replace(v_definition, 'gemini-flash-latest', 'gemini-3.6-flash');
    v_definition := replace(v_definition, 'gemini-3.1-pro-preview', 'gemini-3.6-flash');
    EXECUTE v_definition;
  END LOOP;
END
$migration$;

UPDATE public.ai_operations_settings
SET model = 'gemini-3.6-flash',
    updated_at = now()
WHERE model IS DISTINCT FROM 'gemini-3.6-flash';

UPDATE private.ai_ops_work_items
SET requested_model = 'gemini-3.6-flash',
    updated_at = now()
WHERE status::text IN ('queued', 'processing', 'retry_wait', 'failed')
  AND requested_model IS DISTINCT FROM 'gemini-3.6-flash';
