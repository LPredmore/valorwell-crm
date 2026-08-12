-- Provider applicant communication belongs to CRM transport and audit authority.
-- Staff remains the workflow owner; this migration exposes only an explicit
-- queue/worker boundary and keeps the underlying tables service-role only.

alter table public.crm_email_messages
  add column if not exists provider_applicant_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.crm_email_messages'::regclass
      and conname = 'crm_email_messages_provider_applicant_id_fkey'
  ) then
    alter table public.crm_email_messages
      add constraint crm_email_messages_provider_applicant_id_fkey
      foreign key (provider_applicant_id)
      references public.provider_applicants(id)
      on delete set null;
  end if;
end
$$;

create index if not exists crm_email_messages_provider_applicant_idx
  on public.crm_email_messages (tenant_id, provider_applicant_id, occurred_at desc)
  where provider_applicant_id is not null;

create index if not exists crm_email_messages_provider_applicant_fk_idx
  on public.crm_email_messages (provider_applicant_id)
  where provider_applicant_id is not null;

alter table public.crm_inbound_sms_logs
  add column if not exists provider_applicant_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.crm_inbound_sms_logs'::regclass
      and conname = 'crm_inbound_sms_logs_provider_applicant_id_fkey'
  ) then
    alter table public.crm_inbound_sms_logs
      add constraint crm_inbound_sms_logs_provider_applicant_id_fkey
      foreign key (provider_applicant_id)
      references public.provider_applicants(id)
      on delete set null;
  end if;
end
$$;

create index if not exists crm_inbound_sms_logs_provider_applicant_idx
  on public.crm_inbound_sms_logs (tenant_id, provider_applicant_id, received_at desc)
  where provider_applicant_id is not null;

create index if not exists crm_inbound_sms_logs_provider_applicant_fk_idx
  on public.crm_inbound_sms_logs (provider_applicant_id)
  where provider_applicant_id is not null;

create table if not exists public.crm_provider_applicant_communication_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  applicant_id uuid not null references public.provider_applicants(id) on delete cascade,
  communication_kind text not null,
  channel text not null,
  content_version text not null default 'provider_recruiting_v1',
  scheduled_for timestamptz not null,
  status text not null default 'scheduled',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  claim_token uuid,
  claimed_at timestamptz,
  email_message_id uuid references public.crm_email_messages(id) on delete set null,
  provider_message_id text,
  error_code text,
  error_detail text,
  idempotency_key text not null,
  client_action_id uuid,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint crm_provider_applicant_jobs_kind_check check (
    communication_kind = any (array['initial_email', 'initial_sms']::text[])
  ),
  constraint crm_provider_applicant_jobs_channel_check check (
    channel = any (array['email', 'sms']::text[])
  ),
  constraint crm_provider_applicant_jobs_kind_channel_check check (
    (communication_kind = 'initial_email' and channel = 'email')
    or (communication_kind = 'initial_sms' and channel = 'sms')
  ),
  constraint crm_provider_applicant_jobs_status_check check (
    status = any (array['scheduled', 'processing', 'sent', 'failed', 'skipped', 'cancelled']::text[])
  ),
  constraint crm_provider_applicant_jobs_attempts_check check (
    attempt_count >= 0 and max_attempts between 1 and 20
  ),
  constraint crm_provider_applicant_jobs_claim_check check (
    (status = 'processing' and claim_token is not null and claimed_at is not null)
    or (status <> 'processing' and claim_token is null and claimed_at is null)
  ),
  constraint crm_provider_applicant_jobs_sent_check check (
    (status = 'sent' and sent_at is not null)
    or status <> 'sent'
  ),
  constraint crm_provider_applicant_jobs_idempotency_key unique (tenant_id, idempotency_key),
  constraint crm_provider_applicant_jobs_client_action_key unique (tenant_id, client_action_id)
);

create index if not exists crm_provider_applicant_jobs_dispatch_idx
  on public.crm_provider_applicant_communication_jobs (status, scheduled_for, tenant_id)
  where status in ('scheduled', 'failed', 'processing');

