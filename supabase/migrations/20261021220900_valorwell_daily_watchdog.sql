-- Independent alert if the main OpenRouter monitor does not complete by 10 AM Central.
-- This watchdog does not call the LLM and never touches patient or campaign records.
CREATE TABLE public.valorwell_watchdog_alerts (
 run_day date PRIMARY KEY,
 status text NOT NULL CHECK (status IN ('delivered','delivery_failed')),
 reason_code text NOT NULL,
 notified_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.valorwell_watchdog_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.valorwell_watchdog_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.valorwell_watchdog_alerts TO service_role;

CREATE OR REPLACE FUNCTION private.invoke_valorwell_watchdog_v1()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $body$
DECLARE v_token text; v_request bigint;
BEGIN
  IF extract(hour FROM now() AT TIME ZONE 'America/Chicago') <> 10 THEN
    RETURN NULL;
  END IF;
  SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets WHERE name='cron_secret' LIMIT 1;
  IF NULLIF(v_token,'') IS NULL THEN
    RAISE EXCEPTION 'watchdog cron secret missing';
  END IF;
  SELECT net.http_post(
    url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/valorwell-daily-exception-watch',
    headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret',v_token),
    body := '{"mode":"watchdog"}'::jsonb,
    timeout_milliseconds := 25000
  ) INTO v_request;
  RETURN v_request;
END;
$body$;
REVOKE ALL ON FUNCTION private.invoke_valorwell_watchdog_v1()
  FROM PUBLIC, anon, authenticated, service_role;
-- After deploy and successful healthy watchdog test, enable:
-- SELECT cron.schedule('valorwell-daily-watchdog','0 15,16 * * *',
--   'select private.invoke_valorwell_watchdog_v1()');
