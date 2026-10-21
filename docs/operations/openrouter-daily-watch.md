# ValorWell external daily operations watch

Purpose: independent, read-only daily operations monitoring through OpenRouter model z-ai/glm-5.3-flash and Supabase pg_cron. It sends aggregate metrics only, no PHI, raw messages, or credentials.

## Secrets needed before activation

In production Supabase Edge Functions -> Secrets, configure OPENROUTER_API_KEY (a capped, restricted API key), VALORWELL_MONITOR_ALERT_TO (operator-controlled destination), RESEND_API_KEY, and CRON_SECRET matching existing Supabase Vault cron_secret. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase. Optional VALORWELL_MONITOR_ALERT_FROM uses a verified sending domain.

Never paste credentials in GitHub, Todoist, SQL text, or this chat. A deployed but unconfigured function does not count as a working daily monitor.

## Procedure

1. Merge reviewed code; deploy supabase/functions/valorwell-daily-operations-watch/index.ts with verify_jwt=false because the function itself authenticates the x-cron-secret header.
2. Apply the reviewed SQL migration 20261021210000_openrouter_daily_operations_watch.sql (RLS service-role-only run ledger and read-only aggregated metrics RPC).
3. Call the protected health route via a pg_net POST using a header read from vault.decrypted_secrets where name='cron_secret'. Confirm ready=true, that the key is funded and the authorized email destination is operational.
4. After passing authentication, model request and delivery checks, activate this SQL job:

```sql
select cron.schedule(
  'valorwell-openrouter-daily-ops',
  '5 13,14 * * *',
  $job$
  select net.http_post(
    url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/valorwell-daily-operations-watch',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_secret')
    ),
    body := '{}'::jsonb, timeout_milliseconds := 10000
  );
  $job$
);
```

Runs at 13:05 and 14:05 UTC; inside the function, the America/Chicago hour gate chooses exactly one local 8 AM invocation regardless of DST. A unique run_day protects against duplicate daily runs.

5. Verify a row in public.valorwell_monitor_runs and a Resend alert if the test run contains eligible exceptional counters. No provider actions, campaign sends or database repairs occur.

## Read-only and privacy requirements

Input to GLM: only aggregate status counts and dates/timestamps (Gmail sync, ownership, CRM tasks, calendar linkage, campaign queue, Stripe webhook statuses, cron failures). No names, email addresses, raw correspondence, patient/clinical data or credentials. Deterministic numeric checks gate alert eligibility; the model only writes a concise summary.

Data access: both the snapshot RPC and monitor ledger reject anon/authenticated privileges and permit service_role only. Health and run endpoints also require a private cron secret.

Once activation succeeds, disable the ChatGPT-hosted exception watch to avoid duplication. Roll back with select cron.unschedule('valorwell-openrouter-daily-ops'); retain the run ledger for audit.

## Blockers

Do not schedule active daily calls before a real key, valid alert recipient, a working authenticated health check and a verified model/Resend response. Record provider errors as failures, not healthy days.