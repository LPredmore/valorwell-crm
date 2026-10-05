create or replace function private.enqueue_ai_operations_video_render_jobs()
returns integer
language plpgsql
set search_path to ''
as $function$
declare
  v_count integer := 0;
begin
  update public.ai_operations_video_jobs
  set status='queued',
      claimed_by=null,
      claimed_at=null,
      started_at=null,
      error_message='Recovered after stale render-worker claim.',
      updated_at=now()
  where job_type='render_clip'
    and status in ('claimed','running')
    and updated_at < now() - interval '2 hours';

  update public.ai_operations_video_clips c
  set status='render_queued',
      updated_at=now()
  where c.id in (
    select j.clip_id
    from public.ai_operations_video_jobs j
    where j.job_type='render_clip'
      and j.status='queued'
      and j.clip_id is not null
  )
    and c.drive_file_id is null
    and c.status <> 'render_queued';

  with candidates as (
    select c.id as clip_id, c.project_id, p.tenant_id
    from public.ai_operations_video_clips c
    join public.ai_operations_video_projects p
      on p.id=c.project_id
    where c.drive_file_id is null
      and c.status in ('proposed','error','render_queued')
      and c.clip_type in ('short','part')
      and btrim(c.transcript_text) <> ''
      and c.start_seconds >= 0
      and c.end_seconds > c.start_seconds
      and btrim(c.parent_file_id) <> ''
      and btrim(p.source_file_id) <> ''
      and c.parent_file_id = p.source_file_id
      and not exists (
        select 1
        from public.ai_operations_video_jobs j
        where j.clip_id=c.id
          and j.job_type='render_clip'
          and j.status in ('queued','claimed','running')
      )
    order by c.created_at
    limit 100
  ),
  inserted as (
    insert into public.ai_operations_video_jobs(
      tenant_id, project_id, clip_id, job_type, status, payload
    )
    select x.tenant_id, x.project_id, x.clip_id, 'render_clip', 'queued', '{}'::jsonb
    from candidates x
    on conflict do nothing
    returning clip_id
  )
  update public.ai_operations_video_clips c
  set status='render_queued',
      error_message=null,
      updated_at=now()
  where c.id in (select clip_id from inserted);

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function private.enqueue_ai_operations_video_render_job_for_clip()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant_id uuid;
  v_source_file_id text;
begin
  if new.drive_file_id is not null
     or new.clip_type not in ('short','part')
     or btrim(new.transcript_text) = ''
     or new.start_seconds < 0
     or new.end_seconds <= new.start_seconds
     or btrim(new.parent_file_id) = '' then
    return new;
  end if;

  select p.tenant_id, p.source_file_id
    into v_tenant_id, v_source_file_id
  from public.ai_operations_video_projects p
  where p.id=new.project_id
    and btrim(p.source_file_id) <> ''
  limit 1;

  if v_tenant_id is null
     or v_source_file_id is null
     or new.parent_file_id <> v_source_file_id then
    return new;
  end if;

  insert into public.ai_operations_video_jobs(
    tenant_id, project_id, clip_id, job_type, status, payload
  )
  values(
    v_tenant_id,
    new.project_id,
    new.id,
    'render_clip',
    'queued',
    '{}'::jsonb
  )
  on conflict do nothing;

  return new;
end;
$function$;

revoke all on function private.enqueue_ai_operations_video_render_job_for_clip()
from public, anon, authenticated;

drop trigger if exists enqueue_ai_operations_video_render_job
on public.ai_operations_video_clips;

create trigger enqueue_ai_operations_video_render_job
after insert or update of
  project_id,
  start_seconds,
  end_seconds,
  transcript_text,
  clip_type,
  parent_file_id,
  drive_file_id
on public.ai_operations_video_clips
for each row
execute function private.enqueue_ai_operations_video_render_job_for_clip();

select cron.schedule(
  'video-render-enqueue-1min',
  '* * * * *',
  'select private.enqueue_ai_operations_video_render_jobs();'
);

select cron.schedule(
  'video-cloudflare-render-dispatcher-1min',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/video-cloudflare-render-dispatcher',
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type','application/json'),
      timeout_milliseconds := 15000
    );
  $cron$
);
