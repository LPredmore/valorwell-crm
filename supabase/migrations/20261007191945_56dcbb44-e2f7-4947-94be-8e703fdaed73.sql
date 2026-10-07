-- Security linter cleanup (additive restrictions only). Rollback: re-GRANT EXECUTE to the listed roles.
alter view public.website_resources_public set (security_invoker = on);
alter view public.champva_payment_totals set (security_invoker = on);
revoke select on public.champva_payment_totals from anon;
revoke select on public.crm_donor_transactions_v from anon;

alter function public.validate_scheduling_interval() set search_path = public;
alter function public.validate_payroll_settings() set search_path = public;
alter function public.convert_local_to_utc(text, text, text) set search_path = public;
alter function public.validate_payroll_line_item_approval() set search_path = public;
alter function public.set_note_signed_at() set search_path = public;
alter function public.get_now_in_timezone(text) set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.billing_touch_updated_at() set search_path = public;
alter function public.format_timestamp_in_timezone(timestamptz, text, text) set search_path = public;
alter function public.set_documented_at() set search_path = public;

do $$
declare r record;
  keep_anon text[] := array['crm_process_newsletter_unsubscribe','process_relationship_unsubscribe','get_public_client_statement',
    'is_public_website_resource','get_homepage_documented_monthly_impact','process_stripe_checkout_payment','has_billing_role',
    'get_crm_operating_context','get_billing_identity_context','submit_overflow_referral_source'];
begin
  for r in
    select p.oid::regprocedure sig, p.proname, p.prorettype = 'trigger'::regtype trig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    if r.trig then
      execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    elsif has_function_privilege('anon', r.sig::oid, 'execute')
          and not (r.proname = any(keep_anon) or r.proname like 'submit\_website\_%') then
      execute format('revoke execute on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
    end if;
    if r.proname ~ '^ai_ops_(begin|complete|build|ingest|enqueue|fail|release|purge|upsert|worker_flag|expire|sync|refresh|finalize|autoresolve|claim)'
       or r.proname in ('gemini_automation_claim_slot','crm_process_donor_queue','crm_claim_campaign_trigger_jobs','crm_execute_campaign_trigger_job') then
      execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $$;