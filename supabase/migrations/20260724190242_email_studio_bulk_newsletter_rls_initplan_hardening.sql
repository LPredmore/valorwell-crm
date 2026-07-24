-- Email Studio Pass 9: avoid repeated auth.uid() evaluation in bulk-send RLS policies.

drop policy if exists crm_bulk_send_logs_select on public.crm_bulk_send_logs;
drop policy if exists crm_bulk_send_logs_mutate on public.crm_bulk_send_logs;
drop policy if exists crm_bulk_send_recipients_select on public.crm_bulk_send_recipients;
drop policy if exists crm_bulk_send_recipients_mutate on public.crm_bulk_send_recipients;
drop policy if exists crm_bulk_send_staff_recipients_select on public.crm_bulk_send_staff_recipients;
drop policy if exists crm_bulk_send_staff_recipients_mutate on public.crm_bulk_send_staff_recipients;

create policy crm_bulk_send_logs_select on public.crm_bulk_send_logs for select to authenticated
using (exists (
  select 1 from public.crm_user_capabilities capability
  where capability.profile_id = (select auth.uid())
    and capability.tenant_id = crm_bulk_send_logs.tenant_id
    and capability.crm_role <> 'crm_none'
));
create policy crm_bulk_send_logs_mutate on public.crm_bulk_send_logs for all to authenticated
using (exists (
  select 1 from public.crm_user_capabilities capability
  where capability.profile_id = (select auth.uid())
    and capability.tenant_id = crm_bulk_send_logs.tenant_id
    and capability.crm_role in ('crm_admin','crm_operator')
))
with check (exists (
  select 1 from public.crm_user_capabilities capability
  where capability.profile_id = (select auth.uid())
    and capability.tenant_id = crm_bulk_send_logs.tenant_id
    and capability.crm_role in ('crm_admin','crm_operator')
));

create policy crm_bulk_send_recipients_select on public.crm_bulk_send_recipients for select to authenticated
using (exists (
  select 1 from public.crm_user_capabilities capability
  where capability.profile_id = (select auth.uid())
    and capability.tenant_id = crm_bulk_send_recipients.tenant_id
    and capability.crm_role <> 'crm_none'
));
create policy crm_bulk_send_recipients_mutate on public.crm_bulk_send_recipients for all to authenticated
using (exists (
  select 1 from public.crm_user_capabilities capability
  where capability.profile_id = (select auth.uid())
    and capability.tenant_id = crm_bulk_send_recipients.tenant_id
    and capability.crm_role in ('crm_admin','crm_operator')
))
with check (exists (
  select 1 from public.crm_user_capabilities capability
  where capability.profile_id = (select auth.uid())
    and capability.tenant_id = crm_bulk_send_recipients.tenant_id
    and capability.crm_role in ('crm_admin','crm_operator')
));

create policy crm_bulk_send_staff_recipients_select on public.crm_bulk_send_staff_recipients for select to authenticated
using (exists (
  select 1 from public.crm_user_capabilities capability
  where capability.profile_id = (select auth.uid())
    and capability.tenant_id = crm_bulk_send_staff_recipients.tenant_id
    and capability.crm_role <> 'crm_none'
));
create policy crm_bulk_send_staff_recipients_mutate on public.crm_bulk_send_staff_recipients for all to authenticated
using (exists (
  select 1 from public.crm_user_capabilities capability
  where capability.profile_id = (select auth.uid())
    and capability.tenant_id = crm_bulk_send_staff_recipients.tenant_id
    and capability.crm_role in ('crm_admin','crm_operator')
))
with check (exists (
  select 1 from public.crm_user_capabilities capability
  where capability.profile_id = (select auth.uid())
    and capability.tenant_id = crm_bulk_send_staff_recipients.tenant_id
    and capability.crm_role in ('crm_admin','crm_operator')
));
