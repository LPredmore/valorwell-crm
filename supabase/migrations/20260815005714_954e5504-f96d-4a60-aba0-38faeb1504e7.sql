-- ============================================================
-- AI OPERATIONS PLATFORM — STAGE 1 FOUNDATION (additive only)
-- ============================================================

create type public.ai_ops_module_enum as enum (
  'system_integrity','client_journey','communications','youtube','executive_brief'
);
create type public.ai_ops_run_status_enum as enum ('pending','running','partial','success','failed');
create type public.ai_ops_severity_enum as enum ('critical','high','medium','low');
create type public.ai_ops_finding_status_enum as enum ('open','snoozed','resolved','dismissed');
create type public.ai_ops_work_status_enum as enum ('queued','processing','retry_wait','completed','failed');

-- ------------------------------------------------------------
-- Shared touch trigger
-- ------------------------------------------------------------
create or replace function private.ai_ops_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- Authorization context (admin-only)
-- ------------------------------------------------------------
create or replace function private.ai_ops_context(p_require_admin boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_context jsonb;
  v_tenant uuid;
  v_role text;
begin
  if private.valorwell_is_service_role() then
    return jsonb_build_object('actor_id', null, 'tenant_id', null, 'crm_role', 'service_role');
  end if;

  if v_actor is null then
    raise exception 'Authenticated CRM access is required.' using errcode = '42501';
  end if;

  v_context := public.get_crm_operating_context();
  v_tenant := nullif(v_context ->> 'current_tenant_id', '')::uuid;
  v_role := coalesce(v_context ->> 'crm_role', 'crm_none');

  if v_tenant is null or v_role = 'crm_none' then
    raise exception 'No operating tenant is selected for this CRM session.' using errcode = '42501';
  end if;

  if p_require_admin and v_role <> 'crm_admin' then
    raise exception 'AI Operations is restricted to CRM administrators.' using errcode = '42501';
  end if;

  return jsonb_build_object('actor_id', v_actor, 'tenant_id', v_tenant, 'crm_role', v_role);
end;
$$;

create or replace function private.ai_ops_is_admin_of(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.valorwell_is_service_role()
    or (
      auth.uid() is not null
      and exists (
        select 1 from public.crm_user_capabilities c
        where c.profile_id = auth.uid()
          and c.tenant_id = p_tenant_id
          and c.crm_role = 'crm_admin'
      )
    );
$$;

-- ============================================================
-- PUBLIC (admin-readable) TABLES
-- ============================================================

create table public.ai_operations_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  business_date date not null,
  timezone text not null default 'America/Chicago',
  started_at timestamptz,
  source_cutoff_at timestamptz,
  completed_at timestamptz,
  overall_status public.ai_ops_run_status_enum not null default 'pending',
  publication_status text not null default 'unpublished',
  coverage_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_operations_runs_unique_business_date unique (tenant_id, business_date)
);
grant select on public.ai_operations_runs to authenticated;
grant all on public.ai_operations_runs to service_role;
alter table public.ai_operations_runs enable row level security;
create policy "AI Ops runs are admin readable"
  on public.ai_operations_runs for select to authenticated
  using (private.ai_ops_is_admin_of(tenant_id));
create policy "AI Ops runs are worker managed"
  on public.ai_operations_runs for all to service_role
  using (true) with check (true);
create trigger ai_operations_runs_touch before update on public.ai_operations_runs
  for each row execute function private.ai_ops_touch_updated_at();

create table public.ai_operations_module_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_operations_runs(id) on delete cascade,
  tenant_id uuid not null,
  module public.ai_ops_module_enum not null,
  status public.ai_ops_run_status_enum not null default 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  source_cutoff_at timestamptz,
  source_items_total integer not null default 0,
  items_reused integer not null default 0,
  items_analyzed integer not null default 0,
  items_failed integer not null default 0,
  provider text,
  model text,
  prompt_version text,
  coverage jsonb not null default '{}'::jsonb,
  error_code text,
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_operations_module_runs_unique unique (run_id, module)
);
grant select on public.ai_operations_module_runs to authenticated;
grant all on public.ai_operations_module_runs to service_role;
alter table public.ai_operations_module_runs enable row level security;
create policy "AI Ops module runs are admin readable"
  on public.ai_operations_module_runs for select to authenticated
  using (private.ai_ops_is_admin_of(tenant_id));
