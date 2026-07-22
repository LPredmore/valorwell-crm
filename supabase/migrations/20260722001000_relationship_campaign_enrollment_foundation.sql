alter table public.relationship_campaign_steps
  add constraint relationship_campaign_steps_tenant_id_id_key unique (tenant_id, id);

create table public.relationship_campaign_enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null,
  contact_id uuid not null,
  organization_id uuid,
  opportunity_id uuid,
  recipient_email text not null,
  recipient_name text,
  status text not null default 'pending',
  current_step_position integer,
  next_scheduled_at timestamptz,
  stopped_reason text,
  responded_at timestamptz,
  source_language_mode text not null default 'none',
  personalization_context jsonb not null default '{}'::jsonb,
  eligibility_snapshot jsonb not null default '{}'::jsonb,
  safety_status text not null default 'pending_pass_11',
  delivery_enabled boolean not null default false,
  version bigint not null default 1,
  enrolled_by_profile_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_campaign_enrollments_tenant_id_id_key unique (tenant_id, id),
  constraint relationship_campaign_enrollments_tenant_campaign_fkey
    foreign key (tenant_id, campaign_id)
    references public.relationship_campaigns(tenant_id, id) on delete cascade,
  constraint relationship_campaign_enrollments_tenant_contact_fkey
    foreign key (tenant_id, contact_id)
    references public.relationship_contacts(tenant_id, id),
  constraint relationship_campaign_enrollments_tenant_organization_fkey
    foreign key (tenant_id, organization_id)
    references public.relationship_organizations(tenant_id, id),
  constraint relationship_campaign_enrollments_tenant_opportunity_fkey
    foreign key (tenant_id, opportunity_id)
    references public.relationship_opportunities(tenant_id, id),
  constraint relationship_campaign_enrollments_email_check check (
    lower(btrim(recipient_email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint relationship_campaign_enrollments_status_check check (
    status = any (array['pending','active','paused','responded','stopped','completed','failed','suppressed']::text[])
  ),
  constraint relationship_campaign_enrollments_step_check check (
    current_step_position is null or current_step_position > 0
  ),
  constraint relationship_campaign_enrollments_source_language_check check (
    source_language_mode = any (array['research','community','verified_anonymous','verified_named','none']::text[])
  ),
  constraint relationship_campaign_enrollments_personalization_check check (
    jsonb_typeof(personalization_context) = 'object'
  ),
  constraint relationship_campaign_enrollments_eligibility_check check (
    jsonb_typeof(eligibility_snapshot) = 'object'
  ),
  constraint relationship_campaign_enrollments_safety_pending_check check (
    safety_status = 'pending_pass_11'
  ),
  constraint relationship_campaign_enrollments_delivery_disabled_check check (
    delivery_enabled = false
  ),
  constraint relationship_campaign_enrollments_version_check check (version > 0),
  constraint relationship_campaign_enrollments_status_fields_check check (
    (status <> 'responded' or responded_at is not null)
    and (status <> 'stopped' or nullif(btrim(stopped_reason), '') is not null)
  )
);

create unique index relationship_campaign_enrollments_active_target_idx
  on public.relationship_campaign_enrollments (tenant_id, campaign_id, contact_id)
  where status = any (array['pending','active','paused']::text[]);
create index relationship_campaign_enrollments_campaign_status_idx
  on public.relationship_campaign_enrollments (tenant_id, campaign_id, status, created_at desc);
create index relationship_campaign_enrollments_due_idx
  on public.relationship_campaign_enrollments (tenant_id, next_scheduled_at, id)
  where status = any (array['pending','active']::text[]) and next_scheduled_at is not null;
create index relationship_campaign_enrollments_contact_idx
  on public.relationship_campaign_enrollments (tenant_id, contact_id, created_at desc);
create index relationship_campaign_enrollments_organization_idx
  on public.relationship_campaign_enrollments (tenant_id, organization_id, created_at desc)
  where organization_id is not null;
create index relationship_campaign_enrollments_opportunity_idx
  on public.relationship_campaign_enrollments (tenant_id, opportunity_id, created_at desc)
  where opportunity_id is not null;
create index relationship_campaign_enrollments_enrolled_by_idx
  on public.relationship_campaign_enrollments (enrolled_by_profile_id)
  where enrolled_by_profile_id is not null;
create index relationship_campaign_enrollments_created_by_idx
  on public.relationship_campaign_enrollments (created_by_profile_id)
  where created_by_profile_id is not null;
create index relationship_campaign_enrollments_updated_by_idx
  on public.relationship_campaign_enrollments (updated_by_profile_id)
  where updated_by_profile_id is not null;

create table public.relationship_enrollment_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  enrollment_id uuid not null,
  event_type text not null,
  from_status text,
  to_status text,
  reason text,
  occurred_at timestamptz not null default now(),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint relationship_enrollment_events_tenant_enrollment_fkey
    foreign key (tenant_id, enrollment_id)
    references public.relationship_campaign_enrollments(tenant_id, id) on delete cascade,
  constraint relationship_enrollment_events_type_check check (
    event_type = any (array[
      'enrolled','paused','resumed','stopped','work_planned','work_claimed',
      'work_retry_scheduled','step_completed','completed','failed','system'
    ]::text[])
  ),
  constraint relationship_enrollment_events_from_status_check check (
    from_status is null or from_status = any (array['pending','active','paused','responded','stopped','completed','failed','suppressed']::text[])
  ),
  constraint relationship_enrollment_events_to_status_check check (
    to_status is null or to_status = any (array['pending','active','paused','responded','stopped','completed','failed','suppressed']::text[])
  ),
  constraint relationship_enrollment_events_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index relationship_enrollment_events_enrollment_occurred_idx
  on public.relationship_enrollment_events (tenant_id, enrollment_id, occurred_at desc, id desc);
create index relationship_enrollment_events_type_occurred_idx
  on public.relationship_enrollment_events (tenant_id, event_type, occurred_at desc);
create index relationship_enrollment_events_actor_idx
  on public.relationship_enrollment_events (actor_profile_id)
  where actor_profile_id is not null;

create table private.relationship_campaign_work_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null,
  enrollment_id uuid not null,
  campaign_step_id uuid not null,
  step_position integer not null,
  status text not null default 'planned',
  due_at timestamptz not null,
  available_at timestamptz not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  claim_token uuid,
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  completed_at timestamptz,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_campaign_work_items_tenant_campaign_fkey
    foreign key (tenant_id, campaign_id)
    references public.relationship_campaigns(tenant_id, id) on delete cascade,
  constraint relationship_campaign_work_items_tenant_enrollment_fkey
    foreign key (tenant_id, enrollment_id)
    references public.relationship_campaign_enrollments(tenant_id, id) on delete cascade,
  constraint relationship_campaign_work_items_tenant_step_fkey
    foreign key (tenant_id, campaign_step_id)
    references public.relationship_campaign_steps(tenant_id, id) on delete cascade,
  constraint relationship_campaign_work_items_position_check check (step_position > 0),
  constraint relationship_campaign_work_items_status_check check (
    status = any (array['planned','claimed','retry_wait','completed','cancelled','failed']::text[])
  ),
  constraint relationship_campaign_work_items_attempt_check check (
    attempt_count >= 0 and max_attempts between 1 and 25 and attempt_count <= max_attempts
  ),
  constraint relationship_campaign_work_items_claim_check check (
    (status = 'claimed' and claim_token is not null and nullif(btrim(claimed_by), '') is not null
      and claimed_at is not null and lease_expires_at is not null)
    or (status <> 'claimed')
  ),
  constraint relationship_campaign_work_items_completed_check check (
    status <> 'completed' or completed_at is not null
  ),
  constraint relationship_campaign_work_items_idempotency_key unique (tenant_id, idempotency_key),
  constraint relationship_campaign_work_items_enrollment_step_key unique (enrollment_id, campaign_step_id)
);

create index relationship_campaign_work_items_due_idx
  on private.relationship_campaign_work_items (status, available_at, due_at, id)
  where status = any (array['planned','retry_wait']::text[]);
create index relationship_campaign_work_items_lease_idx
  on private.relationship_campaign_work_items (lease_expires_at, id)
  where status = 'claimed';
create index relationship_campaign_work_items_enrollment_idx
  on private.relationship_campaign_work_items (tenant_id, enrollment_id, step_position);
create index relationship_campaign_work_items_campaign_idx
  on private.relationship_campaign_work_items (tenant_id, campaign_id, status, due_at);

create table private.relationship_enrollment_idempotency (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  idempotency_key text not null,
  operation text not null,
  campaign_id uuid,
  enrollment_id uuid,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, idempotency_key),
  constraint relationship_enrollment_idempotency_campaign_fkey
    foreign key (tenant_id, campaign_id)
    references public.relationship_campaigns(tenant_id, id) on delete cascade,
  constraint relationship_enrollment_idempotency_enrollment_fkey
    foreign key (tenant_id, enrollment_id)
    references public.relationship_campaign_enrollments(tenant_id, id) on delete cascade,
  constraint relationship_enrollment_idempotency_response_check check (jsonb_typeof(response) in ('object','array'))
);

