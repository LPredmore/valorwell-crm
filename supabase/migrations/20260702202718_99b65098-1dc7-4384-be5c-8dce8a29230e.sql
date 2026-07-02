
create or replace function public.claim_pending_campaign_steps(p_limit int default 50)
returns table (
  id uuid,
  enrollment_id uuid,
  step_id uuid,
  tenant_id uuid,
  client_id uuid,
  scheduled_for timestamptz,
  channel text
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
  with claimed as (
    select l.id
    from public.crm_campaign_step_logs l
    where l.status = 'scheduled'
      and l.scheduled_for <= now()
    order by l.scheduled_for asc
    limit p_limit
    for update skip locked
  )
  update public.crm_campaign_step_logs l
     set status = 'processing',
         updated_at = now()
    from claimed
   where l.id = claimed.id
  returning l.id, l.enrollment_id, l.step_id, l.tenant_id, l.client_id, l.scheduled_for, l.channel;
end
$fn$;

revoke all on function public.claim_pending_campaign_steps(int) from public, anon, authenticated;
grant execute on function public.claim_pending_campaign_steps(int) to service_role;

do $mig$
declare
  con_def text;
begin
  select pg_get_constraintdef(oid) into con_def
    from pg_constraint
   where conrelid = 'public.crm_campaign_step_logs'::regclass
     and conname = 'crm_campaign_step_logs_status_check';
  if con_def is not null and con_def not ilike '%processing%' then
    alter table public.crm_campaign_step_logs drop constraint crm_campaign_step_logs_status_check;
    alter table public.crm_campaign_step_logs
      add constraint crm_campaign_step_logs_status_check
      check (status in ('scheduled','processing','sent','failed','cancelled','skipped'));
  end if;
end
$mig$;

alter table public.crm_bulk_send_logs add column if not exists heartbeat_at timestamptz;
alter table public.crm_bulk_sms_logs  add column if not exists heartbeat_at timestamptz;

create index if not exists crm_bulk_send_logs_sending_heartbeat_idx
  on public.crm_bulk_send_logs (heartbeat_at)
  where status = 'sending';
create index if not exists crm_bulk_sms_logs_sending_heartbeat_idx
  on public.crm_bulk_sms_logs (heartbeat_at)
  where status = 'sending';

create or replace function public.reconcile_stalled_bulk_jobs()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.crm_bulk_send_logs
     set status = 'failed',
         completed_at = coalesce(completed_at, now())
   where status = 'sending'
     and coalesce(heartbeat_at, created_at) < now() - interval '10 minutes';

  update public.crm_bulk_sms_logs
     set status = 'failed',
         completed_at = coalesce(completed_at, now())
   where status = 'sending'
     and coalesce(heartbeat_at, created_at) < now() - interval '10 minutes';
end
$fn$;

revoke all on function public.reconcile_stalled_bulk_jobs() from public, anon, authenticated;
grant execute on function public.reconcile_stalled_bulk_jobs() to service_role;

create index if not exists clients_phone_last10_idx
  on public.clients ((regexp_replace(phone, '\D', '', 'g')))
  where phone is not null;

do $c$
begin
  if exists (select 1 from cron.job where jobname = 'reconcile-stalled-bulk-jobs') then
    perform cron.unschedule('reconcile-stalled-bulk-jobs');
  end if;
  perform cron.schedule(
    'reconcile-stalled-bulk-jobs',
    '*/5 * * * *',
    'select public.reconcile_stalled_bulk_jobs();'
  );
end
$c$;
