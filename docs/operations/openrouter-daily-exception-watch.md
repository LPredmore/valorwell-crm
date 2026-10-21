# ValorWell daily exception watch — OpenRouter

## Purpose and current mode

Read-only, once per America/Chicago business day. Uses the model ID `z-ai/glm-5.3-flash` via OpenRouter Chat Completions and, **only when actionable new/worsening exceptions exist**, attempts one internal Resend email to `info@valorwell.org`.

This is an operational alert **analyzer**, not an autonomous repair agent. It makes no changes to CRM records, sending pipelines, financial records or clinical data. It does not have permission to call arbitrary tools through the LLM. Provider prompts contain only aggregate numeric operational counts, timestamps and known candidate incident codes, never contact names, emails, message content, user identifiers, credentials, diagnoses or PHI.

## Deployment

1. Merge the change through GitHub's required PR checks.
2. Apply the matching forward-only SQL migration to production after reviewing it. Verify that the public snapshot RPC is service-role-only, the run-history table has RLS and explicit grants, and that the private dispatcher exists.
3. Deploy `supabase/functions/valorwell-daily-exception-watch/index.ts` as a new Edge Function with `verify_jwt=false`. It independently requires a valid `X-Cron-Secret` matching the existing protected `CRON_SHARED_SECRET` Edge secret.
4. In Supabase project `ahqauomkgflopxgnlndd`, set `OPENROUTER_API_KEY` in **Edge Functions → Secrets**. Never put it in GitHub, a frontend variable, Vault migration SQL, logs or a chat message. Existing `RESEND_API_KEY` and `CRON_SHARED_SECRET` must also be available as Edge secrets.
5. Perform an authenticated, read-only `{"mode":"preflight"}` request to this function; verify `ready=true` and all booleans true. Run the deterministic, role-restricted snapshot RPC and confirm it returns aggregate metrics without personal data.
6. Make one approved manual `{}` run after credentials are live; verify the run in `public.valorwell_daily_watch_runs`, that the model is `z-ai/glm-5.3-flash`, and that no alert was sent when there are no new actionable candidates. If there is an alert, check the Resend delivery receipt. Also perform one authenticated `{"mode":"delivery_test"}` invocation, which sends a clearly marked, non-sensitive internal test email to the fixed `info@valorwell.org` recipient. Verify Resend accepted the request and the message reaches the mailbox before retiring the ChatGPT fallback.
7. **Only after passing step 6**, enable the UTC pair of daily checks with:
   ```sql
   SELECT cron.schedule(
     'valorwell-daily-openrouter-watch',
     '0 13,14 * * *',
     'select private.invoke_valorwell_daily_watch_v1()'
   );
   ```
   The dispatcher only sends the request when local Central hour is 08:00. Consequently, DST changes do not shift the user-visible run window. The Edge Function deduplicates completed runs by Central calendar date.
8. After **at least one successful scheduled GLM run and a verified alert delivery path**, disable the original ChatGPT scheduled watch to avoid duplicate monitoring. Until then, retain ChatGPT as a fallback.

## Failure behavior and incident handling

- Missing OpenRouter, Resend or service-role environment configuration → preflight not ready, HTTP 503 for execution. Do **not** enable cron.
- OpenRouter API error, invalid JSON or timeout → `model_failed` run row with coarse error code, no fabricated incident. Check Supabase function logs and OpenRouter account.
- Alert delivery failure → `notify_failed`, with unsent findings retained; never claim the notification was sent.
- No new/worsening signals → completed `ok` row with `notified=false`, no email.
- Important new signal → `ok` row with findings and a Resend alert attempt. Alerts never contain PHI.
- The current known Gmail push problem and existing backlog are **baseline**, not repeated daily alerts unless they worsen. Raw SQL/cron flags are deterministic; the model may summarize only those allowed candidate signals.

## How to inspect and stop

```sql
SELECT run_day, model, status, notified, error_code,
       jsonb_array_length(findings) AS finding_count, updated_at
FROM public.valorwell_daily_watch_runs ORDER BY run_day DESC LIMIT 14;

SELECT jobname, schedule, active FROM cron.job
WHERE jobname='valorwell-daily-openrouter-watch';

-- Pause:
SELECT cron.unschedule('valorwell-daily-openrouter-watch');
```

Observe OpenRouter usage and costs in OpenRouter itself. Do not disable the ChatGPT fallback until the external system has successful end-to-end evidence. Avoid activating arbitrary inactive campaign or claims cron jobs when enabling this watch.
