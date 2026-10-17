-- Process one historical Gmail page per scheduled run. Existing live Gmail
-- reconciliation remains independent and is never paused for this job.
create or replace function private.run_relationship_gmail_backfill()
returns bigint
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_token text;
  v_request_id bigint;
  v_issue_details jsonb;
begin
  select details into v_issue_details
  from public.relationship_reconciliation_issues
  where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
    and source='gmail' and issue_type='sync_error' and status='open'
    and details->>'requires_historical_backfill'='true'
  order by created_at asc limit 1;
  if not found then return null; end if;

  -- A rate-limit response should not result in continuous provider hammering.
  if v_issue_details->>'backfill_last_error'='google_http_403'
     and nullif(v_issue_details->>'backfill_last_failure_at','') is not null
     and (v_issue_details->>'backfill_last_failure_at')::timestamptz > now()-interval '30 minutes'
  then
    return null;
  end if;

  select nullif(metadata->>'worker_token','') into v_token
  from private.relationship_delivery_provider_configs
  where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
    and provider='resend' and status in ('test','ready')
  limit 1;
  if v_token is null then return null; end if;

  select net.http_post(
    url:='https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/relationship-google-maintenance',
    body:=jsonb_build_object('mode','gmail_backfill'),
    headers:=jsonb_build_object('Content-Type','application/json',
                               'X-Relationship-Worker-Token',v_token),
    timeout_milliseconds:=30000
  ) into v_request_id;
  return v_request_id;
end;
$fn$;

revoke all on function private.run_relationship_gmail_backfill() from public,anon,authenticated;
-- Background runner is intentionally disabled automatically at the application
-- layer once there are no outstanding historical issues (returns without HTTP).
select cron.schedule(
  'relationship-gmail-historical-backfill',
  '*/5 * * * *',
  'select private.run_relationship_gmail_backfill();'
);
