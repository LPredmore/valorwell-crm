-- Automatic 16:9 YouTube thumbnail generation for BTY Shorts.
-- The database only queues work; generation runs in the authenticated Edge Function worker.

alter table public.ai_operations_video_clips
  add column if not exists core_visual text,
  add column if not exists hook_text_placement text,
  add column if not exists thumbnail_generation_revision integer not null default 0;

alter table public.ai_operations_video_clips
  drop constraint if exists ai_operations_video_clips_hook_text_placement_check;

alter table public.ai_operations_video_clips
  add constraint ai_operations_video_clips_hook_text_placement_check
  check (
    hook_text_placement is null
    or hook_text_placement = any (array[
      'top_left'::text,
      'top_right'::text,
      'left'::text,
      'right'::text,
      'bottom_left'::text,
      'bottom_right'::text,
      'center'::text
    ])
  );

alter table public.ai_operations_video_clips
  drop constraint if exists ai_operations_video_clips_thumbnail_generation_revision_check;

alter table public.ai_operations_video_clips
  add constraint ai_operations_video_clips_thumbnail_generation_revision_check
  check (thumbnail_generation_revision >= 0);

alter table public.ai_operations_video_settings
  add column if not exists host_reference_name text,
  add column if not exists host_reference_file_id text,
  add column if not exists host_reference_url text;

alter table public.ai_operations_video_jobs
  drop constraint if exists ai_operations_video_jobs_job_type_check;

alter table public.ai_operations_video_jobs
  add constraint ai_operations_video_jobs_job_type_check
  check (job_type = any (array[
    'transcribe'::text,
    'render_clip'::text,
    'publish_youtube'::text,
    'refresh_source_metadata'::text,
    'concat_video'::text,
    'generate_thumbnail'::text
  ]));

create unique index if not exists ai_operations_video_jobs_active_thumbnail_uidx
  on public.ai_operations_video_jobs (clip_id, job_type)
  where job_type = 'generate_thumbnail'
    and clip_id is not null
    and status = any (array['queued'::text, 'claimed'::text, 'running'::text]);

create or replace function private.enqueue_ai_operations_video_thumbnail_job(p_clip_id uuid)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_clip record;
  v_settings record;
  v_hash text;
  v_job_id bigint;
  v_idempotency_key text;
begin
  select
    c.id,
    c.project_id,
    c.clip_type,
    c.hook_text,
    c.primary_speaker,
    c.person_positioning,
    c.facial_expression,
    c.gesture_action,
    c.camera_framing,
    c.pose_family,
    c.core_visual,
    c.hook_text_placement,
    c.thumbnail_generation_revision,
    c.cover_image_file_id,
    p.tenant_id,
    p.guest_name,
    p.guest_image_url
  into v_clip
  from public.ai_operations_video_clips c
  join public.ai_operations_video_projects p on p.id = c.project_id
  where c.id = p_clip_id
  limit 1;

  if not found
     or v_clip.clip_type <> 'short'
     or v_clip.cover_image_file_id is not null
     or coalesce(btrim(v_clip.hook_text), '') = ''
     or coalesce(btrim(v_clip.primary_speaker), '') = ''
     or coalesce(btrim(v_clip.person_positioning), '') = ''
     or coalesce(btrim(v_clip.facial_expression), '') = ''
     or coalesce(btrim(v_clip.gesture_action), '') = ''
     or coalesce(btrim(v_clip.camera_framing), '') = ''
     or coalesce(btrim(v_clip.pose_family), '') = ''
     or coalesce(btrim(v_clip.core_visual), '') = ''
     or coalesce(btrim(v_clip.hook_text_placement), '') = '' then
    return null;
  end if;

  select s.*
  into v_settings
  from public.ai_operations_video_settings s
  where s.tenant_id = v_clip.tenant_id
  limit 1;

  if not found or coalesce(btrim(v_settings.cover_image_folder_id), '') = '' then
    return null;
  end if;

  if lower(btrim(v_clip.primary_speaker)) in ('luke', 'luke predmore') then
    if coalesce(btrim(v_settings.host_reference_file_id), '') = '' then
      return null;
    end if;
  elsif coalesce(lower(btrim(v_clip.guest_name)), '') <> lower(btrim(v_clip.primary_speaker))
        or coalesce(btrim(v_clip.guest_image_url), '') = '' then
    return null;
  end if;

  v_hash := md5(concat_ws(
    E'\x1f',
    v_clip.hook_text,
    v_clip.primary_speaker,
    v_clip.person_positioning,
    v_clip.facial_expression,
    v_clip.gesture_action,
    v_clip.camera_framing,
    v_clip.pose_family,
    v_clip.core_visual,
    v_clip.hook_text_placement,
    v_clip.thumbnail_generation_revision::text
  ));
  v_idempotency_key := 'thumbnail:' || v_clip.id::text || ':' ||
    v_clip.thumbnail_generation_revision::text || ':' || v_hash;

  insert into public.ai_operations_video_jobs(
    tenant_id,
    project_id,
    clip_id,
    job_type,
    status,
    payload,
    idempotency_key
  )
  values(
    v_clip.tenant_id,
    v_clip.project_id,
    v_clip.id,
    'generate_thumbnail',
    'queued',
    jsonb_build_object(
      'metadata_hash', v_hash,
      'generation_revision', v_clip.thumbnail_generation_revision,
      'source', 'thumbnail_metadata_ready'
    ),
    v_idempotency_key
  )
  on conflict do nothing
  returning id into v_job_id;

  return v_job_id;
