-- Social Media Manager: closes a double-queue race the schema doesn't otherwise prevent,
-- and gives the CRM control-plane one atomic "queue this publication" operation instead of
-- two sequential writes it would have to compensate for by hand.
-- Also schedules the new publish_youtube worker on the same cadence as the existing
-- render dispatcher, gated by the X-Cron-Secret header (not the unauthenticated pattern
-- video-cloudflare-render-dispatcher uses).

-- Prevent more than one active publish_youtube job per publication.
create unique index if not exists ai_operations_video_jobs_active_publish_uidx
  on public.ai_operations_video_jobs (social_publication_id)
  where job_type = 'publish_youtube' and status in ('queued', 'claimed', 'running');

create or replace function public.social_queue_publish(
  p_publication_id uuid
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_publication record;
  v_job_id bigint;
begin
  select id, tenant_id, project_id, clip_id, status
  into v_publication
  from public.ai_operations_social_publications
  where id = p_publication_id
  for update;

  if not found then
    raise exception 'Publication % does not exist', p_publication_id;
  end if;

  if v_publication.status <> 'approved' then
    raise exception 'Publication must be approved before it can be queued (current status: %)', v_publication.status;
  end if;

  if exists (
    select 1 from public.ai_operations_video_jobs
    where social_publication_id = p_publication_id
      and job_type = 'publish_youtube'
      and status in ('queued', 'claimed', 'running')
  ) then
    raise exception 'Publication % already has an active publish job', p_publication_id;
  end if;

  insert into public.ai_operations_video_jobs (
    tenant_id, project_id, clip_id, job_type, status, social_publication_id, payload
  )
  values (
    v_publication.tenant_id, v_publication.project_id, v_publication.clip_id,
    'publish_youtube', 'queued', p_publication_id, '{}'::jsonb
  )
  returning id into v_job_id;

  -- The status change below fires ai_operations_social_publications_record_status_change,
  -- which already inserts a status_changed event (from_status/to_status) -- do not
  -- duplicate that here.
  update public.ai_operations_social_publications
  set status = 'upload_queued'
  where id = p_publication_id;

  return v_job_id;
end;
$function$;

revoke all on function public.social_queue_publish(uuid) from public;
grant execute on function public.social_queue_publish(uuid) to service_role;

select cron.unschedule('video-youtube-publish-dispatcher-1min')
where exists (select 1 from cron.job where jobname = 'video-youtube-publish-dispatcher-1min');

select cron.schedule(
  'video-youtube-publish-dispatcher-1min',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/video-youtube-publish-dispatcher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
