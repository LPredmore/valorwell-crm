-- Align the YouTube publisher cron request timeout with its 25-second worker budget.
select cron.alter_job(j.jobid, command := replace(j.command, 'timeout_milliseconds := 20000', 'timeout_milliseconds := 40000'))
from cron.job j
where j.jobname = 'video-youtube-publish-dispatcher-1min'
  and j.command like '%timeout_milliseconds := 20000%';
