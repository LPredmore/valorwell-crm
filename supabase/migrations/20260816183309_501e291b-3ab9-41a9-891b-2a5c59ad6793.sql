-- Gemini 2.5 Pro is the authoritative model for every AI Operations analysis module.
ALTER TABLE public.ai_operations_settings ALTER COLUMN model SET DEFAULT 'gemini-2.5-pro';

UPDATE public.ai_operations_settings
   SET model = 'gemini-2.5-pro', updated_at = now()
 WHERE model IS DISTINCT FROM 'gemini-2.5-pro';

UPDATE private.ai_ops_work_items
   SET requested_model = 'gemini-2.5-pro'
 WHERE status IN ('queued', 'retry_wait')
   AND (requested_model IS NULL OR requested_model ILIKE '%flash%');