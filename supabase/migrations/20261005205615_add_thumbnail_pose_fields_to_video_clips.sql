-- Mirror the production thumbnail-composition metadata added to BTY video clips.
alter table public.ai_operations_video_clips
  add column if not exists person_positioning text,
  add column if not exists facial_expression text,
  add column if not exists gesture_action text,
  add column if not exists camera_framing text,
  add column if not exists pose_family text;
