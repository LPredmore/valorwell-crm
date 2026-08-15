alter table public.ai_operations_settings alter column model set default 'gemini-flash-latest';
update public.ai_operations_settings set model = 'gemini-flash-latest' where model <> 'gemini-flash-latest';
alter table private.ai_ops_work_items alter column requested_model set default 'gemini-flash-latest';
update private.ai_ops_work_items set requested_model = 'gemini-flash-latest' where status in ('queued','processing','failed') and requested_model <> 'gemini-flash-latest';