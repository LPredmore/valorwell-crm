create table public.relationship_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  purpose text not null,
  initiative text,
  owner_profile_id uuid references public.profiles(id) on delete set null,
  sender_name text not null,
  sender_email text not null,
  status text not null default 'draft',
  marketing_lifecycle_stage text not null default 'source_lock',
  brief jsonb not null default '{}'::jsonb,
  default_timezone text not null default 'America/Chicago',
  weekdays_only boolean not null default true,
  send_window_start time,
  send_window_end time,
  execution_enabled boolean not null default false,
  activated_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  version bigint not null default 1,
  source text not null default 'crm_manual',
  source_record_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_campaigns_tenant_id_id_key unique (tenant_id, id),
  constraint relationship_campaigns_name_check check (length(btrim(name)) > 0),
  constraint relationship_campaigns_purpose_check check (length(btrim(purpose)) > 0),
  constraint relationship_campaigns_sender_name_check check (length(btrim(sender_name)) > 0),
  constraint relationship_campaigns_sender_email_check check (
    lower(btrim(sender_email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint relationship_campaigns_status_check check (
    status = any (array['draft','active','paused','completed','archived']::text[])
  ),
  constraint relationship_campaigns_marketing_stage_check check (
    marketing_lifecycle_stage = any (array[
      'source_lock','brief','ready','live','measure','improve','pause','stop_supersede'
    ]::text[])
  ),
  constraint relationship_campaigns_brief_check check (jsonb_typeof(brief) = 'object'),
  constraint relationship_campaigns_send_window_check check (
    (send_window_start is null and send_window_end is null)
    or (send_window_start is not null and send_window_end is not null and send_window_start < send_window_end)
  ),
  constraint relationship_campaigns_execution_disabled_check check (execution_enabled = false),
  constraint relationship_campaigns_version_check check (version > 0),
  constraint relationship_campaigns_status_timestamp_check check (
    (status <> 'active' or activated_at is not null)
    and (status <> 'completed' or completed_at is not null)
    and (status <> 'archived' or archived_at is not null)
  )
);

create unique index relationship_campaigns_source_record_key_idx
  on public.relationship_campaigns (tenant_id, source, source_record_key)
  where source_record_key is not null;
create index relationship_campaigns_tenant_status_updated_idx
  on public.relationship_campaigns (tenant_id, status, updated_at desc);
create index relationship_campaigns_tenant_owner_idx
  on public.relationship_campaigns (tenant_id, owner_profile_id, updated_at desc)
  where owner_profile_id is not null;
create index relationship_campaigns_created_by_idx
  on public.relationship_campaigns (created_by_profile_id)
  where created_by_profile_id is not null;
create index relationship_campaigns_updated_by_idx
  on public.relationship_campaigns (updated_by_profile_id)
  where updated_by_profile_id is not null;

create table public.relationship_campaign_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null,
  position integer not null,
  subject_template text not null,
  body_template text not null,
  delay_days integer not null default 0,
  stop_on_reply boolean not null default true,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_campaign_steps_tenant_campaign_fkey
    foreign key (tenant_id, campaign_id)
    references public.relationship_campaigns(tenant_id, id) on delete cascade,
  constraint relationship_campaign_steps_position_check check (position > 0),
  constraint relationship_campaign_steps_subject_check check (length(btrim(subject_template)) > 0),
  constraint relationship_campaign_steps_body_check check (length(btrim(body_template)) > 0),
  constraint relationship_campaign_steps_delay_check check (delay_days between 0 and 365),
  constraint relationship_campaign_steps_campaign_position_key unique (campaign_id, position)
);

create index relationship_campaign_steps_tenant_campaign_idx
  on public.relationship_campaign_steps (tenant_id, campaign_id, position);
create index relationship_campaign_steps_created_by_idx
  on public.relationship_campaign_steps (created_by_profile_id)
  where created_by_profile_id is not null;
create index relationship_campaign_steps_updated_by_idx
  on public.relationship_campaign_steps (updated_by_profile_id)
  where updated_by_profile_id is not null;

create table private.relationship_campaign_idempotency (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  idempotency_key text not null,
  campaign_id uuid,
  operation text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, idempotency_key),
  constraint relationship_campaign_idempotency_response_check check (jsonb_typeof(response) = 'object')
);

create index relationship_campaign_idempotency_campaign_idx
  on private.relationship_campaign_idempotency (tenant_id, campaign_id, created_at desc)
  where campaign_id is not null;

comment on table public.relationship_campaigns is
  'Non-clinical Business Development campaign definitions. Execution remains database-disabled until later safety and delivery passes.';
comment on table public.relationship_campaign_steps is
  'Ordered templates for non-clinical relationship campaigns. No worker or send behavior is enabled by this table.';
comment on column public.relationship_campaigns.execution_enabled is
  'Hard-disabled in Pass 9. A future reviewed migration must remove the check constraint before execution can be enabled.';
