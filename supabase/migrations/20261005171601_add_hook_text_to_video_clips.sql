alter table public.ai_operations_video_clips
  add column if not exists hook_text text;
