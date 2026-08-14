create or replace function public.crm_claim_campaign_trigger_jobs(
  p_worker_id text,
  p_limit integer default 25,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  update public.crm_campaign_trigger_jobs
  set status = 'pending', claim_token = null, claimed_at = null, updated_at = now()
  where status = 'processing'
    and claimed_at < now() - make_interval(secs => greatest(coalesce(p_lease_seconds, 300), 30));

  with due as (
    select j.id
    from public.crm_campaign_trigger_jobs j
    where j.status = 'pending'
      and j.due_at <= now()
      and j.attempt_count < j.max_attempts
    order by j.due_at
    limit greatest(least(coalesce(p_limit, 25), 200), 1)
    for update skip locked
  )
  update public.crm_campaign_trigger_jobs j
  set status = 'processing',
      claim_token = v_token,
      claimed_at = now(),
      attempt_count = j.attempt_count + 1,
      evaluation_result = j.evaluation_result || jsonb_build_object('claimedBy', p_worker_id),
      updated_at = now()
  from due
  where j.id = due.id;

  return coalesce((
    select jsonb_agg(jsonb_build_object('jobId', j.id, 'claimToken', j.claim_token, 'attemptCount', j.attempt_count))
    from public.crm_campaign_trigger_jobs j
    where j.claim_token = v_token and j.status = 'processing'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.crm_claim_campaign_trigger_jobs(text, integer, integer) from public;
grant execute on function public.crm_claim_campaign_trigger_jobs(text, integer, integer) to service_role;