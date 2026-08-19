-- Make the AI Operations model-worker schedule match its five-minute name and
-- let the control-plane concurrency setting govern each invocation.

do $migration$
declare
  v_jobid bigint;
  v_command text;
begin
  select jobid, command
    into v_jobid, v_command
  from cron.job
  where jobname = 'ai-operations-model-worker-every-5-min'
  limit 1;

  if v_jobid is null then
    raise exception 'Expected cron job ai-operations-model-worker-every-5-min was not found.';
  end if;

  if position('"limit":4' in v_command) = 0 then
    raise exception 'Expected hardcoded model-worker limit=4 was not found; refusing an ambiguous cron rewrite.';
  end if;

  v_command := replace(v_command, 'body := ''{"limit":4}''::jsonb', 'body := ''{}''::jsonb');

  perform cron.alter_job(
    job_id := v_jobid,
    schedule := '*/5 7-12 * * 1-5',
    command := v_command
  );

  if exists (
    select 1 from cron.job
    where jobid = v_jobid
      and (schedule <> '*/5 7-12 * * 1-5' or command like '%"limit":4%')
  ) then
    raise exception 'AI Operations model-worker cron throttling migration did not reach the expected state.';
  end if;
end;
$migration$;
