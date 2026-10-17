-- Run only through the isolated 5C runner with synthetic prerequisites.
begin;
do $$ begin
  if current_setting('app.zeffy_isolated_fixture',true) is distinct from 'yes' then
    raise exception 'Explicit isolated fixture setup required';
  end if;
  if has_table_privilege('anon','public.crm_donor_transactions_v','SELECT')
    or has_table_privilege('authenticated','public.crm_donor_transactions_v','SELECT') then
    raise exception 'Legacy donor view is browser-readable';
  end if;
  if not has_table_privilege('service_role','public.crm_donor_transactions_v','SELECT') then
    raise exception 'Existing service read removed';
  end if;
end $$;
set local role authenticated;
do $$ begin
  begin
    perform * from public.crm_donor_transactions_v;
    raise exception 'Authenticated legacy view access allowed' using errcode='P0002';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform * from public.crm_donor_transactions_v;
    raise exception 'Anonymous legacy view access allowed' using errcode='P0002';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role service_role;
select count(*) as synthetic_service_view_rows from public.crm_donor_transactions_v;
reset role;
rollback;
