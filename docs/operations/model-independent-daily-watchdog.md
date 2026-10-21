# Model-independent daily monitoring watchdog

ValorWell's primary OpenRouter GLM 5.3 Flash operational scan runs at 08:00 America/Chicago. The independent watchdog checks at 10:00 America/Chicago whether that day's run has status `ok`.

The watchdog runs entirely in a separate Supabase Edge Function (`valorwell-daily-watchdog`). It does not call OpenRouter, so model outages cannot suppress its notifications. It uses the same validated Vault cron token, fixed sender/recipient and Resend integration already used by the daily monitor. The only emailed information is date and a coarse state (`missing`, `model_failed`, or `notify_failed`).

Deploy in order: (1) merge PR, (2) apply `20261021220900_valorwell_daily_watchdog.sql`, (3) deploy the function with `verify_jwt=false` (the function validates the Vault token itself), (4) make one authenticated healthy-path call when the same-day primary run is `ok`; it must return `healthy` and send nothing, (5) enable the schedule with:

```sql
SELECT cron.schedule('valorwell-daily-watchdog','0 15,16 * * *',
  'select private.invoke_valorwell_watchdog_v1()');
```

The private dispatcher gates on **10:00 local America/Chicago**, preventing double scheduling and covering DST changes. If primary monitoring has failed, the watchdog sends one internal alert and records its delivery in `valorwell_watchdog_alerts` for duplicate suppression. Do not intentionally delete the primary run in production just to test failure behavior.

Verify:

```sql
SELECT jobname,schedule,active FROM cron.job WHERE jobname='valorwell-daily-watchdog';
SELECT run_day,status,reason_code,notified_at FROM public.valorwell_watchdog_alerts ORDER BY run_day DESC LIMIT 5;
```

Disable with `SELECT cron.unschedule('valorwell-daily-watchdog');`. The watchdog never sends outreach, modifies CRM ownership or payment records, or sees clinical data.
