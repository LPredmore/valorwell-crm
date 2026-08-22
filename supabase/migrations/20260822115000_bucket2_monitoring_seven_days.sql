-- Bucket 2 monitoring must run seven days a week. Business-day SLA calculations
-- remain business-rule specific; system monitoring itself does not stop on weekends.
do $migration$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname = 'ai-operations-dispatcher-every-5-min'
  limit 1;

  if v_jobid is null then
    raise exception 'Required cron job ai-operations-dispatcher-every-5-min was not found.';
  end if;

  perform cron.alter_job(
    job_id := v_jobid,
    schedule := '*/5 * * * *'
  );
end;
$migration$;
