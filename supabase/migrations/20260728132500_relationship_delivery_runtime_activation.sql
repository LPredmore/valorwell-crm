-- Activate the fail-closed relationship campaign delivery runtime.
-- Provider credentials remain in the private provider-config row and are never embedded here.

create or replace function public.relationship_worker_token_valid(
  p_tenant_id uuid,
  p_token text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.relationship_delivery_provider_configs c
    where c.tenant_id = p_tenant_id
      and c.provider = 'resend'
      and c.status in ('test','ready')
      and nullif(c.metadata->>'worker_token','') is not null
      and c.metadata->>'worker_token' = p_token
  );
$$;

revoke all on function public.relationship_worker_token_valid(uuid,text) from public, anon, authenticated;
grant execute on function public.relationship_worker_token_valid(uuid,text) to service_role;

create or replace function public.get_relationship_webhook_runtime(
  p_tenant_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tenantId', c.tenant_id,
    'provider', c.provider,
    'status', c.status,
    'webhookSecret', c.metadata->>'webhook_signing_secret',
    'webhookId', c.metadata->>'webhook_id',
    'webhookEndpoint', c.webhook_endpoint
  )
  from private.relationship_delivery_provider_configs c
  where c.tenant_id = p_tenant_id
    and c.provider = 'resend'
  limit 1;
$$;

revoke all on function public.get_relationship_webhook_runtime(uuid) from public, anon, authenticated;
grant execute on function public.get_relationship_webhook_runtime(uuid) to service_role;

create or replace function private.run_relationship_campaign_worker()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_request_id bigint;
begin
  select nullif(metadata->>'worker_token','')
    into v_token
    from private.relationship_delivery_provider_configs
   where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
     and provider = 'resend'
     and status in ('test','ready');

  if v_token is null then
    return null;
  end if;

  select net.http_post(
    url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/relationship-campaign-worker',
    body := jsonb_build_object(
      'limit', 25,
      'workerId', 'relationship-cron-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISS')
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Relationship-Worker-Token', v_token
    ),
    timeout_milliseconds := 10000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function private.run_relationship_campaign_worker() from public, anon, authenticated;

comment on function public.relationship_worker_token_valid(uuid,text)
  is 'Service-role-only validation for the private relationship campaign worker credential.';
comment on function public.get_relationship_webhook_runtime(uuid)
  is 'Service-role-only relationship webhook runtime lookup.';
comment on function private.run_relationship_campaign_worker()
  is 'Invokes the relationship campaign worker without exposing its private credential to cron metadata.';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'relationship-campaign-worker') then
    perform cron.unschedule('relationship-campaign-worker');
  end if;

  perform cron.schedule(
    'relationship-campaign-worker',
    '* * * * *',
    'select private.run_relationship_campaign_worker();'
  );
end;
$$;