create index if not exists crm_provider_applicant_jobs_applicant_idx
  on public.crm_provider_applicant_communication_jobs (tenant_id, applicant_id, created_at desc);

create index if not exists crm_provider_applicant_jobs_applicant_fk_idx
  on public.crm_provider_applicant_communication_jobs (applicant_id);

create index if not exists crm_provider_applicant_jobs_email_message_fk_idx
  on public.crm_provider_applicant_communication_jobs (email_message_id)
  where email_message_id is not null;

create index if not exists crm_provider_applicant_jobs_creator_fk_idx
  on public.crm_provider_applicant_communication_jobs (created_by_profile_id)
  where created_by_profile_id is not null;

alter table public.crm_provider_applicant_communication_jobs enable row level security;
revoke all on public.crm_provider_applicant_communication_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.crm_provider_applicant_communication_jobs to service_role;

comment on table public.crm_provider_applicant_communication_jobs is
  'CRM-owned idempotent delivery outbox for provider applicant email and SMS. Staff owns applicant state transitions.';

create or replace function private.crm_validate_provider_applicant_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant uuid;
begin
  select applicant.tenant_id
  into v_tenant
  from public.provider_applicants applicant
  where applicant.id = new.applicant_id;

  if v_tenant is null or v_tenant <> new.tenant_id then
    raise exception 'CROSS_TENANT_DENIED' using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists crm_provider_applicant_jobs_tenant_guard
  on public.crm_provider_applicant_communication_jobs;
create trigger crm_provider_applicant_jobs_tenant_guard
before insert or update of tenant_id, applicant_id
on public.crm_provider_applicant_communication_jobs
for each row execute function private.crm_validate_provider_applicant_tenant();

create or replace function private.crm_validate_provider_applicant_message_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant uuid;
begin
  if new.provider_applicant_id is null then
    return new;
  end if;

  select applicant.tenant_id
  into v_tenant
  from public.provider_applicants applicant
  where applicant.id = new.provider_applicant_id;

  if v_tenant is null or v_tenant <> new.tenant_id then
    raise exception 'CROSS_TENANT_DENIED' using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists crm_email_messages_provider_applicant_tenant_guard
  on public.crm_email_messages;
create trigger crm_email_messages_provider_applicant_tenant_guard
before insert or update of tenant_id, provider_applicant_id
on public.crm_email_messages
for each row execute function private.crm_validate_provider_applicant_message_tenant();

drop trigger if exists crm_inbound_sms_provider_applicant_tenant_guard
  on public.crm_inbound_sms_logs;
create trigger crm_inbound_sms_provider_applicant_tenant_guard
before insert or update of tenant_id, provider_applicant_id
on public.crm_inbound_sms_logs
for each row execute function private.crm_validate_provider_applicant_message_tenant();

create or replace function private.crm_enqueue_provider_applicant_initial_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'new' and new.first_contacted_at is null then
    insert into public.crm_provider_applicant_communication_jobs (
      tenant_id,
      applicant_id,
      communication_kind,
      channel,
      scheduled_for,
      idempotency_key
    )
    values (
      new.tenant_id,
      new.id,
      'initial_email',
      'email',
      new.created_at + interval '6 hours',
      'provider-applicant/' || new.id::text || '/initial-email/v1'
    )
    on conflict (tenant_id, idempotency_key) do nothing;

    if nullif(btrim(coalesce(new.phone, '')), '') is not null then
      insert into public.crm_provider_applicant_communication_jobs (
        tenant_id,
        applicant_id,
        communication_kind,
        channel,
        scheduled_for,
        idempotency_key
      )
      values (
        new.tenant_id,
        new.id,
        'initial_sms',
        'sms',
        new.created_at + interval '7 hours',
        'provider-applicant/' || new.id::text || '/initial-sms/v1'
      )
      on conflict (tenant_id, idempotency_key) do nothing;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists crm_enqueue_provider_applicant_initial_contact
  on public.provider_applicants;
create trigger crm_enqueue_provider_applicant_initial_contact
after insert on public.provider_applicants
for each row execute function private.crm_enqueue_provider_applicant_initial_contact();

