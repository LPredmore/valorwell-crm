do $$
declare v_def text := pg_get_functiondef('public.crm_list_newsletters'::regproc);
begin
  if position('''failureMessage''' in v_def) = 0 then
    execute replace(v_def, '''updatedAt'',n.updated_at',
      '''updatedAt'',n.updated_at,''failedAt'',n.failed_at,''failureCode'',n.failure_code,''failureMessage'',n.failure_message');
  end if;
end $$;