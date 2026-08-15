update public.ai_operations_settings
   set max_model_concurrency = 2, updated_at = now()
 where max_model_concurrency > 2;

alter table public.ai_operations_settings alter column max_model_concurrency set default 2;