create or replace function public.crm_queue_provider_applicant_initial_contact(
  p_applicant_id uuid,
  p_prior_version bigint,
  p_client_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_applicant public.provider_applicants%rowtype;
  v_actor uuid;
  v_email_job public.crm_provider_applicant_communication_jobs%rowtype;
  v_sms_job public.crm_provider_applicant_communication_jobs%rowtype;
begin
  if p_applicant_id is null or p_prior_version is null or p_client_action_id is null then
    raise exception 'MISSING_PREREQUISITE' using errcode = '22023';
  end if;

  select applicant.*
  into v_applicant
  from public.provider_applicants applicant
  where applicant.id = p_applicant_id
  for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_actor := private.valorwell_require_staff_contract(v_applicant.tenant_id, true);

  if v_applicant.version <> p_prior_version then
    raise exception 'STALE_VERSION' using errcode = '40001';
  end if;

  if v_applicant.first_contacted_at is not null
     or v_applicant.status::text in ('hired', 'declined', 'withdrawn', 'inactive', 'no_response') then
    raise exception 'INVALID_TRANSITION' using errcode = '23514';
  end if;

  insert into public.crm_provider_applicant_communication_jobs (
    tenant_id,
    applicant_id,
    communication_kind,
    channel,
    scheduled_for,
    status,
    idempotency_key,
    client_action_id,
    created_by_profile_id
  )
  values (
    v_applicant.tenant_id,
    v_applicant.id,
    'initial_email',
    'email',
    clock_timestamp(),
    'scheduled',
    'provider-applicant/' || v_applicant.id::text || '/initial-email/v1',
    p_client_action_id,
    v_actor
  )
  on conflict (tenant_id, idempotency_key) do update
  set scheduled_for = case
      when public.crm_provider_applicant_communication_jobs.status in ('sent', 'processing')
          then public.crm_provider_applicant_communication_jobs.scheduled_for
        else clock_timestamp()
      end,
      status = case
        when public.crm_provider_applicant_communication_jobs.status in ('sent', 'processing')
          then public.crm_provider_applicant_communication_jobs.status
        else 'scheduled'
      end,
      attempt_count = case
        when public.crm_provider_applicant_communication_jobs.status in ('sent', 'processing')
          then public.crm_provider_applicant_communication_jobs.attempt_count
        else 0
      end,
      claim_token = case
        when public.crm_provider_applicant_communication_jobs.status = 'processing'
          then public.crm_provider_applicant_communication_jobs.claim_token
        else null
      end,
      claimed_at = case
        when public.crm_provider_applicant_communication_jobs.status = 'processing'
          then public.crm_provider_applicant_communication_jobs.claimed_at
        else null
      end,
      error_code = null,
      error_detail = null,
      client_action_id = coalesce(
        public.crm_provider_applicant_communication_jobs.client_action_id,
        excluded.client_action_id
      ),
      created_by_profile_id = coalesce(
        public.crm_provider_applicant_communication_jobs.created_by_profile_id,
        excluded.created_by_profile_id
      ),
      updated_at = clock_timestamp()
  returning * into v_email_job;

  if nullif(btrim(coalesce(v_applicant.phone, '')), '') is not null then
    insert into public.crm_provider_applicant_communication_jobs (
      tenant_id,
      applicant_id,
      communication_kind,
      channel,
      scheduled_for,
      status,
      idempotency_key,
      created_by_profile_id
    )
    values (
      v_applicant.tenant_id,
      v_applicant.id,
      'initial_sms',
      'sms',
      clock_timestamp() + interval '1 hour',
      'scheduled',
      'provider-applicant/' || v_applicant.id::text || '/initial-sms/v1',
      v_actor
    )
    on conflict (tenant_id, idempotency_key) do update
    set scheduled_for = case
          when public.crm_provider_applicant_communication_jobs.status in ('sent', 'processing')
            then public.crm_provider_applicant_communication_jobs.scheduled_for
          else clock_timestamp() + interval '1 hour'
        end,
        status = case
          when public.crm_provider_applicant_communication_jobs.status in ('sent', 'processing')
            then public.crm_provider_applicant_communication_jobs.status
          else 'scheduled'
        end,
        attempt_count = case
          when public.crm_provider_applicant_communication_jobs.status in ('sent', 'processing')
            then public.crm_provider_applicant_communication_jobs.attempt_count
          else 0
        end,
        claim_token = case
          when public.crm_provider_applicant_communication_jobs.status = 'processing'
            then public.crm_provider_applicant_communication_jobs.claim_token
          else null
        end,
        claimed_at = case
          when public.crm_provider_applicant_communication_jobs.status = 'processing'
            then public.crm_provider_applicant_communication_jobs.claimed_at
          else null
        end,
        error_code = null,
        error_detail = null,
        created_by_profile_id = coalesce(
          public.crm_provider_applicant_communication_jobs.created_by_profile_id,
          excluded.created_by_profile_id
        ),
        updated_at = clock_timestamp()
    returning * into v_sms_job;
  end if;

  return jsonb_build_object(
    'emailJobId', v_email_job.id,
    'emailStatus', v_email_job.status,
    'emailScheduledFor', v_email_job.scheduled_for,
    'smsJobId', v_sms_job.id,
    'smsStatus', v_sms_job.status,
    'smsScheduledFor', v_sms_job.scheduled_for
  );
end;
$function$;

create or replace function public.crm_claim_provider_applicant_communication_jobs(
  p_limit integer default 25
)
returns table (
  id uuid,
  tenant_id uuid,
  applicant_id uuid,
  communication_kind text,
  channel text,
  content_version text,
  scheduled_for timestamptz,
  attempt_count integer,
  max_attempts integer,
  claim_token uuid,
  email_message_id uuid,
  provider_message_id text,
  sent_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.valorwell_is_service_role() then
    raise exception 'ROLE_DENIED' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select job.id
    from public.crm_provider_applicant_communication_jobs job
    where (
        (
          job.status in ('scheduled', 'failed')
          and job.scheduled_for <= clock_timestamp()
          and job.attempt_count < job.max_attempts
        )
        or (
          job.status = 'processing'
          and job.claimed_at < clock_timestamp() - interval '15 minutes'
          and job.attempt_count < job.max_attempts
        )
      )
      and extract(isodow from clock_timestamp() at time zone 'America/Chicago') between 1 and 5
      and (clock_timestamp() at time zone 'America/Chicago')::time >= time '08:00'
      and (clock_timestamp() at time zone 'America/Chicago')::time < time '18:30'
    order by job.scheduled_for, job.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  ), claimed as (
    update public.crm_provider_applicant_communication_jobs job
    set status = 'processing',
        attempt_count = job.attempt_count + 1,
        claim_token = gen_random_uuid(),
        claimed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select
    claimed.id,
    claimed.tenant_id,
    claimed.applicant_id,
    claimed.communication_kind,
    claimed.channel,
    claimed.content_version,
    claimed.scheduled_for,
    claimed.attempt_count,
    claimed.max_attempts,
    claimed.claim_token,
    claimed.email_message_id,
    claimed.provider_message_id,
    claimed.sent_at
  from claimed;
end;
$function$;

create or replace function public.crm_attach_provider_applicant_email_message(
  p_job_id uuid,
  p_claim_token uuid,
  p_email_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.valorwell_is_service_role() then
    raise exception 'ROLE_DENIED' using errcode = '42501';
  end if;

  update public.crm_provider_applicant_communication_jobs job
  set email_message_id = p_email_message_id,
      updated_at = clock_timestamp()
  where job.id = p_job_id
    and job.status = 'processing'
    and job.claim_token = p_claim_token;

  if not found then
    raise exception 'STALE_CLAIM' using errcode = '40001';
  end if;
end;
$function$;

create or replace function public.crm_record_provider_applicant_transport_acceptance(
  p_job_id uuid,
  p_claim_token uuid,
  p_provider_message_id text,
  p_email_message_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.valorwell_is_service_role() then
    raise exception 'ROLE_DENIED' using errcode = '42501';
  end if;

  update public.crm_provider_applicant_communication_jobs job
  set provider_message_id = coalesce(p_provider_message_id, job.provider_message_id),
      email_message_id = coalesce(p_email_message_id, job.email_message_id),
      sent_at = coalesce(job.sent_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where job.id = p_job_id
    and job.status = 'processing'
    and job.claim_token = p_claim_token;

  if not found then
    raise exception 'STALE_CLAIM' using errcode = '40001';
  end if;
end;
$function$;

create or replace function public.crm_complete_provider_applicant_communication_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_provider_message_id text default null,
  p_email_message_id uuid default null,
  p_error_code text default null,
  p_error_detail text default null,
  p_retry_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.crm_provider_applicant_communication_jobs%rowtype;
  v_status text;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'ROLE_DENIED' using errcode = '42501';
  end if;

  if not (p_status = any (array['sent', 'failed', 'skipped', 'cancelled']::text[])) then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;

  select job.*
  into v_job
  from public.crm_provider_applicant_communication_jobs job
  where job.id = p_job_id
    and job.status = 'processing'
    and job.claim_token = p_claim_token
  for update;

  if not found then
    raise exception 'STALE_CLAIM' using errcode = '40001';
  end if;

  v_status := p_status;
  if p_status = 'failed'
     and v_job.attempt_count < v_job.max_attempts
     and p_retry_at is not null then
    v_status := 'failed';
  end if;

  update public.crm_provider_applicant_communication_jobs job
  set status = v_status,
      provider_message_id = coalesce(p_provider_message_id, job.provider_message_id),
      email_message_id = coalesce(p_email_message_id, job.email_message_id),
      error_code = case when v_status = 'sent' then null else p_error_code end,
      error_detail = case when v_status = 'sent' then null else left(p_error_detail, 2000) end,
      scheduled_for = case
        when v_status = 'failed'
          and job.attempt_count < job.max_attempts
          and p_retry_at is not null
          then p_retry_at
        else job.scheduled_for
      end,
      sent_at = case when v_status = 'sent' then coalesce(job.sent_at, clock_timestamp()) else job.sent_at end,
      claim_token = null,
      claimed_at = null,
      updated_at = clock_timestamp()
  where job.id = v_job.id
  returning job.* into v_job;

  return jsonb_build_object(
    'jobId', v_job.id,
    'status', v_job.status,
    'attemptCount', v_job.attempt_count,
    'maxAttempts', v_job.max_attempts,
    'scheduledFor', v_job.scheduled_for,
    'sentAt', v_job.sent_at
  );
end;
$function$;

revoke all on function public.crm_queue_provider_applicant_initial_contact(uuid, bigint, uuid)
  from public, anon;
grant execute on function public.crm_queue_provider_applicant_initial_contact(uuid, bigint, uuid)
  to authenticated, service_role;

revoke all on function public.crm_claim_provider_applicant_communication_jobs(integer),
  public.crm_attach_provider_applicant_email_message(uuid, uuid, uuid),
  public.crm_record_provider_applicant_transport_acceptance(uuid, uuid, text, uuid),
  public.crm_complete_provider_applicant_communication_job(uuid, uuid, text, text, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.crm_claim_provider_applicant_communication_jobs(integer),
  public.crm_attach_provider_applicant_email_message(uuid, uuid, uuid),
  public.crm_record_provider_applicant_transport_acceptance(uuid, uuid, text, uuid),
  public.crm_complete_provider_applicant_communication_job(uuid, uuid, text, text, uuid, text, text, timestamptz)
  to service_role;

revoke all on function private.crm_validate_provider_applicant_tenant(),
  private.crm_validate_provider_applicant_message_tenant(),
  private.crm_enqueue_provider_applicant_initial_contact()
  from public, anon, authenticated;
grant execute on function private.crm_validate_provider_applicant_tenant(),
  private.crm_validate_provider_applicant_message_tenant(),
  private.crm_enqueue_provider_applicant_initial_contact()
  to service_role;