create policy "AI Ops module runs are worker managed"
  on public.ai_operations_module_runs for all to service_role
  using (true) with check (true);
create trigger ai_operations_module_runs_touch before update on public.ai_operations_module_runs
  for each row execute function private.ai_ops_touch_updated_at();

create table public.ai_operations_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  module public.ai_ops_module_enum not null,
  fingerprint text not null,
  entity_type text,
  entity_id text,
  title text not null,
  summary text,
  severity public.ai_ops_severity_enum not null default 'medium',
  confidence numeric(4,3),
  recommended_action text,
  status public.ai_ops_finding_status_enum not null default 'open',
  first_detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  snoozed_until timestamptz,
  resolved_at timestamptz,
  dismissed_at timestamptz,
  reopen_count integer not null default 0,
  related_existing_exception_id uuid,
  last_run_id uuid references public.ai_operations_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_operations_findings_fingerprint_unique unique (tenant_id, module, fingerprint)
);
grant select on public.ai_operations_findings to authenticated;
grant all on public.ai_operations_findings to service_role;
alter table public.ai_operations_findings enable row level security;
create policy "AI Ops findings are admin readable"
  on public.ai_operations_findings for select to authenticated
  using (private.ai_ops_is_admin_of(tenant_id));
create policy "AI Ops findings are worker managed"
  on public.ai_operations_findings for all to service_role
  using (true) with check (true);
create trigger ai_operations_findings_touch before update on public.ai_operations_findings
  for each row execute function private.ai_ops_touch_updated_at();

create index ai_operations_findings_tenant_status_idx
  on public.ai_operations_findings (tenant_id, status, severity, last_seen_at desc);
create index ai_operations_findings_module_idx
  on public.ai_operations_findings (tenant_id, module, status, last_seen_at desc);
create index ai_operations_findings_entity_idx
  on public.ai_operations_findings (tenant_id, entity_type, entity_id);
create index ai_operations_findings_exception_idx
  on public.ai_operations_findings (related_existing_exception_id)
  where related_existing_exception_id is not null;

create table public.ai_operations_finding_events (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.ai_operations_findings(id) on delete cascade,
  tenant_id uuid not null,
  event_type text not null,
  actor_profile_id uuid,
  actor_kind text not null default 'system',
  reason text,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
grant select on public.ai_operations_finding_events to authenticated;
grant all on public.ai_operations_finding_events to service_role;
alter table public.ai_operations_finding_events enable row level security;
create policy "AI Ops finding events are admin readable"
  on public.ai_operations_finding_events for select to authenticated
  using (private.ai_ops_is_admin_of(tenant_id));
create policy "AI Ops finding events are worker managed"
  on public.ai_operations_finding_events for all to service_role
  using (true) with check (true);
create index ai_operations_finding_events_finding_idx
  on public.ai_operations_finding_events (finding_id, created_at desc);

create table public.ai_operations_briefs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_operations_runs(id) on delete cascade,
  tenant_id uuid not null,
  business_date date not null,
  is_partial boolean not null default false,
  status text not null default 'draft',
  sections jsonb not null default '[]'::jsonb,
  coverage_manifest jsonb not null default '{}'::jsonb,
  everything_normal jsonb not null default '[]'::jsonb,
  generated_at timestamptz,
  published_at timestamptz,
  email_status text not null default 'not_sent',
  email_sent_at timestamptz,
  prompt_version text,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_operations_briefs_unique unique (tenant_id, business_date)
);
grant select on public.ai_operations_briefs to authenticated;
grant all on public.ai_operations_briefs to service_role;
alter table public.ai_operations_briefs enable row level security;
create policy "AI Ops briefs are admin readable"
  on public.ai_operations_briefs for select to authenticated
  using (private.ai_ops_is_admin_of(tenant_id));
