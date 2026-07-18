begin;

do $verification$
begin
  if pg_catalog.has_function_privilege(
       'anon',
       'public.submit_website_bty_submission(jsonb)',
       'EXECUTE'
     ) then
    raise exception 'verification failed: anon can execute the retired broad BTY RPC';
  end if;

  if pg_catalog.has_function_privilege(
       'authenticated',
       'public.submit_website_bty_submission(jsonb)',
       'EXECUTE'
     ) then
    raise exception 'verification failed: authenticated can execute the retired broad BTY RPC';
  end if;

  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.submit_website_bty_submission(jsonb)',
       'EXECUTE'
     ) then
    raise exception 'verification failed: service rollback access was not preserved';
  end if;
end
$verification$;

rollback;
