-- Allow thumbnail generation to run from the existing pose metadata alone.
-- core_visual and hook_text_placement remain optional quality controls; the worker derives safe fallbacks.

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
    c.transcript_text,
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
     or coalesce(btrim(v_clip.pose_family), '') = '' then
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
    coalesce(v_clip.core_visual, '<auto>'),
    coalesce(v_clip.hook_text_placement, '<auto>'),
    coalesce(v_clip.transcript_text, ''),
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
  on conflict (tenant_id, idempotency_key)
    where idempotency_key is not null
  do update set
    status = 'queued',
    attempts = 0,
    claimed_by = null,
    claimed_at = null,
    started_at = null,
    completed_at = null,
    error_message = null,
    result = '{}'::jsonb,
    updated_at = now()
  where public.ai_operations_video_jobs.status = 'error'
  returning id into v_job_id;

  return v_job_id;
end;
$function$;

revoke all on function private.enqueue_ai_operations_video_thumbnail_job(uuid)
from public, anon, authenticated;

drop trigger if exists enqueue_ai_operations_video_thumbnail_job
on public.ai_operations_video_clips;

create trigger enqueue_ai_operations_video_thumbnail_job
after insert or update of
  transcript_text,
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