create policy "AI Ops briefs are worker managed"
  on public.ai_operations_briefs for all to service_role
  using (true) with check (true);
create trigger ai_operations_briefs_touch before update on public.ai_operations_briefs
  for each row execute function private.ai_ops_touch_updated_at();

create table public.ai_operations_youtube_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  channel_id text not null,
  video_id text not null,
  video_title text,
  initiative text,
  comment_id text not null,
  parent_comment_id text,
  author_display_name text,
  comment_text text,
  published_at timestamptz,
  comment_updated_at timestamptz,
  content_hash text not null,
  classification text,
  priority public.ai_ops_severity_enum,
  suggested_reply text,
  review_state text not null default 'new',
  reviewed_by_profile_id uuid,
  reviewed_at timestamptz,
  analyzed_content_hash text,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_operations_youtube_comments_unique unique (tenant_id, comment_id)
);
grant select on public.ai_operations_youtube_comments to authenticated;
grant all on public.ai_operations_youtube_comments to service_role;
alter table public.ai_operations_youtube_comments enable row level security;
create policy "AI Ops YouTube comments are admin readable"
  on public.ai_operations_youtube_comments for select to authenticated
  using (private.ai_ops_is_admin_of(tenant_id));
create policy "AI Ops YouTube comments are worker managed"
  on public.ai_operations_youtube_comments for all to service_role
  using (true) with check (true);
create index ai_operations_youtube_comments_review_idx
  on public.ai_operations_youtube_comments (tenant_id, review_state, published_at desc);
create trigger ai_operations_youtube_comments_touch before update on public.ai_operations_youtube_comments
  for each row execute function private.ai_ops_touch_updated_at();

create table public.ai_operations_settings (
  tenant_id uuid primary key,
  timezone text not null default 'America/Chicago',
  brief_recipients text[] not null default '{}'::text[],
  youtube_channel_id text,
  bty_playlist_id text,
  vertex_project_id text,
  vertex_location text not null default 'us-central1',
  model text not null default 'gemini-2.5-pro',
  max_model_concurrency integer not null default 4,
  client_journey_batch_size integer not null default 6,
  snapshot_retention_days integer not null default 14,
  reanalysis_max_age_hours integer not null default 72,
  updated_by_profile_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.ai_operations_settings to authenticated;
grant all on public.ai_operations_settings to service_role;
alter table public.ai_operations_settings enable row level security;
create policy "AI Ops settings are admin readable"
  on public.ai_operations_settings for select to authenticated
  using (private.ai_ops_is_admin_of(tenant_id));
create policy "AI Ops settings are worker managed"
  on public.ai_operations_settings for all to service_role
  using (true) with check (true);
create trigger ai_operations_settings_touch before update on public.ai_operations_settings
  for each row execute function private.ai_ops_touch_updated_at();

-- ============================================================
-- PRIVATE (server-only) TABLES — no authenticated grants
-- ============================================================

create table private.ai_ops_flags (
  tenant_id uuid not null,
  flag_name text not null,
  enabled boolean not null default false,
  updated_by_profile_id uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, flag_name)
);
alter table private.ai_ops_flags enable row level security;
grant all on private.ai_ops_flags to service_role;

create table private.ai_ops_business_calendar (
  tenant_id uuid not null,
  calendar_date date not null,
  is_closed boolean not null default true,
  label text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, calendar_date)
);
alter table private.ai_ops_business_calendar enable row level security;
grant all on private.ai_ops_business_calendar to service_role;

create table private.ai_ops_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  entity_type text not null,
  entity_id text not null,
  snapshot_type text not null,
  snapshot_hash text not null,
  evaluation_hash text not null,
  cutoff_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
alter table private.ai_ops_snapshots enable row level security;
grant all on private.ai_ops_snapshots to service_role;
create index ai_ops_snapshots_entity_idx
  on private.ai_ops_snapshots (tenant_id, entity_type, entity_id, created_at desc);
create index ai_ops_snapshots_expiry_idx on private.ai_ops_snapshots (expires_at);

