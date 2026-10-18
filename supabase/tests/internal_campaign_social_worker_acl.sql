-- Catalog-level ACL contract; use a disposable migrated database.
do $test$
declare f regprocedure;
begin
  foreach f in array array[
    'public.social_queue_publish(uuid)'::regprocedure,
    'public.crm_enqueue_campaign_trigger_jobs(uuid)'::regprocedure,
    'public.crm_correlate_client_email_reply(uuid)'::regprocedure,
    'public.crm_evaluate_campaign_concurrency(uuid,uuid,text,uuid)'::regprocedure
  ] loop
    if has_function_privilege('anon',f,'EXECUTE')
       or has_function_privilege('authenticated',f,'EXECUTE') then
      raise exception 'Direct browser execution still allowed: %',f;
    end if;
    if not has_function_privilege('service_role',f,'EXECUTE') then
      raise exception 'Service-role worker execution missing: %',f;
    end if;
  end loop;
end $test$;
