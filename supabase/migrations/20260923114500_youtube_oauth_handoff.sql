-- One-time, server-only handoff for the YouTube publish-scope OAuth re-consent flow.
-- Public schema (private isn't exposed via PostgREST at all, so a service-role .from()
-- call can't reach it) but RLS-locked to service_role only, matching the same pattern as
-- ai_operations_social_publications etc. Rows are single-use and short-lived: the link
-- function writes a state/PKCE row, the callback function validates and deletes it, then
-- writes a result row that is read once via direct SQL to set the
-- YOUTUBE_OAUTH_REFRESH_TOKEN secret and is immediately deleted afterward.
create table if not exists public.oauth_handoff (
  id uuid primary key default gen_random_uuid(),
  purpose text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists oauth_handoff_purpose_created_idx on public.oauth_handoff (purpose, created_at);

alter table public.oauth_handoff enable row level security;

create policy "service role oauth handoff" on public.oauth_handoff
  for all to service_role using (true) with check (true);