create table private.ai_ops_work_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  run_id uuid references public.ai_operations_runs(id) on delete cascade,
  module public.ai_ops_module_enum not null,
  work_key text not null,
  work_type text not null,
  priority integer not null default 100,
  input_snapshot_ids uuid[] not null default '{}'::uuid[],
  input_payload jsonb,
  requested_model text not null default 'gemini-2.5-pro',
  prompt_version text not null,
  schema_version text not null,
  status public.ai_ops_work_status_enum not null default 'queued',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_summary text,
  structured_result jsonb,
  token_usage jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_ops_work_items_work_key_unique unique (tenant_id, work_key)
);
alter table private.ai_ops_work_items enable row level security;
grant all on private.ai_ops_work_items to service_role;
create index ai_ops_work_items_claim_idx
  on private.ai_ops_work_items (status, next_attempt_at, priority);
create index ai_ops_work_items_run_idx on private.ai_ops_work_items (run_id, module, status);
create trigger ai_ops_work_items_touch before update on private.ai_ops_work_items
  for each row execute function private.ai_ops_touch_updated_at();

create table private.ai_ops_source_cursors (
  tenant_id uuid not null,
  source_key text not null,
  cursor_timestamp timestamptz,
  cursor_token text,
  last_source_id text,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, source_key)
);
alter table private.ai_ops_source_cursors enable row level security;
grant all on private.ai_ops_source_cursors to service_role;

create table private.ai_ops_finding_evidence (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.ai_operations_findings(id) on delete cascade,
  tenant_id uuid not null,
  source_type text not null,
  source_record_id text,
  source_timestamp timestamptz,
  excerpt text,
  evidence_hash text not null,
  created_at timestamptz not null default now()
);
alter table private.ai_ops_finding_evidence enable row level security;
grant all on private.ai_ops_finding_evidence to service_role;
create index ai_ops_finding_evidence_finding_idx
  on private.ai_ops_finding_evidence (finding_id, created_at desc);

create table private.ai_ops_operation_registry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operation_key text not null,
  display_name text not null,
  domain text not null,
  source_type text not null default 'pg_cron',
  expected_cadence text,
  expected_cadence_seconds integer,
  criticality public.ai_ops_severity_enum not null default 'medium',
  evidence_source jsonb not null default '{}'::jsonb,
  expected_success_rule jsonb not null default '{}'::jsonb,
  allowed_delay_seconds integer not null default 900,
  downstream_invariant jsonb,
  enabled boolean not null default true,
  auto_discovered boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_ops_operation_registry_unique unique (tenant_id, operation_key)
);
alter table private.ai_ops_operation_registry enable row level security;
grant all on private.ai_ops_operation_registry to service_role;
create trigger ai_ops_operation_registry_touch before update on private.ai_ops_operation_registry
  for each row execute function private.ai_ops_touch_updated_at();

-- ============================================================
-- BUSINESS CALENDAR HELPERS (America/Chicago, DST aware)
-- ============================================================

create or replace function private.ai_ops_business_date(p_at timestamptz default now(), p_timezone text default 'America/Chicago')
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone coalesce(p_timezone, 'America/Chicago'))::date;
$$;

