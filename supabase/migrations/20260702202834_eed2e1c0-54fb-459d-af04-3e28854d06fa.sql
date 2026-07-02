
do $u$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'cron_secret';
  perform vault.update_secret(v_id, 'E98sg1ZEDE1qEVaCp3SJu4e0BLg6OQ0hTRjFsYEK5Gulc2fz', 'cron_secret', 'Shared secret for pg_cron -> edge function invocation');
end
$u$;

do $c$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';

  if exists (select 1 from cron.job where jobname = 'campaign-scheduler-15min') then
    perform cron.unschedule('campaign-scheduler-15min');
  end if;

  perform cron.schedule(
    'campaign-scheduler-15min',
    '*/15 * * * *',
    format($job$
      select net.http_post(
        url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/campaign-scheduler',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocWF1b21rZ2Zsb3B4Z25sbmRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwMTA2NjcsImV4cCI6MjA3OTU4NjY2N30.WGZoTjcJMSDxG5ss1Oe4T0bSBzhsiijfj-I3DnviWGU',
          'X-Cron-Secret', %L
        ),
        body := '{"source":"cron"}'::jsonb
      );
    $job$, v_secret)
  );
end
$c$;
