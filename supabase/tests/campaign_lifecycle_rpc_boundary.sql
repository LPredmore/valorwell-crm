-- Include only after independently verifying the disposable connection.
begin;
do $$
declare p regprocedure;
begin
  if current_setting('app.zeffy_isolated_fixture',true) is distinct from 'yes'
    or current_setting('cluster_name') not like 'zeffy_5b_%'
    or inet_server_addr() is distinct from '127.0.0.1'::inet then
    raise exception 'Disposable campaign acceptance database required';
  end if;
  foreach p in array array[
    'public._crm_enrollment_tenant_check(uuid)'::regprocedure,
    'public._crm_idempotency_claim(text,text,uuid,uuid)'::regprocedure,
    'public._crm_idempotency_record(text,text,jsonb)'::regprocedure
  ] loop
    if has_function_privilege('anon',p,'EXECUTE') or has_function_privilege('authenticated',p,'EXECUTE') then
      raise exception 'Internal campaign helper exposed: %',p;
    end if;
  end loop;
  foreach p in array array[
    'public.crm_pause_enrollment(uuid,text,text)'::regprocedure,
    'public.crm_resume_enrollment(uuid,text,text)'::regprocedure,
    'public.crm_cancel_enrollment(uuid,text,text)'::regprocedure,
    'public.crm_mark_enrollment_responded(uuid,text,text)'::regprocedure,
    'public.crm_restart_enrollment(uuid,text,text)'::regprocedure,
    'public.crm_enroll_clients_in_campaign(uuid,uuid[],text,uuid,text)'::regprocedure
  ] loop
    if has_function_privilege('anon',p,'EXECUTE')
       or not has_function_privilege('authenticated',p,'EXECUTE')
       or not has_function_privilege('service_role',p,'EXECUTE') then
      raise exception 'Public campaign RPC boundary changed: %',p;
    end if;
  end loop;
  if (select provolatile from pg_proc where oid='public._crm_enrollment_tenant_check(uuid)'::regprocedure)<>'v' then
    raise exception 'Enrollment lock helper must be volatile';
  end if;
end $$;
rollback;
