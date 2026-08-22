-- Newsletter architecture containment: production must remain non-sending until formal activation.

create table if not exists private.crm_newsletter_runtime (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  runtime_state text not null default 'PRELAUNCH'
    check (runtime_state in ('PRELAUNCH', 'PAUSED', 'ACTIVE')),
  reason text not null default 'Newsletter delivery has not been activated.',
  updated_by_profile_id uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into private.crm_newsletter_runtime (tenant_id, runtime_state, reason)
select id, 'PRELAUNCH', 'Newsletter architecture hardening is in progress; delivery is intentionally unavailable.'
from public.tenants
on conflict (tenant_id) do update
set runtime_state = 'PRELAUNCH',
    reason = excluded.reason,
    updated_at = now();

create or replace function private.crm_newsletter_runtime_state(p_tenant_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select r.runtime_state
     from private.crm_newsletter_runtime r
     where r.tenant_id = p_tenant_id),
    'PRELAUNCH'::text
  );
$$;

revoke all on function private.crm_newsletter_runtime_state(uuid) from public, anon, authenticated;
grant execute on function private.crm_newsletter_runtime_state(uuid) to service_role;

update private.crm_control_plane_flags
set enabled = false,
    updated_at = now()
where flag_name in ('universal_newsletters_enabled', 'newsletter_mailbox_suppression_enabled')
  and enabled is distinct from false;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'newsletter-send-worker-every-5-min') then
    perform cron.unschedule('newsletter-send-worker-every-5-min');
  end if;
end
$$;

update private.ai_ops_operation_registry
set enabled = false,
    downstream_invariant = jsonb_build_object(
      'newsletterRuntimeState', 'PRELAUNCH',
      'expectedSchedulerState', 'absent',
      'reason', 'Newsletter delivery is intentionally unavailable until formal activation.'
    ),
    updated_at = now()
where operation_key = 'pg_cron:newsletter-send-worker-every-5-min';

revoke all on function public.crm_claim_due_newsletters(integer) from public, anon, authenticated;
grant execute on function public.crm_claim_due_newsletters(integer) to service_role;
revoke all on function public.crm_claim_newsletter_recipients(uuid, integer) from public, anon, authenticated;
grant execute on function public.crm_claim_newsletter_recipients(uuid, integer) to service_role;
revoke all on function public.crm_finalize_newsletter(uuid) from public, anon, authenticated;
grant execute on function public.crm_finalize_newsletter(uuid) to service_role;
revoke all on function public.crm_record_newsletter_send_result(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.crm_record_newsletter_send_result(uuid, text, text, text, text) to service_role;
revoke all on function public.crm_release_stale_newsletter_claims(integer) from public, anon, authenticated;
grant execute on function public.crm_release_stale_newsletter_claims(integer) to service_role;
revoke all on function public.crm_record_newsletter_delivery_event(text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.crm_record_newsletter_delivery_event(text, text, timestamptz, text, text) to service_role;
revoke all on function public.crm_issue_newsletter_unsubscribe_token(uuid) from public, anon, authenticated;
grant execute on function public.crm_issue_newsletter_unsubscribe_token(uuid) to service_role;
