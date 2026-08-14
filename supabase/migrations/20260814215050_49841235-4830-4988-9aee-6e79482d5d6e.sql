select cron.schedule(
  'provider-applicant-communication-worker',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/provider-applicant-communication-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    );
  $cron$
);