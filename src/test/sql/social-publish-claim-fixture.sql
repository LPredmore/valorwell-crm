-- Minimal stand-in for the production tables the publish-claim RPCs touch. Column names,
-- status checks and the active-job unique index match production.
do $$ begin
  create role anon; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role; exception when duplicate_object then null; end $$;

create table public.ai_operations_social_publications (
  id uuid primary key,
  status text not null default 'upload_queued',
  next_attempt_at timestamptz
);

create table public.ai_operations_video_jobs (
  id bigserial primary key,
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  project_id uuid not null default '00000000-0000-0000-0000-0000000000aa',
  clip_id uuid,
  job_type text not null check (job_type in ('transcribe', 'render_clip', 'publish_youtube', 'refresh_source_metadata')),
  status text not null check (status in ('queued', 'claimed', 'running', 'complete', 'error', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  claimed_by text,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  social_publication_id uuid references public.ai_operations_social_publications(id)
);

create unique index ai_operations_video_jobs_active_publish_uidx
  on public.ai_operations_video_jobs (social_publication_id)
  where job_type = 'publish_youtube' and status in ('queued', 'claimed', 'running');
