ALTER TABLE public.ai_operations_settings ALTER COLUMN model SET DEFAULT 'gemini-pro-latest';

UPDATE public.ai_operations_settings
SET model = 'gemini-pro-latest', updated_at = now()
WHERE model IS DISTINCT FROM 'gemini-pro-latest';

UPDATE private.ai_ops_work_items
SET requested_model = 'gemini-pro-latest', updated_at = now()
WHERE status IN ('queued', 'retry_wait')
  AND requested_model IS DISTINCT FROM 'gemini-pro-latest';