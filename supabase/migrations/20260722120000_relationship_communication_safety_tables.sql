create table public.relationship_suppressions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scope text not null,
  reason text not null,
  organization_id uuid null,
  contact_id uuid null,
  campaign_id uuid null,
  email text null,
  effective_at timestamptz not null default now(),
  expires_at timestamptz null,
  revoked_at timestamptz null,
  revoked_by_profile_id uuid null references public.profiles(id) on delete set null,
  version bigint not null default 1,
  source text not null default 'crm_manual',
  source_record_key text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid null references public.profiles(id) on delete set null,
  updated_by_profile_id uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_suppressions_scope_check check (scope = any (array['global','organization','contact','email','campaign']::text[])),
  constraint relationship_suppressions_reason_check check (reason = any (array['manual','unsubscribe','do_not_contact','invalid_address','bounce','complaint','campaign_stop']::text[])),
  constraint relationship_suppressions_target_check check (
    (scope = 'global' and organization_id is null and contact_id is null and campaign_id is null and email is null)
    or (scope = 'organization' and organization_id is not null and contact_id is null and campaign_id is null and email is null)
    or (scope = 'contact' and organization_id is null and contact_id is not null and campaign_id is null and email is null)
    or (scope = 'email' and organization_id is null and contact_id is null and campaign_id is null and nullif(btrim(email), '') is not null)
    or (scope = 'campaign' and organization_id is null and contact_id is null and campaign_id is not null and email is null)
  ),
  constraint relationship_suppressions_effective_check check (expires_at is null or expires_at > effective_at),
  constraint relationship_suppressions_revocation_check check (revoked_at is null or revoked_at >= effective_at),
  constraint relationship_suppressions_version_check check (version > 0),
  constraint relationship_suppressions_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint relationship_suppressions_email_check check (email is null or lower(btrim(email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint relationship_suppressions_tenant_org_fkey foreign key (tenant_id, organization_id) references public.relationship_organizations(tenant_id, id),
  constraint relationship_suppressions_tenant_contact_fkey foreign key (tenant_id, contact_id) references public.relationship_contacts(tenant_id, id),
  constraint relationship_suppressions_tenant_campaign_fkey foreign key (tenant_id, campaign_id) references public.relationship_campaigns(tenant_id, id),
  constraint relationship_suppressions_tenant_id_id_key unique (tenant_id, id)
);
create unique index relationship_suppressions_active_global_reason_idx
  on public.relationship_suppressions (tenant_id, reason)
  where scope = 'global' and revoked_at is null;
create unique index relationship_suppressions_active_org_reason_idx
  on public.relationship_suppressions (tenant_id, organization_id, reason)
  where scope = 'organization' and revoked_at is null;
create unique index relationship_suppressions_active_contact_reason_idx
  on public.relationship_suppressions (tenant_id, contact_id, reason)
  where scope = 'contact' and revoked_at is null;
create unique index relationship_suppressions_active_email_reason_idx
  on public.relationship_suppressions (tenant_id, lower(email), reason)
  where scope = 'email' and revoked_at is null;
create unique index relationship_suppressions_active_campaign_reason_idx
  on public.relationship_suppressions (tenant_id, campaign_id, reason)
  where scope = 'campaign' and revoked_at is null;
create index relationship_suppressions_active_lookup_idx
  on public.relationship_suppressions (tenant_id, scope, effective_at desc, id)
  where revoked_at is null;
create index relationship_suppressions_org_idx on public.relationship_suppressions (tenant_id, organization_id, effective_at desc) where organization_id is not null;
create index relationship_suppressions_contact_idx on public.relationship_suppressions (tenant_id, contact_id, effective_at desc) where contact_id is not null;
create index relationship_suppressions_campaign_idx on public.relationship_suppressions (tenant_id, campaign_id, effective_at desc) where campaign_id is not null;
create index relationship_suppressions_email_idx on public.relationship_suppressions (tenant_id, lower(email), effective_at desc) where email is not null;
create index relationship_suppressions_created_by_idx on public.relationship_suppressions (created_by_profile_id) where created_by_profile_id is not null;
create index relationship_suppressions_updated_by_idx on public.relationship_suppressions (updated_by_profile_id) where updated_by_profile_id is not null;
create index relationship_suppressions_revoked_by_idx on public.relationship_suppressions (revoked_by_profile_id) where revoked_by_profile_id is not null;
create table private.relationship_unsubscribe_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token_hash text not null unique,
  contact_id uuid null,
  campaign_id uuid null,
  email text not null,
  expires_at timestamptz not null,
  used_at timestamptz null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint relationship_unsubscribe_tokens_email_check check (lower(btrim(email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint relationship_unsubscribe_tokens_expiry_check check (expires_at > created_at),
  constraint relationship_unsubscribe_tokens_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint relationship_unsubscribe_tokens_tenant_contact_fkey foreign key (tenant_id, contact_id) references public.relationship_contacts(tenant_id, id),
  constraint relationship_unsubscribe_tokens_tenant_campaign_fkey foreign key (tenant_id, campaign_id) references public.relationship_campaigns(tenant_id, id),
  constraint relationship_unsubscribe_tokens_tenant_id_id_key unique (tenant_id, id)
);
create index relationship_unsubscribe_tokens_tenant_contact_idx on private.relationship_unsubscribe_tokens (tenant_id, contact_id) where contact_id is not null;
create index relationship_unsubscribe_tokens_tenant_campaign_idx on private.relationship_unsubscribe_tokens (tenant_id, campaign_id) where campaign_id is not null;
create index relationship_unsubscribe_tokens_expiry_idx on private.relationship_unsubscribe_tokens (expires_at) where used_at is null;
create table public.relationship_unsubscribe_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid null references public.tenants(id) on delete cascade,
  token_id uuid null references private.relationship_unsubscribe_tokens(id) on delete set null,
  email text null,
  processed_at timestamptz null,
  suppression_id uuid null,
  outcome text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_unsubscribe_requests_outcome_check check (outcome = any (array['pending','unsubscribed','already_unsubscribed','invalid_token']::text[])),
  constraint relationship_unsubscribe_requests_email_check check (email is null or lower(btrim(email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint relationship_unsubscribe_requests_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint relationship_unsubscribe_requests_tenant_suppression_fkey foreign key (tenant_id, suppression_id) references public.relationship_suppressions(tenant_id, id),
  constraint relationship_unsubscribe_requests_tenant_id_id_key unique (tenant_id, id)
);
create index relationship_unsubscribe_requests_tenant_created_idx on public.relationship_unsubscribe_requests (tenant_id, created_at desc) where tenant_id is not null;
create index relationship_unsubscribe_requests_token_idx on public.relationship_unsubscribe_requests (token_id) where token_id is not null;
create index relationship_unsubscribe_requests_suppression_idx on public.relationship_unsubscribe_requests (tenant_id, suppression_id) where suppression_id is not null;
create table private.relationship_safety_idempotency (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  idempotency_key text not null,
  operation text not null,
  suppression_id uuid null,
  enrollment_id uuid null,
  actor_profile_id uuid null references public.profiles(id) on delete set null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, idempotency_key),
  constraint relationship_safety_idempotency_operation_check check (operation = any (array['apply_suppression','revoke_suppression','revalidate_enrollment']::text[])),
  constraint relationship_safety_idempotency_response_check check (jsonb_typeof(response) in ('object','array')),
  constraint relationship_safety_idempotency_tenant_suppression_fkey foreign key (tenant_id, suppression_id) references public.relationship_suppressions(tenant_id, id),
  constraint relationship_safety_idempotency_tenant_enrollment_fkey foreign key (tenant_id, enrollment_id) references public.relationship_campaign_enrollments(tenant_id, id)
);
create index relationship_safety_idempotency_suppression_idx on private.relationship_safety_idempotency (tenant_id, suppression_id) where suppression_id is not null;
create index relationship_safety_idempotency_enrollment_idx on private.relationship_safety_idempotency (tenant_id, enrollment_id) where enrollment_id is not null;
create index relationship_safety_idempotency_actor_idx on private.relationship_safety_idempotency (actor_profile_id) where actor_profile_id is not null;
alter table public.relationship_campaign_enrollments
  add column safety_snapshot jsonb not null default '{}'::jsonb,
  add column safety_evaluated_at timestamptz null,
  add column safety_ready_at timestamptz null,
  add column safety_blocked_at timestamptz null;
alter table public.relationship_campaign_enrollments drop constraint relationship_campaign_enrollments_safety_pending_check;
alter table public.relationship_campaign_enrollments
  add constraint relationship_campaign_enrollments_safety_status_check check (safety_status = any (array['pending_pass_11','ready','blocked']::text[])),
  add constraint relationship_campaign_enrollments_safety_snapshot_check check (jsonb_typeof(safety_snapshot) = 'object'),
  add constraint relationship_campaign_enrollments_safety_timestamp_check check (
    (safety_status <> 'ready' or safety_ready_at is not null)
    and (safety_status <> 'blocked' or safety_blocked_at is not null)
  );
create index relationship_campaign_enrollments_safety_idx
  on public.relationship_campaign_enrollments (tenant_id, safety_status, status, next_scheduled_at, id);
alter table public.relationship_enrollment_events drop constraint relationship_enrollment_events_type_check;
alter table public.relationship_enrollment_events
  add constraint relationship_enrollment_events_type_check check (event_type = any (array[
    'enrolled','paused','resumed','stopped','work_planned','work_claimed','work_retry_scheduled',
    'step_completed','completed','failed','system','safety_ready','safety_blocked','suppressed',
    'suppression_revoked','unsubscribe_processed'
  ]::text[]));
create or replace function public.set_relationship_suppression_audit_fields()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
begin
  new.scope := lower(btrim(new.scope));
  new.reason := lower(btrim(new.reason));
  new.email := nullif(lower(btrim(new.email)), '');
  new.source := lower(btrim(new.source));
  if tg_op = 'INSERT' then
    new.created_by_profile_id := coalesce(new.created_by_profile_id, v_actor);
    new.updated_by_profile_id := coalesce(new.updated_by_profile_id, v_actor, new.created_by_profile_id);
    new.version := 1;
  else
    if new.tenant_id is distinct from old.tenant_id
       or new.scope is distinct from old.scope
       or new.reason is distinct from old.reason
       or new.organization_id is distinct from old.organization_id
       or new.contact_id is distinct from old.contact_id
       or new.campaign_id is distinct from old.campaign_id
       or new.email is distinct from old.email
       or new.effective_at is distinct from old.effective_at
       or new.source is distinct from old.source
       or new.source_record_key is distinct from old.source_record_key then
      raise exception 'Suppression identity, target, reason, and provenance are immutable.' using errcode = '22023';
    end if;
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by_profile_id := old.created_by_profile_id;
    new.updated_at := now();
    new.updated_by_profile_id := coalesce(v_actor, new.updated_by_profile_id, old.updated_by_profile_id);
    new.version := old.version + 1;
  end if;
  return new;
end;
$function$;
create trigger relationship_suppressions_audit_fields
before insert or update on public.relationship_suppressions
for each row execute function public.set_relationship_suppression_audit_fields();
create or replace function public.set_relationship_unsubscribe_request_audit_fields()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  new.email := nullif(lower(btrim(new.email)), '');
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$function$;
create trigger relationship_unsubscribe_requests_audit_fields
before insert or update on public.relationship_unsubscribe_requests
for each row execute function public.set_relationship_unsubscribe_request_audit_fields();
create or replace function public.set_relationship_campaign_enrollment_audit_fields()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
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
       or new.delivery_enabled is distinct from old.delivery_enabled then
      raise exception 'Enrollment identity, recipient, preliminary eligibility, and delivery boundary are immutable.' using errcode = '22023';
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
$function$;
alter table public.relationship_suppressions enable row level security;
alter table public.relationship_unsubscribe_requests enable row level security;
alter table private.relationship_unsubscribe_tokens enable row level security;
alter table private.relationship_safety_idempotency enable row level security;
create policy relationship_suppressions_crm_select on public.relationship_suppressions
for select to authenticated
using (exists (
  select 1 from public.crm_user_capabilities capability
  where capability.profile_id = (select auth.uid())
    and capability.tenant_id = relationship_suppressions.tenant_id
    and capability.crm_role <> 'crm_none'::public.crm_capability_role
));
create policy relationship_unsubscribe_requests_crm_select on public.relationship_unsubscribe_requests
for select to authenticated
using (tenant_id is not null and exists (
  select 1 from public.crm_user_capabilities capability
  where capability.profile_id = (select auth.uid())
    and capability.tenant_id = relationship_unsubscribe_requests.tenant_id
    and capability.crm_role <> 'crm_none'::public.crm_capability_role
));
revoke all on public.relationship_suppressions from public, anon, authenticated;
revoke all on public.relationship_unsubscribe_requests from public, anon, authenticated;
grant select on public.relationship_suppressions to authenticated;
grant select on public.relationship_unsubscribe_requests to authenticated;
revoke all on private.relationship_unsubscribe_tokens from public, anon, authenticated;
revoke all on private.relationship_safety_idempotency from public, anon, authenticated;
grant all on private.relationship_unsubscribe_tokens to service_role;
grant all on private.relationship_safety_idempotency to service_role;
revoke all on function public.set_relationship_suppression_audit_fields() from public, anon, authenticated;
revoke all on function public.set_relationship_unsubscribe_request_audit_fields() from public, anon, authenticated;
revoke all on function public.set_relationship_campaign_enrollment_audit_fields() from public, anon, authenticated;