create index relationship_enrollment_idempotency_campaign_idx
  on private.relationship_enrollment_idempotency (tenant_id, campaign_id, created_at desc)
  where campaign_id is not null;
create index relationship_enrollment_idempotency_enrollment_idx
  on private.relationship_enrollment_idempotency (tenant_id, enrollment_id, created_at desc)
  where enrollment_id is not null;
create index relationship_enrollment_idempotency_actor_idx
  on private.relationship_enrollment_idempotency (actor_profile_id)
  where actor_profile_id is not null;

create or replace function public.set_relationship_campaign_enrollment_audit_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  new.recipient_email := lower(btrim(new.recipient_email));
  new.recipient_name := nullif(regexp_replace(btrim(new.recipient_name), '\s+', ' ', 'g'), '');
  new.stopped_reason := nullif(btrim(new.stopped_reason), '');
  if tg_op = 'INSERT' then
    new.enrolled_by_profile_id := coalesce(new.enrolled_by_profile_id, v_actor);
    new.created_by_profile_id := coalesce(new.created_by_profile_id, v_actor);
    new.updated_by_profile_id := coalesce(new.updated_by_profile_id, v_actor, new.created_by_profile_id);
    new.version := 1;
  else
    if new.tenant_id is distinct from old.tenant_id
       or new.campaign_id is distinct from old.campaign_id
       or new.contact_id is distinct from old.contact_id
       or new.organization_id is distinct from old.organization_id
       or new.opportunity_id is distinct from old.opportunity_id
       or new.recipient_email is distinct from old.recipient_email
       or new.recipient_name is distinct from old.recipient_name
       or new.source_language_mode is distinct from old.source_language_mode
       or new.personalization_context is distinct from old.personalization_context
       or new.eligibility_snapshot is distinct from old.eligibility_snapshot
       or new.safety_status is distinct from old.safety_status
       or new.delivery_enabled is distinct from old.delivery_enabled then
      raise exception 'Enrollment identity and eligibility snapshots are immutable.' using errcode = '22023';
    end if;
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by_profile_id := old.created_by_profile_id;
    new.enrolled_by_profile_id := old.enrolled_by_profile_id;
    new.updated_by_profile_id := coalesce(v_actor, new.updated_by_profile_id, old.updated_by_profile_id);
    new.updated_at := now();
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