end;
$function$;

revoke all on function private.enqueue_ai_operations_video_thumbnail_job(uuid)
from public, anon, authenticated;

create or replace function private.enqueue_ai_operations_video_thumbnail_job_for_clip()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform private.enqueue_ai_operations_video_thumbnail_job(new.id);
  return new;
end;
$function$;

revoke all on function private.enqueue_ai_operations_video_thumbnail_job_for_clip()
from public, anon, authenticated;

drop trigger if exists enqueue_ai_operations_video_thumbnail_job
on public.ai_operations_video_clips;

create trigger enqueue_ai_operations_video_thumbnail_job
after insert or update of
  hook_text,
  primary_speaker,
  person_positioning,
  facial_expression,
  gesture_action,
  camera_framing,
  pose_family,
  core_visual,
  hook_text_placement,
  thumbnail_generation_revision,
  cover_image_file_id
on public.ai_operations_video_clips
for each row
execute function private.enqueue_ai_operations_video_thumbnail_job_for_clip();

create or replace function private.enqueue_ai_operations_video_thumbnail_jobs_for_project()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_clip_id uuid;
begin
  for v_clip_id in
    select c.id
    from public.ai_operations_video_clips c
    where c.project_id = new.id
      and c.clip_type = 'short'
      and c.cover_image_file_id is null
  loop
    perform private.enqueue_ai_operations_video_thumbnail_job(v_clip_id);
  end loop;
  return new;
end;
$function$;

revoke all on function private.enqueue_ai_operations_video_thumbnail_jobs_for_project()
from public, anon, authenticated;

drop trigger if exists enqueue_ai_operations_video_thumbnail_jobs_project
on public.ai_operations_video_projects;

create trigger enqueue_ai_operations_video_thumbnail_jobs_project
after update of guest_name, guest_image_url
on public.ai_operations_video_projects
for each row
execute function private.enqueue_ai_operations_video_thumbnail_jobs_for_project();

create or replace function private.enqueue_ai_operations_video_thumbnail_jobs_for_settings()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_clip_id uuid;
begin
  for v_clip_id in
    select c.id
    from public.ai_operations_video_clips c
    join public.ai_operations_video_projects p on p.id = c.project_id
    where p.tenant_id = new.tenant_id
      and c.clip_type = 'short'
      and c.cover_image_file_id is null
      and lower(btrim(c.primary_speaker)) in ('luke', 'luke predmore')
  loop
    perform private.enqueue_ai_operations_video_thumbnail_job(v_clip_id);
  end loop;
  return new;
end;
$function$;

revoke all on function private.enqueue_ai_operations_video_thumbnail_jobs_for_settings()
from public, anon, authenticated;

drop trigger if exists enqueue_ai_operations_video_thumbnail_jobs_settings
on public.ai_operations_video_settings;

create trigger enqueue_ai_operations_video_thumbnail_jobs_settings
after update of host_reference_file_id, cover_image_folder_id
on public.ai_operations_video_settings
for each row
execute function private.enqueue_ai_operations_video_thumbnail_jobs_for_settings();

