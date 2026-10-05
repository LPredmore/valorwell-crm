alter table public.ai_operations_video_clips
  add column if not exists primary_speaker text;