create or replace function private.ai_ops_is_business_day(p_tenant_id uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select extract(isodow from p_date) < 6
     and not exists (
       select 1 from private.ai_ops_business_calendar c
       where c.tenant_id = p_tenant_id and c.calendar_date = p_date and c.is_closed
     );
$$;

create or replace function private.ai_ops_add_business_days(p_tenant_id uuid, p_date date, p_days integer)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  v_date date := p_date;
  v_remaining integer := greatest(coalesce(p_days, 0), 0);
  v_guard integer := 0;
begin
  while v_remaining > 0 and v_guard < 400 loop
    v_date := v_date + 1;
    v_guard := v_guard + 1;
    if private.ai_ops_is_business_day(p_tenant_id, v_date) then
      v_remaining := v_remaining - 1;
    end if;
  end loop;
  return v_date;
end;
$$;

-- One-business-day SLA deadline: end of the next business day, Central.
create or replace function private.ai_ops_business_day_deadline(
  p_tenant_id uuid,
  p_received_at timestamptz,
  p_business_days integer default 1,
  p_timezone text default 'America/Chicago'
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text := coalesce(p_timezone, 'America/Chicago');
  v_start date := private.ai_ops_business_date(p_received_at, v_tz);
  v_deadline date;
begin
  if not private.ai_ops_is_business_day(p_tenant_id, v_start) then
    v_start := private.ai_ops_add_business_days(p_tenant_id, v_start, 1);
    v_deadline := private.ai_ops_add_business_days(p_tenant_id, v_start, greatest(coalesce(p_business_days, 1), 1) - 1);
  else
    v_deadline := private.ai_ops_add_business_days(p_tenant_id, v_start, greatest(coalesce(p_business_days, 1), 1));
  end if;
  return ((v_deadline + 1)::timestamp - interval '1 second') at time zone v_tz;
end;
$$;

-- ============================================================
-- FEATURE FLAGS
-- ============================================================

create or replace function private.ai_ops_flag_names()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'ai_operations_enabled',
    'system_integrity_enabled',
    'client_journey_ai_enabled',
    'communications_ai_enabled',
    'youtube_ai_enabled',
    'executive_brief_enabled',
    'executive_brief_email_enabled',
    'shadow_mode'
  ]::text[];
$$;

create or replace function private.ai_ops_flag(p_tenant_id uuid, p_flag_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select f.enabled from private.ai_ops_flags f
    where f.tenant_id = p_tenant_id and f.flag_name = p_flag_name
  ), false);
$$;

create or replace function public.ai_operations_list_flags()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.ai_ops_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'flagName', name,
      'enabled', coalesce(f.enabled, false),
      'updatedAt', f.updated_at
    ) order by name)
    from unnest(private.ai_ops_flag_names()) as name
    left join private.ai_ops_flags f
      on f.tenant_id = v_tenant and f.flag_name = name
  ), '[]'::jsonb);
end;
$$;

