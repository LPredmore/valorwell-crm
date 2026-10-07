-- lovable-cron-fallback-reviewed: Friday 12:00 Central deadline is time-based; cron only does an indexed EXISTS and calls the worker solely when a week is due.
create table public.ai_operations_video_series_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null references public.ai_operations_video_projects(id) on delete restrict,
  week_start date not null,
  timezone text not null default 'America/Chicago',
  dispatch_at timestamptz not null,
  status text not null default 'assigned',
  claim_count integer not null default 0,
  attempt_count integer not null default 0,
  lease_id uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  blocked_reasons jsonb not null default '[]'::jsonb,
  last_error_code text,
  last_error text,
  unrecoverable boolean not null default false,
  idempotency_key text not null,
  dispatch_started_at timestamptz,
  queued_at timestamptz,
  youtube_scheduled_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  last_checked_at timestamptz,
  created_by uuid,
  updated_by uuid,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_series_week_is_monday check (extract(isodow from week_start) = 1),
  constraint video_series_timezone_fixed check (timezone = 'America/Chicago'),
  constraint video_series_status_check check (status in ('assigned','blocked','dispatching','queued','partially_scheduled','youtube_scheduled','complete','failed','cancelled')),
  constraint video_series_idempotency_uk unique (idempotency_key)
);

create unique index video_series_one_project_per_week_uidx
  on public.ai_operations_video_series_schedules (tenant_id, week_start) where status <> 'cancelled';
create unique index video_series_project_once_uidx
  on public.ai_operations_video_series_schedules (tenant_id, project_id) where status <> 'cancelled';
create index video_series_due_idx
  on public.ai_operations_video_series_schedules (dispatch_at, next_attempt_at)
  where status in ('assigned','blocked','dispatching','queued','partially_scheduled','youtube_scheduled');

create table public.ai_operations_video_series_schedule_items (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.ai_operations_video_series_schedules(id) on delete cascade,
  tenant_id uuid not null,
  source_type text not null check (source_type in ('clip','project')),
  source_id uuid not null,
  content_format text not null check (content_format in ('short','long_form','full_episode')),
  part_number integer,
  sequence integer not null,
  title text,
  scheduled_for timestamptz,
  local_date date,
  local_time text,
  publication_id uuid references public.ai_operations_social_publications(id) on delete set null,
  status text not null default 'planned' check (status in ('planned','prepared','queued','youtube_scheduled','published','already_published','failed')),
  attempt_count integer not null default 0,
  last_error text,
  youtube_publish_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_series_item_source_uk unique (schedule_id, source_type, source_id)
);
create index video_series_items_schedule_idx on public.ai_operations_video_series_schedule_items (schedule_id, sequence);
create index video_series_items_publication_idx on public.ai_operations_video_series_schedule_items (publication_id);

grant all on public.ai_operations_video_series_schedules to service_role;
grant all on public.ai_operations_video_series_schedule_items to service_role;
alter table public.ai_operations_video_series_schedules enable row level security;
alter table public.ai_operations_video_series_schedule_items enable row level security;
create policy "service role video series schedules" on public.ai_operations_video_series_schedules
  for all to service_role using (true) with check (true);
create policy "service role video series items" on public.ai_operations_video_series_schedule_items
  for all to service_role using (true) with check (true);

create or replace function private.video_series_schedule_guard()
returns trigger language plpgsql set search_path to '' as $$
declare v_tenant uuid;
begin
  select p.tenant_id into v_tenant from public.ai_operations_video_projects p where p.id = new.project_id;
  if v_tenant is null or v_tenant <> new.tenant_id then
    raise exception 'Project % does not belong to tenant %', new.project_id, new.tenant_id;
  end if;
  new.timezone := 'America/Chicago';
  -- Friday before the assigned Monday at 12:00 America/Chicago (DST aware).
  new.dispatch_at := ((new.week_start - 3)::timestamp + time '12:00') at time zone 'America/Chicago';
  if tg_op = 'UPDATE' then
    if old.dispatch_started_at is not null and (
      new.project_id <> old.project_id or new.week_start <> old.week_start
      or (new.status = 'cancelled' and old.status <> 'cancelled')
    ) then
      raise exception 'Series dispatch has already started; the week can no longer be changed or removed';
    end if;
    if new.tenant_id <> old.tenant_id then raise exception 'tenant_id is immutable'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger video_series_schedule_guard
  before insert or update on public.ai_operations_video_series_schedules
  for each row execute function private.video_series_schedule_guard();

create or replace function private.video_series_item_touch()
returns trigger language plpgsql set search_path to '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger video_series_item_touch before update on public.ai_operations_video_series_schedule_items
  for each row execute function private.video_series_item_touch();

-- Atomic claim: SKIP LOCKED + lease so overlapping worker runs never process the same week.
create or replace function public.video_series_claim_due(p_lease_id uuid, p_limit integer default 3, p_lease_seconds integer default 240)
returns setof public.ai_operations_video_series_schedules
language sql security definer set search_path to 'public' as $$
  update public.ai_operations_video_series_schedules s
  set lease_id = p_lease_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      claim_count = s.claim_count + 1
  where s.id in (
    select c.id from public.ai_operations_video_series_schedules c
    where c.status in ('assigned','blocked','dispatching','queued','partially_scheduled','youtube_scheduled')
      and c.dispatch_at <= now()
      and coalesce(c.next_attempt_at, '-infinity'::timestamptz) <= now()
      and (c.lease_expires_at is null or c.lease_expires_at < now())
    order by c.dispatch_at
    for update skip locked
    limit greatest(1, least(p_limit, 10))
  )
  returning s.*;
$$;
revoke all on function public.video_series_claim_due(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.video_series_claim_due(uuid, integer, integer) to service_role;

select cron.unschedule('video-series-dispatcher-1min')
where exists (select 1 from cron.job where jobname = 'video-series-dispatcher-1min');

-- Runs a cheap due-check every minute; the worker is only called when a week is due,
-- so a Friday 12:00 deadline is honored within a minute (and caught up after any outage).
select cron.schedule(
  'video-series-dispatcher-1min',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/video-series-dispatcher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  )
  where exists (
    select 1 from public.ai_operations_video_series_schedules c
    where c.status in ('assigned','blocked','dispatching','queued','partially_scheduled','youtube_scheduled')
      and c.dispatch_at <= now()
      and coalesce(c.next_attempt_at, '-infinity'::timestamptz) <= now()
      and (c.lease_expires_at is null or c.lease_expires_at < now())
  );
  $$
);