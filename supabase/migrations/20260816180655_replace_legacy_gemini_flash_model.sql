update public.ai_operations_settings
set model = 'gemini-2.5-flash',
    updated_at = now()
where model = 'gemini-flash-latest';