create or replace function public.ai_operations_set_flag(p_flag_name text, p_enabled boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.ai_ops_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_actor uuid := (v_context->>'actor_id')::uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_previous boolean;
begin
  if p_flag_name <> all (private.ai_ops_flag_names()) then
    raise exception 'Unknown AI Operations flag: %', p_flag_name using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'A reason is required to change an AI Operations flag.' using errcode = '22023';
  end if;

  select enabled into v_previous from private.ai_ops_flags
  where tenant_id = v_tenant and flag_name = p_flag_name;

  if p_enabled
     and p_flag_name <> 'ai_operations_enabled'
     and not private.ai_ops_flag(v_tenant, 'ai_operations_enabled') then
    raise exception 'AI Operations must be enabled before enabling %', p_flag_name using errcode = '22023';
  end if;

  insert into private.ai_ops_flags (tenant_id, flag_name, enabled, updated_by_profile_id, updated_at)
  values (v_tenant, p_flag_name, p_enabled, v_actor, now())
  on conflict (tenant_id, flag_name)
  do update set enabled = excluded.enabled,
                updated_by_profile_id = excluded.updated_by_profile_id,
                updated_at = now();

  insert into public.crm_activity_events (tenant_id, client_id, event_type, created_by_profile_id, metadata)
  values (v_tenant, null, 'ai_operations_flag_changed', v_actor, jsonb_build_object(
    'flag_name', p_flag_name,
    'previous_value', v_previous,
    'new_value', p_enabled,
    'reason', v_reason
  ));

  return jsonb_build_object('flagName', p_flag_name, 'enabled', p_enabled, 'previousValue', v_previous);
end;
$$;

-- ============================================================
-- ADMIN READ MODELS
-- ============================================================

create or replace function public.ai_operations_overview(p_business_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.ai_ops_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_run public.ai_operations_runs;
  v_date date := p_business_date;
begin
  if v_date is null then
    select r.* into v_run from public.ai_operations_runs r
    where r.tenant_id = v_tenant order by r.business_date desc limit 1;
  else
    select r.* into v_run from public.ai_operations_runs r
    where r.tenant_id = v_tenant and r.business_date = v_date;
  end if;

  return jsonb_build_object(
    'run', case when v_run.id is null then null else jsonb_build_object(
      'id', v_run.id,
      'businessDate', v_run.business_date,
      'timezone', v_run.timezone,
      'startedAt', v_run.started_at,
      'sourceCutoffAt', v_run.source_cutoff_at,
      'completedAt', v_run.completed_at,
      'overallStatus', v_run.overall_status,
      'publicationStatus', v_run.publication_status,
      'coverageSummary', v_run.coverage_summary
    ) end,
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'module', m.module,
        'status', m.status,
        'startedAt', m.started_at,
        'completedAt', m.completed_at,
        'sourceItemsTotal', m.source_items_total,
        'itemsAnalyzed', m.items_analyzed,
        'itemsReused', m.items_reused,
        'itemsFailed', m.items_failed,
        'coverage', m.coverage,
        'model', m.model,
        'errorCode', m.error_code,
        'errorSummary', m.error_summary
      ) order by m.module)
      from public.ai_operations_module_runs m where m.run_id = v_run.id
    ), '[]'::jsonb),
    'findingCounts', coalesce((
      select jsonb_object_agg(key, value) from (
        select f.severity::text as key, count(*)::int as value
        from public.ai_operations_findings f
        where f.tenant_id = v_tenant and f.status = 'open'
        group by f.severity
      ) s
    ), '{}'::jsonb),
    'openFindingsByModule', coalesce((
      select jsonb_object_agg(key, value) from (
        select f.module::text as key, count(*)::int as value
        from public.ai_operations_findings f
        where f.tenant_id = v_tenant and f.status = 'open'
        group by f.module
      ) s
    ), '{}'::jsonb),
    'brief', (
      select jsonb_build_object(
        'id', b.id,
        'businessDate', b.business_date,
        'isPartial', b.is_partial,
        'status', b.status,
        'generatedAt', b.generated_at,
        'publishedAt', b.published_at,
        'emailStatus', b.email_status
      )
      from public.ai_operations_briefs b
      where b.tenant_id = v_tenant and (v_run.id is null or b.run_id = v_run.id)
      order by b.business_date desc limit 1
    )
  );
end;
$$;

