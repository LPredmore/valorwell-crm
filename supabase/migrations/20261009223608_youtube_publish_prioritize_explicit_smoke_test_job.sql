-- Enable explicit high-priority short-form smoke uploads without discarding an in-progress resumable session.
CREATE OR REPLACE FUNCTION public.claim_next_youtube_publish_job(p_worker_id text, p_lease_seconds integer DEFAULT 600)
 RETURNS SETOF ai_operations_video_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job public.ai_operations_video_jobs;
begin
  if coalesce(btrim(p_worker_id), '') = '' then
    raise exception 'p_worker_id is required';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 60 then
    raise exception 'p_lease_seconds must be at least 60';
  end if;

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
  order by
    case
      when j.payload->>'publish_priority' = 'smoke_test' then -1
      when j.status in ('running', 'claimed') then 0
      else 1
    end,
    j.created_at,
    j.id
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
$function$
;
