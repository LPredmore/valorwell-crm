-- Email Studio Pass 9: replace legacy bulk-send access with current CRM capabilities.

do $$
declare policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('crm_bulk_send_logs','crm_bulk_send_recipients','crm_bulk_send_staff_recipients')
  loop
    execute format('drop policy if exists %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end;
$$;

revoke all on public.crm_bulk_send_logs from anon, authenticated;
revoke all on public.crm_bulk_send_recipients from anon, authenticated;
revoke all on public.crm_bulk_send_staff_recipients from anon, authenticated;
grant select, insert, update, delete on public.crm_bulk_send_logs to authenticated;
grant select, insert, update, delete on public.crm_bulk_send_recipients to authenticated;
grant select, insert, update, delete on public.crm_bulk_send_staff_recipients to authenticated;
grant all on public.crm_bulk_send_logs to service_role;
grant all on public.crm_bulk_send_recipients to service_role;
grant all on public.crm_bulk_send_staff_recipients to service_role;

create policy crm_bulk_send_logs_select on public.crm_bulk_send_logs for select to authenticated
using (exists (select 1 from public.crm_user_capabilities capability where capability.profile_id = auth.uid() and capability.tenant_id = crm_bulk_send_logs.tenant_id and capability.crm_role <> 'crm_none'));
create policy crm_bulk_send_logs_mutate on public.crm_bulk_send_logs for all to authenticated
using (exists (select 1 from public.crm_user_capabilities capability where capability.profile_id = auth.uid() and capability.tenant_id = crm_bulk_send_logs.tenant_id and capability.crm_role in ('crm_admin','crm_operator')))
with check (exists (select 1 from public.crm_user_capabilities capability where capability.profile_id = auth.uid() and capability.tenant_id = crm_bulk_send_logs.tenant_id and capability.crm_role in ('crm_admin','crm_operator')));

create policy crm_bulk_send_recipients_select on public.crm_bulk_send_recipients for select to authenticated
using (exists (select 1 from public.crm_user_capabilities capability where capability.profile_id = auth.uid() and capability.tenant_id = crm_bulk_send_recipients.tenant_id and capability.crm_role <> 'crm_none'));
create policy crm_bulk_send_recipients_mutate on public.crm_bulk_send_recipients for all to authenticated
using (exists (select 1 from public.crm_user_capabilities capability where capability.profile_id = auth.uid() and capability.tenant_id = crm_bulk_send_recipients.tenant_id and capability.crm_role in ('crm_admin','crm_operator')))
with check (exists (select 1 from public.crm_user_capabilities capability where capability.profile_id = auth.uid() and capability.tenant_id = crm_bulk_send_recipients.tenant_id and capability.crm_role in ('crm_admin','crm_operator')));

create policy crm_bulk_send_staff_recipients_select on public.crm_bulk_send_staff_recipients for select to authenticated
using (exists (select 1 from public.crm_user_capabilities capability where capability.profile_id = auth.uid() and capability.tenant_id = crm_bulk_send_staff_recipients.tenant_id and capability.crm_role <> 'crm_none'));
create policy crm_bulk_send_staff_recipients_mutate on public.crm_bulk_send_staff_recipients for all to authenticated
using (exists (select 1 from public.crm_user_capabilities capability where capability.profile_id = auth.uid() and capability.tenant_id = crm_bulk_send_staff_recipients.tenant_id and capability.crm_role in ('crm_admin','crm_operator')))
with check (exists (select 1 from public.crm_user_capabilities capability where capability.profile_id = auth.uid() and capability.tenant_id = crm_bulk_send_staff_recipients.tenant_id and capability.crm_role in ('crm_admin','crm_operator')));
