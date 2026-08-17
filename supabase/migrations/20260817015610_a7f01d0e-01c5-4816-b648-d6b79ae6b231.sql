-- ============================================================
-- Part 1: shared Gemini automation rate limiter (8 starts / rolling 60s)
-- ============================================================
create table if not exists private.gemini_rate_slots (
  id bigserial primary key,
  scope text not null default 'automation',
  label text,
  claimed_at timestamptz not null default now()
);
create index if not exists gemini_rate_slots_scope_claimed_idx
  on private.gemini_rate_slots (scope, claimed_at desc);

create or replace function public.gemini_automation_claim_slot(
  p_scope text default 'automation',
  p_max integer default 8,
  p_window_seconds integer default 60,
  p_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_scope text := coalesce(nullif(trim(p_scope), ''), 'automation');
  v_max integer := greatest(coalesce(p_max, 8), 1);
  v_window integer := greatest(coalesce(p_window_seconds, 60), 1);
  v_used integer;
  v_oldest timestamptz;
  v_retry_ms integer := 0;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'Gemini rate limiting requires the service role.' using errcode = '42501';
  end if;

  -- Serialize claims for this scope so concurrent workers cannot overshoot the limit.
  perform pg_advisory_xact_lock(hashtext('gemini_rate_slot:' || v_scope));

  delete from private.gemini_rate_slots
   where claimed_at < now() - interval '10 minutes';

  select count(*), min(claimed_at)
    into v_used, v_oldest
    from private.gemini_rate_slots
   where scope = v_scope
     and claimed_at > now() - make_interval(secs => v_window);

  if v_used < v_max then
    insert into private.gemini_rate_slots (scope, label) values (v_scope, left(coalesce(p_label, ''), 200));
    return jsonb_build_object('granted', true, 'scope', v_scope, 'used', v_used + 1, 'max', v_max, 'retryAfterMs', 0);
  end if;

  v_retry_ms := greatest(
    250,
    ceil(extract(epoch from ((v_oldest + make_interval(secs => v_window)) - now())) * 1000)::int
  );
  return jsonb_build_object('granted', false, 'scope', v_scope, 'used', v_used, 'max', v_max, 'retryAfterMs', v_retry_ms);
end;
$$;

revoke all on function public.gemini_automation_claim_slot(text, integer, integer, text) from public;
grant execute on function public.gemini_automation_claim_slot(text, integer, integer, text) to service_role;

-- Requeue a claimed AI Operations work item without consuming a retry attempt.
create or replace function public.ai_ops_release_work_item(
  p_work_item_id uuid,
  p_delay_seconds integer default 30,
  p_reason text default 'rate_slot_wait'
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_delay integer := greatest(coalesce(p_delay_seconds, 30), 1);
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  update private.ai_ops_work_items
     set status = 'retry_wait',
         attempt_count = greatest(attempt_count - 1, 0),
         next_attempt_at = now() + make_interval(secs => v_delay),
         error_code = null,
         error_summary = left(coalesce(p_reason, 'deferred'), 2000),
         completed_at = null,
         updated_at = now()
   where id = p_work_item_id;

  if not found then
    raise exception 'Unknown AI Operations work item.' using errcode = 'P0002';
  end if;

  return jsonb_build_object('workItemId', p_work_item_id, 'status', 'retry_wait', 'deferredSeconds', v_delay);
end;
$$;

revoke all on function public.ai_ops_release_work_item(uuid, integer, text) from public;
grant execute on function public.ai_ops_release_work_item(uuid, integer, text) to service_role;

-- ============================================================
-- Part 2: veteran humor viral Shorts discovery storage
-- ============================================================
create table if not exists public.ai_operations_viral_short_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  business_date date not null,
  video_id text not null,
  video_url text not null,
  title text not null,
  description text,
  channel_id text,
  channel_name text,
  published_at timestamptz,
  view_count bigint,
  like_count bigint,
  comment_count bigint,
  duration_seconds integer,
  age_days numeric,
  views_per_day numeric,
  youtube_license text,
  source_query text,
  viral_tier text,
  selection_rank integer,
  humor_rationale text,
  status text not null default 'new',
  discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_operations_viral_short_candidates_tenant_video_key unique (tenant_id, video_id),
  constraint ai_operations_viral_short_candidates_status_check check (status in ('new', 'used', 'dismissed')),
  constraint ai_operations_viral_short_candidates_rank_check check (selection_rank between 1 and 2),
  constraint ai_operations_viral_short_candidates_duration_check check (duration_seconds is null or duration_seconds <= 180)
);

grant select on public.ai_operations_viral_short_candidates to authenticated;
grant all on public.ai_operations_viral_short_candidates to service_role;
alter table public.ai_operations_viral_short_candidates enable row level security;

create policy "AI Ops viral shorts are admin readable"
  on public.ai_operations_viral_short_candidates for select to authenticated
  using (private.ai_ops_is_admin_of(tenant_id));
create policy "AI Ops viral shorts are worker managed"
  on public.ai_operations_viral_short_candidates for all to service_role
  using (true) with check (true);

create table if not exists public.ai_operations_viral_short_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  business_date date not null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  search_queries jsonb not null default '[]'::jsonb,
  youtube_searches integer not null default 0,
  youtube_metadata_requests integer not null default 0,
  raw_candidate_count integer not null default 0,
  filtered_candidate_count integer not null default 0,
  gemini_candidates_evaluated integer not null default 0,
  gemini_calls integer not null default 0,
  selected_video_ids jsonb not null default '[]'::jsonb,
  stored_count integer not null default 0,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_operations_viral_short_runs_tenant_date_key unique (tenant_id, business_date),
  constraint ai_operations_viral_short_runs_status_check check (status in ('running', 'success', 'failed'))
);

