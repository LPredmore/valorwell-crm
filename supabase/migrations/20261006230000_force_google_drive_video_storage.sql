-- Lock the ValorWell video pipeline to Google Drive for persistent video storage.
-- Cloudflare Stream may still be used transiently for processing, but rendered/source
-- video artifacts must persist in Google Drive rather than Supabase Storage or R2.

update public.ai_operations_video_settings
set source_provider = 'google_drive',
    output_provider = 'google_drive',
    output_storage_bucket = null,
    updated_at = now()
where tenant_id = '00000000-0000-0000-0000-000000000001';

alter table public.ai_operations_video_settings
  drop constraint if exists ai_operations_video_settings_output_provider_check;

alter table public.ai_operations_video_settings
  add constraint ai_operations_video_settings_output_provider_check
  check (output_provider = 'google_drive');

alter table public.ai_operations_video_settings
  drop constraint if exists ai_operations_video_settings_output_storage_bucket_check;

alter table public.ai_operations_video_settings
  add constraint ai_operations_video_settings_output_storage_bucket_check
  check (output_storage_bucket is null);
