-- Reuse the existing once-hourly audit, no second recurring cron job.
-- New worker does not send messages. Fail closed if the known audit was replaced.
DO $guard$
DECLARE j record; clean text; revised text;
BEGIN
 SELECT * INTO j FROM cron.job WHERE jobname='valorwell-hourly-comms-audit';
 IF NOT FOUND OR j.jobid<>113 OR j.schedule<>'36 * * * *' OR NOT j.active
 THEN RAISE EXCEPTION 'Unexpected hourly audit schedule'; END IF;
 IF j.command LIKE '%/autonomous-inbox-approved-action-worker%'
    AND j.command LIKE '%/valorwell-hourly-comms-audit%' THEN
  RETURN;
 END IF;
 IF md5(j.command)<>'c6dd6fad31e0678d209df8138a0884ce'
 THEN RAISE EXCEPTION 'Unknown hourly audit command; do not rewrite'; END IF;
 clean:=trim(both E' \n\r\t' from j.command);
 IF clean !~* '^select[[:space:]]+net[.]http_post[[:space:]]*[(]'
    OR right(clean,1)<>';' THEN
  RAISE EXCEPTION 'Unexpected audit SQL';
 END IF;
 revised:=left(clean,length(clean)-1)
 || ', net.http_post('
 || 'url := ''https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/autonomous-inbox-approved-action-worker'','
 || 'body := ''{}''::jsonb,'
 || 'headers := jsonb_build_object(''Content-Type'',''application/json'','
 || '''X-Cron-Secret'',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=''cron_secret'' LIMIT 1)),'
 || 'timeout_milliseconds := 15000'
 || ') AS approved_action_worker;';
 PERFORM cron.alter_job(job_id=>j.jobid,command=>revised);
END $guard$;
