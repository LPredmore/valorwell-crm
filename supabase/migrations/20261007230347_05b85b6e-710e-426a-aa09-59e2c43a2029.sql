-- lovable-cron-fallback-reviewed: same reviewed Friday-noon deadline job, only the target URL/body changes; idle runs are an indexed EXISTS with no HTTP call.
select cron.unschedule('video-series-dispatcher-1min')
where exists (select 1 from cron.job where jobname = 'video-series-dispatcher-1min');

select cron.schedule(
  'video-series-dispatcher-1min',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/social-media-manager',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{"action":"series_dispatch_tick"}'::jsonb,
    timeout_milliseconds := 20000
  )
  where exists (
    select 1 from public.ai_operations_video_series_schedules c
    where c.status in ('assigned','blocked','dispatching','queued','partially_scheduled','youtube_scheduled')
      and c.dispatch_at <= now()
      and coalesce(c.next_attempt_at, '-infinity'::timestamptz) <= now()
      and (c.lease_expires_at is null or c.lease_expires_at < now())
  );
  $$
);