create or replace function public.claim_next_video_thumbnail_job(
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns setof public.ai_operations_video_jobs
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job public.ai_operations_video_jobs;
begin
  if coalesce(btrim(p_worker_id), '') = '' then
    raise exception 'p_worker_id is required';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 60 then
    raise exception 'p_lease_seconds must be at least 60';
  end if;

  select j.*
  into v_job
  from public.ai_operations_video_jobs j
  where j.job_type = 'generate_thumbnail'
    and (
      j.status = 'queued'
      or (
        j.status in ('claimed', 'running')
        and (
          j.claimed_at is null
          or j.claimed_at < now() - make_interval(secs => p_lease_seconds)
        )
      )
    )
  order by
    case when j.status = 'queued' then 1 else 0 end,
    j.created_at,
    j.id
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  return query
  update public.ai_operations_video_jobs j
  set status = 'running',
      attempts = case when v_job.status = 'queued' then j.attempts + 1 else j.attempts end,
      claimed_by = p_worker_id,
      claimed_at = now(),
      started_at = coalesce(j.started_at, now()),
      error_message = null,
      updated_at = now(),
      payload = case
        when v_job.status <> 'queued' and v_job.claimed_at is not null then
          j.payload || jsonb_build_object(
            'stale_recovery_count',
            coalesce((j.payload ->> 'stale_recovery_count')::integer, 0) + 1,
            'stale_recovered_at',
            now(),
            'stale_recovered_from',
            v_job.claimed_by
          )
        else j.payload
      end
  where j.id = v_job.id
  returning j.*;
end;
$function$;

revoke all on function public.claim_next_video_thumbnail_job(text, integer)
from public, anon, authenticated;
grant execute on function public.claim_next_video_thumbnail_job(text, integer)
to service_role;

create or replace function public.complete_video_thumbnail_job(
  p_job_id bigint,
  p_worker_id text,
  p_clip_id uuid,
  p_file_id text default null,
  p_file_url text default null,
  p_result jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_job public.ai_operations_video_jobs;
  v_clip public.ai_operations_video_clips;
  v_applied boolean := false;
begin
  select *
  into v_job
  from public.ai_operations_video_jobs
  where id = p_job_id
    and job_type = 'generate_thumbnail'
  for update;

  if not found then
    raise exception 'Thumbnail job not found';
  end if;
  if v_job.clip_id is distinct from p_clip_id then
    raise exception 'Thumbnail job clip mismatch';
  end if;
  if v_job.status not in ('running', 'claimed') or v_job.claimed_by is distinct from p_worker_id then
    raise exception 'Thumbnail job lease is not owned by this worker';
  end if;

  select *
  into v_clip
  from public.ai_operations_video_clips
  where id = p_clip_id
  for update;

  if not found then
    raise exception 'Thumbnail clip not found';
  end if;

  if v_clip.cover_image_file_id is null and coalesce(btrim(p_file_id), '') <> '' then
    update public.ai_operations_video_clips
    set cover_image_file_id = p_file_id,
        cover_image_url = p_file_url,
        updated_at = now()
    where id = p_clip_id;

    update public.ai_operations_social_publications
    set thumbnail_file_id = p_file_id,
        thumbnail_url = p_file_url,
        status = case when status = 'approved' then 'ready' else status end,
        approved_at = case when status = 'approved' then null else approved_at end,
        approved_by = case when status = 'approved' then null else approved_by end,
        updated_at = now()
    where clip_id = p_clip_id
      and status in ('draft', 'ready', 'approved');

    v_applied := true;
  end if;

  update public.ai_operations_video_jobs
  set status = 'complete',
      result = coalesce(p_result, '{}'::jsonb) || jsonb_build_object(
        'applied', v_applied,
        'file_id', p_file_id,
        'file_url', p_file_url
      ),
      completed_at = now(),
      error_message = null,
      updated_at = now()
  where id = p_job_id;

  return v_applied;
end;
$function$;

revoke all on function public.complete_video_thumbnail_job(bigint, text, uuid, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.complete_video_thumbnail_job(bigint, text, uuid, text, text, jsonb)
to service_role;

create or replace function public.fail_video_thumbnail_job(
  p_job_id bigint,
  p_worker_id text,
  p_error text,
  p_retryable boolean default true,
  p_result jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_job public.ai_operations_video_jobs;
  v_retry boolean;
  v_next_status text;
begin
  select *
  into v_job
  from public.ai_operations_video_jobs
  where id = p_job_id
    and job_type = 'generate_thumbnail'
  for update;

  if not found then
    raise exception 'Thumbnail job not found';
  end if;
  if v_job.status not in ('running', 'claimed') or v_job.claimed_by is distinct from p_worker_id then
    raise exception 'Thumbnail job lease is not owned by this worker';
  end if;

  v_retry := coalesce(p_retryable, true) and v_job.attempts < 3;
  v_next_status := case when v_retry then 'queued' else 'error' end;

  update public.ai_operations_video_jobs
  set status = v_next_status,
      claimed_by = case when v_retry then null else claimed_by end,
      claimed_at = case when v_retry then null else claimed_at end,
      started_at = case when v_retry then null else started_at end,
      error_message = left(coalesce(p_error, 'Thumbnail generation failed.'), 4000),
      result = coalesce(result, '{}'::jsonb) || coalesce(p_result, '{}'::jsonb),
      updated_at = now()
  where id = p_job_id;

  return v_next_status;
end;
$function$;

revoke all on function public.fail_video_thumbnail_job(bigint, text, text, boolean, jsonb)
from public, anon, authenticated;
grant execute on function public.fail_video_thumbnail_job(bigint, text, text, boolean, jsonb)
to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'video-thumbnail-generation-dispatcher-1min'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;

select cron.schedule(
  'video-thumbnail-generation-dispatcher-1min',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/video-thumbnail-generation-dispatcher',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cron$
);
