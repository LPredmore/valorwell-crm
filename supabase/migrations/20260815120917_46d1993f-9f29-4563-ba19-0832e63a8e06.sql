alter table public.ai_operations_settings alter column model set default 'gemini-2.5-flash';
update public.ai_operations_settings set model = 'gemini-2.5-flash' where model <> 'gemini-2.5-flash';
alter table private.ai_ops_work_items alter column requested_model set default 'gemini-2.5-flash';
update private.ai_ops_work_items set requested_model = 'gemini-2.5-flash' where status in ('queued','processing','failed') and requested_model <> 'gemini-2.5-flash';