-- One-time migration control plane for legacy Cloudflare R2 videos -> Google Drive.
-- The migration worker only deletes an R2 object after the Drive object is size-verified.

create table if not exists public.ai_operations_video_storage_migrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_provider text not null default 'cloudflare_r2' check (source_provider = 'cloudflare_r2'),
  source_bucket text not null,
  source_key text not null,
  source_size_bytes bigint not null default 0,
  source_etag text,
  source_last_modified timestamptz,
  source_url text,
  target_provider text not null default 'google_drive' check (target_provider = 'google_drive'),
  target_drive_folder_id text,
  target_drive_file_id text,
  target_drive_file_url text,
  target_file_name text,
  target_size_bytes bigint,
  target_md5 text,
  migration_status text not null default 'pending'
    check (migration_status in ('pending','deduplicated','uploading','uploaded','verified','complete','skipped','error')),
  upload_session_url text,
  bytes_uploaded bigint not null default 0,
  attempts integer not null default 0,
  last_error text,
  db_references_found integer not null default 0,
  db_references_updated integer not null default 0,
  source_deleted_at timestamptz,
  verified_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  claimed_by text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, source_bucket, source_key)
);

create index if not exists ai_operations_video_storage_migrations_status_idx
  on public.ai_operations_video_storage_migrations (tenant_id, migration_status, updated_at);
create index if not exists ai_operations_video_storage_migrations_lease_idx
  on public.ai_operations_video_storage_migrations (lease_expires_at);

alter table public.ai_operations_video_storage_migrations enable row level security;
revoke all on public.ai_operations_video_storage_migrations from anon, authenticated;

create or replace function public.get_legacy_r2_migration_token()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'legacy_r2_migration_token'
  order by created_at desc
  limit 1
$$;

revoke all on function public.get_legacy_r2_migration_token() from public, anon, authenticated;
grant execute on function public.get_legacy_r2_migration_token() to service_role;

create or replace function public.run_video_r2_drive_migration_tick()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, cron
as $$
declare
  v_actionable bigint;
  v_nonterminal bigint;
  v_request_id bigint;
begin
  select count(*) into v_actionable
  from public.ai_operations_video_storage_migrations
  where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
    and migration_status in ('pending','uploading','error')
    and attempts < 8;

  select count(*) into v_nonterminal
  from public.ai_operations_video_storage_migrations
  where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
    and migration_status not in ('complete','skipped');

  if v_nonterminal = 0 then
    perform cron.unschedule('video-r2-drive-migration-1min');
    return null;
  end if;

  if v_actionable = 0 then
    return null;
  end if;

  select net.http_post(
    url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/video-r2-drive-migrator',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-video-migration-token',(
        select decrypted_secret
        from vault.decrypted_secrets
        where name='legacy_r2_migration_token'
        order by created_at desc
        limit 1
      )
    ),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 120000
  ) into v_request_id;

  return v_request_id;
end
$$;

revoke all on function public.run_video_r2_drive_migration_tick() from public, anon, authenticated;
grant execute on function public.run_video_r2_drive_migration_tick() to service_role;