create trigger set_relationship_campaign_enrollments_audit_fields
before insert or update on public.relationship_campaign_enrollments
for each row execute function public.set_relationship_campaign_enrollment_audit_fields();

alter table public.relationship_campaign_enrollments enable row level security;
alter table public.relationship_enrollment_events enable row level security;
alter table private.relationship_campaign_work_items enable row level security;
alter table private.relationship_enrollment_idempotency enable row level security;

create policy relationship_campaign_enrollments_crm_select
on public.relationship_campaign_enrollments
for select
to authenticated
using (
  exists (
    select 1
    from public.crm_user_capabilities capability
    where capability.profile_id = (select auth.uid())
      and capability.tenant_id = relationship_campaign_enrollments.tenant_id
      and capability.crm_role <> 'crm_none'::public.crm_capability_role
  )
);

create policy relationship_enrollment_events_crm_select
on public.relationship_enrollment_events
for select
to authenticated
using (
  exists (
    select 1
    from public.crm_user_capabilities capability
    where capability.profile_id = (select auth.uid())
      and capability.tenant_id = relationship_enrollment_events.tenant_id
      and capability.crm_role <> 'crm_none'::public.crm_capability_role
  )
);

revoke all on table public.relationship_campaign_enrollments from public, anon, authenticated;
grant select on table public.relationship_campaign_enrollments to authenticated;
grant all on table public.relationship_campaign_enrollments to service_role;

revoke all on table public.relationship_enrollment_events from public, anon, authenticated;
grant select on table public.relationship_enrollment_events to authenticated;
grant all on table public.relationship_enrollment_events to service_role;

revoke all on table private.relationship_campaign_work_items from public, anon, authenticated;
grant all on table private.relationship_campaign_work_items to service_role;

revoke all on table private.relationship_enrollment_idempotency from public, anon, authenticated;
grant all on table private.relationship_enrollment_idempotency to service_role;

revoke all on function public.set_relationship_campaign_enrollment_audit_fields() from public, anon, authenticated;

comment on table public.relationship_campaign_enrollments is
  'Resolved non-clinical campaign recipients and immutable eligibility snapshots. Delivery remains disabled until later safety and delivery passes.';
comment on table public.relationship_enrollment_events is
  'Append-only lifecycle and orchestration event ledger for relationship campaign enrollments.';
comment on table private.relationship_campaign_work_items is
  'Service-only dormant orchestration queue. Claims require campaign execution, enrollment delivery, and safety gates that cannot pass in Pass 10.';
comment on column public.relationship_campaign_enrollments.safety_status is
  'Hard-locked to pending_pass_11 until suppression and unsubscribe policy is implemented and verified.';
comment on column public.relationship_campaign_enrollments.delivery_enabled is
  'Hard-disabled in Pass 10. No enrollment can be claimed for delivery.';