create or replace function public.ai_operations_list_findings(
  p_module text default null,
  p_status text default 'open',
  p_severity text default null,
  p_business_date date default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.ai_ops_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
begin
  select count(*)::int into v_total
  from public.ai_operations_findings f
  left join public.ai_operations_runs r on r.id = f.last_run_id
  where f.tenant_id = v_tenant
    and (p_module is null or f.module::text = p_module)
    and (p_status is null or f.status::text = p_status)
    and (p_severity is null or f.severity::text = p_severity)
    and (p_business_date is null or r.business_date = p_business_date);

  return jsonb_build_object(
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb) from (
        select
          f.id,
          f.module::text as module,
          f.fingerprint,
          f.entity_type as "entityType",
          f.entity_id as "entityId",
          f.title,
          f.summary,
          f.severity::text as severity,
          f.confidence,
          f.recommended_action as "recommendedAction",
          f.status::text as status,
          f.first_detected_at as "firstDetectedAt",
          f.last_seen_at as "lastSeenAt",
          f.snoozed_until as "snoozedUntil",
          f.reopen_count as "reopenCount",
          f.related_existing_exception_id as "relatedExistingExceptionId",
          r.business_date as "businessDate"
        from public.ai_operations_findings f
        left join public.ai_operations_runs r on r.id = f.last_run_id
        where f.tenant_id = v_tenant
          and (p_module is null or f.module::text = p_module)
          and (p_status is null or f.status::text = p_status)
          and (p_severity is null or f.severity::text = p_severity)
          and (p_business_date is null or r.business_date = p_business_date)
        order by
          case f.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
          f.last_seen_at desc
        limit v_limit offset v_offset
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.ai_operations_list_runs(p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.ai_ops_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 120);
begin
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb) from (
      select
        r.id,
        r.business_date as "businessDate",
        r.overall_status::text as "overallStatus",
        r.publication_status as "publicationStatus",
        r.started_at as "startedAt",
        r.completed_at as "completedAt",
        r.source_cutoff_at as "sourceCutoffAt",
        r.coverage_summary as "coverageSummary",
        (
          select coalesce(jsonb_agg(jsonb_build_object(
            'module', m.module, 'status', m.status, 'coverage', m.coverage
          ) order by m.module), '[]'::jsonb)
          from public.ai_operations_module_runs m where m.run_id = r.id
        ) as modules
      from public.ai_operations_runs r
      where r.tenant_id = v_tenant
      order by r.business_date desc
      limit v_limit
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.ai_operations_get_brief(p_business_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.ai_ops_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_brief public.ai_operations_briefs;
begin
  if p_business_date is null then
    select b.* into v_brief from public.ai_operations_briefs b
    where b.tenant_id = v_tenant order by b.business_date desc limit 1;
  else
    select b.* into v_brief from public.ai_operations_briefs b
    where b.tenant_id = v_tenant and b.business_date = p_business_date;
  end if;

  if v_brief.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_brief.id,
    'businessDate', v_brief.business_date,
    'isPartial', v_brief.is_partial,
    'status', v_brief.status,
    'sections', v_brief.sections,
    'coverageManifest', v_brief.coverage_manifest,
    'everythingNormal', v_brief.everything_normal,
    'generatedAt', v_brief.generated_at,
    'publishedAt', v_brief.published_at,
    'emailStatus', v_brief.email_status,
    'emailSentAt', v_brief.email_sent_at,
    'model', v_brief.model
  );
end;
$$;

create or replace function public.ai_operations_list_youtube_comments(
  p_review_state text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.ai_ops_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
begin
  select count(*)::int into v_total from public.ai_operations_youtube_comments c
  where c.tenant_id = v_tenant and (p_review_state is null or c.review_state = p_review_state);

  return jsonb_build_object(
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb) from (
        select
          c.id,
          c.video_id as "videoId",
          c.video_title as "videoTitle",
          c.initiative,
          c.comment_id as "commentId",
          c.parent_comment_id as "parentCommentId",
          c.author_display_name as "authorDisplayName",
          c.comment_text as "commentText",
          c.published_at as "publishedAt",
          c.classification,
          c.priority::text as priority,
          c.suggested_reply as "suggestedReply",
          c.review_state as "reviewState"
        from public.ai_operations_youtube_comments c
        where c.tenant_id = v_tenant
          and (p_review_state is null or c.review_state = p_review_state)
        order by c.published_at desc nulls last
        limit v_limit offset v_offset
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- ============================================================
-- FINDING LIFECYCLE ACTIONS (admin, reason required, audited)
-- ============================================================

create or replace function private.ai_ops_transition_finding(
  p_finding_id uuid,
  p_action text,
  p_reason text,
  p_snooze_until timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.ai_ops_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_actor uuid := (v_context->>'actor_id')::uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_finding public.ai_operations_findings;
  v_new_status public.ai_ops_finding_status_enum;
begin
  if v_reason is null then
    raise exception 'A reason is required to change an AI Operations finding.' using errcode = '22023';
  end if;

  select * into v_finding from public.ai_operations_findings
  where id = p_finding_id and tenant_id = v_tenant
  for update;

  if v_finding.id is null then
    raise exception 'Finding not found.' using errcode = 'P0002';
  end if;

  v_new_status := case p_action
    when 'resolve' then 'resolved'
    when 'dismiss' then 'dismissed'
    when 'snooze' then 'snoozed'
    when 'reopen' then 'open'
    else null
  end::public.ai_ops_finding_status_enum;

  if v_new_status is null then
    raise exception 'Unknown finding action: %', p_action using errcode = '22023';
  end if;

  if p_action = 'snooze' and (p_snooze_until is null or p_snooze_until <= now()) then
    raise exception 'A future snooze date is required.' using errcode = '22023';
  end if;

  update public.ai_operations_findings
     set status = v_new_status,
         resolved_at = case when p_action = 'resolve' then now() else null end,
         dismissed_at = case when p_action = 'dismiss' then now() else null end,
         snoozed_until = case when p_action = 'snooze' then p_snooze_until else null end,
         reopen_count = reopen_count + case when p_action = 'reopen' then 1 else 0 end
   where id = p_finding_id;

  insert into public.ai_operations_finding_events (
    finding_id, tenant_id, event_type, actor_profile_id, actor_kind, reason, previous_value, new_value
  ) values (
    p_finding_id, v_tenant, p_action, v_actor, 'admin', v_reason,
    jsonb_build_object('status', v_finding.status, 'snoozedUntil', v_finding.snoozed_until),
    jsonb_build_object('status', v_new_status, 'snoozedUntil', case when p_action = 'snooze' then p_snooze_until else null end)
  );

  return jsonb_build_object('findingId', p_finding_id, 'status', v_new_status);
end;
$$;

create or replace function public.ai_operations_resolve_finding(p_finding_id uuid, p_reason text)
returns jsonb language sql security definer set search_path = '' as $$
  select private.ai_ops_transition_finding(p_finding_id, 'resolve', p_reason, null);
$$;

create or replace function public.ai_operations_dismiss_finding(p_finding_id uuid, p_reason text)
returns jsonb language sql security definer set search_path = '' as $$
  select private.ai_ops_transition_finding(p_finding_id, 'dismiss', p_reason, null);
$$;

create or replace function public.ai_operations_snooze_finding(p_finding_id uuid, p_reason text, p_snooze_until timestamptz)
returns jsonb language sql security definer set search_path = '' as $$
  select private.ai_ops_transition_finding(p_finding_id, 'snooze', p_reason, p_snooze_until);
$$;

create or replace function public.ai_operations_reopen_finding(p_finding_id uuid, p_reason text)
returns jsonb language sql security definer set search_path = '' as $$
  select private.ai_ops_transition_finding(p_finding_id, 'reopen', p_reason, null);
$$;

-- ============================================================
-- EXECUTION GRANTS — admin RPCs only, PUBLIC revoked
-- ============================================================

revoke all on function public.ai_operations_list_flags() from public;
revoke all on function public.ai_operations_set_flag(text, boolean, text) from public;
revoke all on function public.ai_operations_overview(date) from public;
revoke all on function public.ai_operations_list_findings(text, text, text, date, integer, integer) from public;
revoke all on function public.ai_operations_list_runs(integer) from public;
revoke all on function public.ai_operations_get_brief(date) from public;
revoke all on function public.ai_operations_list_youtube_comments(text, integer, integer) from public;
revoke all on function public.ai_operations_resolve_finding(uuid, text) from public;
revoke all on function public.ai_operations_dismiss_finding(uuid, text) from public;
revoke all on function public.ai_operations_snooze_finding(uuid, text, timestamptz) from public;
revoke all on function public.ai_operations_reopen_finding(uuid, text) from public;

grant execute on function public.ai_operations_list_flags() to authenticated, service_role;
grant execute on function public.ai_operations_set_flag(text, boolean, text) to authenticated, service_role;
grant execute on function public.ai_operations_overview(date) to authenticated, service_role;
grant execute on function public.ai_operations_list_findings(text, text, text, date, integer, integer) to authenticated, service_role;
grant execute on function public.ai_operations_list_runs(integer) to authenticated, service_role;
grant execute on function public.ai_operations_get_brief(date) to authenticated, service_role;
grant execute on function public.ai_operations_list_youtube_comments(text, integer, integer) to authenticated, service_role;
grant execute on function public.ai_operations_resolve_finding(uuid, text) to authenticated, service_role;
grant execute on function public.ai_operations_dismiss_finding(uuid, text) to authenticated, service_role;
grant execute on function public.ai_operations_snooze_finding(uuid, text, timestamptz) to authenticated, service_role;
grant execute on function public.ai_operations_reopen_finding(uuid, text) to authenticated, service_role;
