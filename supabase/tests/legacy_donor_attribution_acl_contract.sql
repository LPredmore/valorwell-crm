-- Read-only catalog contract for the fail-closed retired Givebutter path.
-- Execute only on an independently verified disposable schema.
do $test$
declare f text;
begin
  select pg_get_functiondef('public.crm_donor_overview()'::regprocedure) into f;
  if position('totalDonationsStatus' in f)=0 or
     position('legacy_source_tenant_ownership_unverified' in f)=0 or
     position('from public.givebutter_donations' in lower(f))>0 then
    raise exception 'Donor overview exposes global historical donations or lacks unavailable indicator';
  end if;
  select pg_get_functiondef('public.crm_enqueue_donor_transactions(text,boolean,integer)'::regprocedure) into f;
  if position('LEGACY_DONOR_SOURCE_OWNERSHIP_REQUIRED' in f)=0 or
     position('insert into public.crm_donor_ingest_queue' in lower(f))>0 then
    raise exception 'Legacy enqueue is not fail-closed';
  end if;
end $test$;
