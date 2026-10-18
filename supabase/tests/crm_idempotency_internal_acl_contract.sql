-- Run only in a disposable migrated test database; do not apply directly
-- to production as an acceptance fixture. Non-destructive catalog assertions.
begin;
do $$
declare
  f regprocedure;
  caller_name text;
  owners_ok boolean;
begin
  foreach f in array array[
      'public._crm_idempotency_claim(text,text,uuid,uuid)'::regprocedure,
      'public._crm_idempotency_record(text,text,jsonb)'::regprocedure
    ] loop
    if has_function_privilege('anon',f,'EXECUTE') or
       has_function_privilege('authenticated',f,'EXECUTE') then
      raise exception 'Internal CRM idempotency helper still browser-executable: %', f;
    end if;
    if not has_function_privilege('service_role',f,'EXECUTE') then
      raise exception 'Lost explicit service execution permission: %', f;
    end if;
    if not exists(select 1 from pg_proc where oid=f
                  and prosecdef and proowner='postgres'::regrole) then
      raise exception 'Helper is not owned by expected privileged role: %', f;
    end if;
  end loop;
  foreach caller_name in array array[
      'crm_cancel_enrollment','crm_enroll_clients_in_campaign',
      'crm_mark_enrollment_responded','crm_pause_enrollment',
      'crm_restart_enrollment','crm_resume_enrollment'
    ] loop
    select exists(
      select 1 from pg_proc
      where pronamespace='public'::regnamespace
        and proname=caller_name and prosecdef
        and proowner='postgres'::regrole
    ) into owners_ok;
    if not owners_ok then
      raise exception 'Privileged caller contract changed: %', caller_name;
    end if;
  end loop;
end $$;
rollback;
