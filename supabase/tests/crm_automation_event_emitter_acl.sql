-- Catalog-level security and trusted-caller contract for a disposable,
-- representative migrated database. Not a production write test.
do $test$
declare
  f regprocedure := 'public.crm_emit_automation_event(uuid,text,text,uuid,text,jsonb,text,uuid,timestamptz)'::regprocedure;
  caller_name text;
begin
  if has_function_privilege('anon',f,'EXECUTE')
     or has_function_privilege('authenticated',f,'EXECUTE') then
    raise exception 'Untrusted browser role can emit arbitrary CRM automation events';
  end if;
  if not has_function_privilege('service_role',f,'EXECUTE') then
    raise exception 'Trusted worker lost CRM automation emitter EXECUTE';
  end if;
  if not exists (
    select 1 from pg_proc p
    where p.oid=f and p.prosecdef and pg_get_userbyid(p.proowner)='postgres'
  ) then
    raise exception 'CRM automation emitter owner/security-definer contract changed';
  end if;

  -- These DB/trigger entry points call the emitter from postgres-owned
  -- SECURITY DEFINER functions, so their nested calls remain authorized.
  foreach caller_name in array array[
    'crm_emit_campaign_outcome_event',
    'crm_emit_client_state_automation_event',
    'crm_cancel_newsletter_send',
    'crm_claim_due_newsletters',
    'crm_clone_newsletter_to_draft',
    'crm_fail_newsletter',
    'crm_finalize_newsletter',
    'crm_schedule_newsletter',
    'crm_set_bty_outreach_state',
    'crm_upsert_newsletter',
    'crm_upsert_newsletter_canonical'
  ] loop
    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public'
        and p.proname=caller_name
        and p.prosecdef
        and pg_get_userbyid(p.proowner)='postgres'
        and p.prosrc like '%crm_emit_automation_event%'
    ) then
      raise exception 'Review required: trusted CRM emitter caller changed: %',caller_name;
    end if;
  end loop;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='crm_process_donor_transaction'
      and p.prosecdef and pg_get_userbyid(p.proowner)='postgres'
      and p.prosrc like '%crm_emit_automation_event%'
  ) then
    raise exception 'Review required: private trusted donor event caller changed';
  end if;
end $test$;

-- Full release acceptance must also prove genuine signed-JWT RPC denial
-- and positive synthetic server/trigger emission with no real sends.
