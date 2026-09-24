-- Social Media Manager: atomic, lease-based claiming of publish_youtube jobs.
--
-- The dispatcher runs every minute and each invocation advances one job by one step
-- (create the resumable session, upload one chunk, or run a finishing step), so a job
-- legitimately stays `running` across many invocations. Before this migration an
-- invocation selected a job and then updated it in a separate statement, so two
-- overlapping invocations could pick the same job and each create a YouTube resumable
-- upload session -- i.e. two videos.
--
-- A claim is now a lease: claimed_by/claimed_at name the invocation currently allowed to
-- touch the job. The worker releases the lease (claimed_at := null) when its step ends;
-- a lease older than p_lease_seconds belongs to an invocation that crashed or was killed
-- and is taken over. Takeover never clears payload.upload_session_url: the new holder
-- asks YouTube for the authoritative byte offset before sending anything.

create or replace function public.claim_next_youtube_publish_job(
  p_worker_id text,
  p_lease_seconds integer default 600
)
returns setof public.ai_operations_video_jobs
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job public.ai_operations_video_jobs;
begin
  if coalesce(btrim(p_worker_id), '') = '' then
    raise exception 'p_worker_id is required';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 60 then
    raise exception 'p_lease_seconds must be at least 60';
  end if;

  -- Candidates, oldest first, in-flight work before new work:
  --   * running/claimed with no lease holder (released after its previous step) whose
  --     publication is not deliberately waiting (next_attempt_at: polling YouTube
  --     processing, or backing off), or a lease older than p_lease_seconds (holder
  --     crashed -- always recovered);
  --   * queued, unless the publication is backing off after a transient failure.
  -- FOR UPDATE SKIP LOCKED makes concurrent callers pick different rows; the WHERE clause
  -- is re-checked against the locked row version, so a row another caller claimed and
  -- committed in the meantime is never returned twice.
  select j.*
  into v_job
  from public.ai_operations_video_jobs j
  join public.ai_operations_social_publications p on p.id = j.social_publication_id
  where j.job_type = 'publish_youtube'
    and (
      (j.status in ('running', 'claimed')
        and (
          (j.claimed_at is null and (p.next_attempt_at is null or p.next_attempt_at <= now()))
          or j.claimed_at < now() - make_interval(secs => p_lease_seconds)
        ))
      or
      (j.status = 'queued' and (p.next_attempt_at is null or p.next_attempt_at <= now()))
    )
  order by case when j.status = 'queued' then 1 else 0 end, j.created_at, j.id
  limit 1
  for update of j skip locked;

  if not found then
    return;
  end if;

  return query
  update public.ai_operations_video_jobs j
  set status = 'running',
      attempts = case when v_job.status = 'queued' then j.attempts + 1 else j.attempts end,
      started_at = case when v_job.status = 'queued' then now() else coalesce(j.started_at, now()) end,
      claimed_by = p_worker_id,
      claimed_at = now(),
      -- Record a takeover of a crashed holder's lease; the worker bounds how many it allows.
      payload = case
        when v_job.status <> 'queued' and v_job.claimed_at is not null then
          j.payload || jsonb_build_object(
            'stale_recovery_count', coalesce((j.payload ->> 'stale_recovery_count')::integer, 0) + 1,
            'stale_recovered_at', now(),
            'stale_recovered_from', v_job.claimed_by
          )
        else j.payload
      end
  where j.id = v_job.id
  returning j.*;
end;
$function$;

revoke all on function public.claim_next_youtube_publish_job(text, integer) from public;
revoke all on function public.claim_next_youtube_publish_job(text, integer) from anon, authenticated;
grant execute on function public.claim_next_youtube_publish_job(text, integer) to service_role;

-- Ends a lease without changing the job's state, so the next dispatcher tick can continue
-- the job immediately. Fenced on the holder: a worker whose lease was taken over cannot
-- release (or later overwrite) the new holder's claim.
create or replace function public.release_youtube_publish_job(
  p_job_id bigint,
  p_worker_id text
)
returns boolean
language sql
security definer
set search_path to 'public'
as $function$
  with released as (
    update public.ai_operations_video_jobs
    set claimed_by = null, claimed_at = null
    where id = p_job_id
      and job_type = 'publish_youtube'
      and claimed_by = p_worker_id
    returning id
  )
  select exists (select 1 from released);
$function$;

revoke all on function public.release_youtube_publish_job(bigint, text) from public;
revoke all on function public.release_youtube_publish_job(bigint, text) from anon, authenticated;
grant execute on function public.release_youtube_publish_job(bigint, text) to service_role;

-- Existing in-flight jobs were written without a lease; they are claimable as released
-- rows under the new rule, which matches how the old dispatcher resumed them.