grant select on public.ai_operations_viral_short_runs to authenticated;
grant all on public.ai_operations_viral_short_runs to service_role;
alter table public.ai_operations_viral_short_runs enable row level security;

create policy "AI Ops viral short runs are admin readable"
  on public.ai_operations_viral_short_runs for select to authenticated
  using (private.ai_ops_is_admin_of(tenant_id));
create policy "AI Ops viral short runs are worker managed"
  on public.ai_operations_viral_short_runs for all to service_role
  using (true) with check (true);

-- ============================================================
-- Scheduling: 01:30 America/Chicago daily (DST safe)
-- ============================================================
create or replace function private.ai_ops_invoke(p_function text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request_id bigint;
  v_secret text;
begin
  if p_function not in ('ai-operations-dispatcher', 'ai-operations-model-worker', 'ai-operations-youtube-sync', 'ai-operations-viral-shorts') then
    raise exception 'Unsupported AI Operations function: %', p_function;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if v_secret is null then
    raise exception 'cron_secret is not configured.';
  end if;

  select net.http_post(
    url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/' || p_function,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Secret', v_secret),
    body := coalesce(p_body, '{}'::jsonb),
    timeout_milliseconds := 180000
  ) into v_request_id;

  return v_request_id;
end;
$$;

create or replace function private.run_ai_ops_viral_shorts()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_hhmm text := to_char(now() at time zone 'America/Chicago', 'HH24:MI');
  v_request_id bigint;
begin
  -- The cron entry fires at both candidate UTC times; only the true Central 01:30 slot dispatches.
  if v_hhmm <> '01:30' then
    return jsonb_build_object('dispatched', false, 'localTime', v_hhmm);
  end if;
  v_request_id := private.ai_ops_invoke('ai-operations-viral-shorts', '{}'::jsonb);
  return jsonb_build_object('dispatched', true, 'localTime', v_hhmm, 'requestId', v_request_id);
end;
$$;

select cron.unschedule('ai-operations-viral-shorts-daily')
 where exists (select 1 from cron.job where jobname = 'ai-operations-viral-shorts-daily');

select cron.schedule(
  'ai-operations-viral-shorts-daily',
  '30 6,7 * * *',
  $$select private.run_ai_ops_viral_shorts();$$
);