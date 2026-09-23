ALTER TABLE public.ai_operations_video_projects
  ADD COLUMN IF NOT EXISTS cover_image_file_id text,
  ADD COLUMN IF NOT EXISTS cover_image_url text;

COMMENT ON COLUMN public.ai_operations_video_projects.cover_image_file_id IS
  'Google Drive file id of the explicitly configured full-episode cover image. NULL means the project has no episode cover; guest_image_url must never be used as a fallback.';
COMMENT ON COLUMN public.ai_operations_video_projects.cover_image_url IS
  'Google Drive /file/d/<id>/view link for the explicitly configured full-episode cover image (private file; not browser-renderable).';