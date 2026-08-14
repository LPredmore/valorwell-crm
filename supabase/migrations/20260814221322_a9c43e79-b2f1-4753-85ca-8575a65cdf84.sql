-- =========================================================
-- PHASE 5–9: Campaign trigger control plane
-- =========================================================

-- ---------- flag helper ----------
create or replace function private.crm_control_plane_flag(p_tenant_id uuid, p_flag_name text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((
    select f.enabled from private.crm_control_plane_flags f
    where f.tenant_id = p_tenant_id and f.flag_name = p_flag_name
  ), false);
$$;

-- ---------- Phase 5: automation events ----------
create table if not exists public.crm_automation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  event_type text not null,
  person_id uuid references public.crm_people(id) on delete set null,
  subject_type text not null,
  subject_id uuid not null,
  source text not null default 'database',
  source_event_id uuid,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (tenant_id, idempotency_key)
);

create index if not exists crm_automation_events_type_idx
  on public.crm_automation_events (tenant_id, event_type, occurred_at desc);
create index if not exists crm_automation_events_subject_idx
  on public.crm_automation_events (tenant_id, subject_type, subject_id, occurred_at desc);
create index if not exists crm_automation_events_unprocessed_idx
  on public.crm_automation_events (tenant_id, occurred_at) where processed_at is null;

grant select on public.crm_automation_events to authenticated;
grant all on public.crm_automation_events to service_role;
alter table public.crm_automation_events enable row level security;

drop policy if exists "crm_automation_events_read" on public.crm_automation_events;
create policy "crm_automation_events_read" on public.crm_automation_events
for select to authenticated
using (public.is_tenant_member(auth.uid(), tenant_id));

-- ---------- Phase 6: concurrency groups ----------
alter table public.crm_campaign_registry
  add column if not exists concurrency_group text not null default 'default';

create table if not exists public.crm_campaign_concurrency_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  group_key text not null,
  is_exclusive boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, group_key)
);

grant select on public.crm_campaign_concurrency_groups to authenticated;
grant all on public.crm_campaign_concurrency_groups to service_role;
alter table public.crm_campaign_concurrency_groups enable row level security;

drop policy if exists "crm_campaign_concurrency_groups_read" on public.crm_campaign_concurrency_groups;
create policy "crm_campaign_concurrency_groups_read" on public.crm_campaign_concurrency_groups
for select to authenticated
using (public.is_tenant_member(auth.uid(), tenant_id));

insert into public.crm_campaign_concurrency_groups (tenant_id, group_key, is_exclusive, description)
select distinct r.tenant_id, g.group_key, g.is_exclusive, g.description
from public.crm_campaign_registry r
cross join (values
  ('LEGACY_CLIENT_EXCLUSIVE', true,  'Preserves the historical one-active-campaign-per-client rule.'),
  ('client_general_nurture',  true,  'General client nurture outreach.'),
  ('client_reactivation',     true,  'Client reactivation outreach.'),
  ('client_operational',      false, 'Operational client messaging.'),
  ('staff_recruiting',        true,  'Provider applicant recruiting outreach.'),
  ('staff_onboarding',        true,  'Staff onboarding outreach.'),
  ('bty_outreach',            true,  'Beyond The Yellow relationship outreach.'),
  ('donor_stewardship',       true,  'Donor stewardship outreach.')
) as g(group_key, is_exclusive, description)
on conflict (tenant_id, group_key) do nothing;

update public.crm_campaign_registry
set concurrency_group = case
      when campaign_domain = 'client' then 'LEGACY_CLIENT_EXCLUSIVE'
      when campaign_domain = 'relationship' then 'bty_outreach'
      when campaign_domain = 'staff' then 'staff_recruiting'
      when campaign_domain = 'donor' then 'donor_stewardship'
      else 'default'
    end,
    updated_at = now()
where concurrency_group = 'default';

-- ---------- Phase 5: trigger rules ----------
create table if not exists public.crm_campaign_trigger_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  campaign_registry_id uuid not null references public.crm_campaign_registry(id) on delete cascade,
  event_type text not null,
  filter_definition jsonb not null default '{}'::jsonb,
  delay_amount integer not null default 0 check (delay_amount >= 0),
  delay_unit text not null default 'minutes' check (delay_unit in ('minutes','hours','days')),
  required_source_campaign_registry_id uuid references public.crm_campaign_registry(id) on delete set null,
  required_source_outcome text,
  active boolean not null default false,
  version integer not null default 1,
  created_by_profile_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_campaign_trigger_rules_event_idx
  on public.crm_campaign_trigger_rules (tenant_id, event_type) where active;

grant select on public.crm_campaign_trigger_rules to authenticated;
grant all on public.crm_campaign_trigger_rules to service_role;
alter table public.crm_campaign_trigger_rules enable row level security;

drop policy if exists "crm_campaign_trigger_rules_read" on public.crm_campaign_trigger_rules;
create policy "crm_campaign_trigger_rules_read" on public.crm_campaign_trigger_rules
for select to authenticated
using (public.is_tenant_member(auth.uid(), tenant_id));

-- cycle protection
create or replace function public.crm_guard_campaign_trigger_cycles()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.required_source_campaign_registry_id is not null then
    if new.required_source_campaign_registry_id = new.campaign_registry_id then
      raise exception 'A campaign cannot trigger itself.' using errcode = '22023';
    end if;

    if exists (
      select 1 from public.crm_campaign_trigger_rules r
      where r.tenant_id = new.tenant_id
        and r.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
        and r.campaign_registry_id = new.required_source_campaign_registry_id
        and r.required_source_campaign_registry_id = new.campaign_registry_id
    ) then
      raise exception 'This rule would create a two-campaign automation loop.' using errcode = '22023';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists crm_campaign_trigger_rules_guard on public.crm_campaign_trigger_rules;
create trigger crm_campaign_trigger_rules_guard
before insert or update on public.crm_campaign_trigger_rules
for each row execute function public.crm_guard_campaign_trigger_cycles();

-- ---------- Phase 5: trigger jobs ----------
create table if not exists public.crm_campaign_trigger_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  event_id uuid not null references public.crm_automation_events(id) on delete cascade,
  trigger_rule_id uuid not null references public.crm_campaign_trigger_rules(id) on delete cascade,
  person_id uuid references public.crm_people(id) on delete set null,
  subject_type text not null,
  subject_id uuid not null,
  due_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending','processing','enrolled','skipped','failed','cancelled')),
  claim_token uuid,
  claimed_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  evaluation_result jsonb not null default '{}'::jsonb,
  skip_reason text,
  engine_enrollment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, trigger_rule_id)
);

create index if not exists crm_campaign_trigger_jobs_due_idx
  on public.crm_campaign_trigger_jobs (tenant_id, due_at) where status = 'pending';
create index if not exists crm_campaign_trigger_jobs_subject_idx
  on public.crm_campaign_trigger_jobs (tenant_id, subject_type, subject_id, created_at desc);

grant select on public.crm_campaign_trigger_jobs to authenticated;
grant all on public.crm_campaign_trigger_jobs to service_role;
alter table public.crm_campaign_trigger_jobs enable row level security;

drop policy if exists "crm_campaign_trigger_jobs_read" on public.crm_campaign_trigger_jobs;
create policy "crm_campaign_trigger_jobs_read" on public.crm_campaign_trigger_jobs
for select to authenticated
using (public.is_tenant_member(auth.uid(), tenant_id));

-- ---------- person resolution helper ----------
create or replace function private.crm_resolve_person(p_tenant_id uuid, p_domain text, p_record_id uuid)
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select pr.person_id
  from public.crm_person_records pr
  where pr.tenant_id = p_tenant_id
    and pr.record_domain = p_domain
    and pr.record_id = p_record_id
  limit 1;
$$;

-- ---------- Phase 6: concurrency evaluation ----------
create or replace function public.crm_evaluate_campaign_concurrency(
  p_tenant_id uuid,
  p_campaign_registry_id uuid,
  p_subject_type text,
  p_subject_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_registry public.crm_campaign_registry;
  v_exclusive boolean;
  v_conflict uuid;
begin
  select * into v_registry from public.crm_campaign_registry
  where id = p_campaign_registry_id and tenant_id = p_tenant_id;

  if v_registry.id is null then
    return jsonb_build_object('allowed', false, 'reason', 'unknown_campaign');
  end if;

  select coalesce(g.is_exclusive, true) into v_exclusive
  from public.crm_campaign_concurrency_groups g
  where g.tenant_id = p_tenant_id and g.group_key = v_registry.concurrency_group;

  if v_registry.engine = 'crm_campaigns' and p_subject_type = 'client' then
    -- 1. never duplicate an active enrolment in the same campaign
    select e.id into v_conflict
    from public.crm_campaign_enrollments e
    where e.tenant_id = p_tenant_id
      and e.client_id = p_subject_id
      and e.campaign_id = v_registry.source_campaign_id
      and e.status in ('active','paused')
    limit 1;

    if v_conflict is not null then
      return jsonb_build_object('allowed', false, 'reason', 'duplicate_active_enrollment',
                                'conflictEnrollmentId', v_conflict);
    end if;

    -- 2. exclusive group: no other active enrolment in the same group
    if coalesce(v_exclusive, true) then
      select e.id into v_conflict
      from public.crm_campaign_enrollments e
      join public.crm_campaign_registry r
        on r.engine = 'crm_campaigns'
       and r.source_campaign_id = e.campaign_id
       and r.tenant_id = e.tenant_id
      where e.tenant_id = p_tenant_id
        and e.client_id = p_subject_id
        and e.status = 'active'
        and r.concurrency_group = v_registry.concurrency_group
      limit 1;

      if v_conflict is not null then
        return jsonb_build_object('allowed', false, 'reason', 'concurrency_group_occupied',
                                  'concurrencyGroup', v_registry.concurrency_group,
                                  'conflictEnrollmentId', v_conflict);
      end if;
    end if;

    return jsonb_build_object('allowed', true, 'concurrencyGroup', v_registry.concurrency_group,
                              'exclusive', coalesce(v_exclusive, true));
  end if;

  return jsonb_build_object('allowed', false, 'reason', 'engine_not_supported',
                            'engine', v_registry.engine, 'subjectType', p_subject_type);
end;
$$;

revoke all on function public.crm_evaluate_campaign_concurrency(uuid, uuid, text, uuid) from public;
grant execute on function public.crm_evaluate_campaign_concurrency(uuid, uuid, text, uuid) to authenticated, service_role;

-- ---------- Phase 5: event emission + job enqueue ----------
create or replace function public.crm_enqueue_campaign_trigger_jobs(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_event public.crm_automation_events;
  v_rule public.crm_campaign_trigger_rules;
  v_due timestamptz;
  v_count integer := 0;
begin
  select * into v_event from public.crm_automation_events where id = p_event_id;
  if v_event.id is null then
    return 0;
  end if;

  if not private.crm_control_plane_flag(v_event.tenant_id, 'campaign_trigger_engine_enabled') then
    update public.crm_automation_events
    set processed_at = now()
    where id = p_event_id;
    return 0;
  end if;

  for v_rule in
    select r.* from public.crm_campaign_trigger_rules r
    where r.tenant_id = v_event.tenant_id
      and r.active
      and r.event_type = v_event.event_type
      and v_event.payload @> r.filter_definition
  loop
    if v_rule.required_source_campaign_registry_id is not null then
      if coalesce(v_event.payload->>'campaign_registry_id', '') <> v_rule.required_source_campaign_registry_id::text then
        continue;
      end if;
    end if;

    if v_rule.required_source_outcome is not null then
      if coalesce(v_event.payload->>'outcome', '') <> v_rule.required_source_outcome then
        continue;
      end if;
    end if;

    v_due := v_event.occurred_at + make_interval(
      mins  => case when v_rule.delay_unit = 'minutes' then v_rule.delay_amount else 0 end,
      hours => case when v_rule.delay_unit = 'hours'   then v_rule.delay_amount else 0 end,
      days  => case when v_rule.delay_unit = 'days'    then v_rule.delay_amount else 0 end
    );

    insert into public.crm_campaign_trigger_jobs (
      tenant_id, event_id, trigger_rule_id, person_id, subject_type, subject_id, due_at
    )
    values (
      v_event.tenant_id, v_event.id, v_rule.id, v_event.person_id,
      v_event.subject_type, v_event.subject_id, v_due
    )
    on conflict (event_id, trigger_rule_id) do nothing;

    v_count := v_count + 1;
  end loop;

  update public.crm_automation_events set processed_at = now() where id = p_event_id;
  return v_count;
end;
$$;

revoke all on function public.crm_enqueue_campaign_trigger_jobs(uuid) from public;
grant execute on function public.crm_enqueue_campaign_trigger_jobs(uuid) to service_role;

create or replace function public.crm_emit_automation_event(
  p_tenant_id uuid,
  p_event_type text,
  p_subject_type text,
  p_subject_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_source text default 'database',
  p_source_event_id uuid default null,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_person uuid;
  v_id uuid;
begin
  v_person := private.crm_resolve_person(p_tenant_id, p_subject_type, p_subject_id);

  insert into public.crm_automation_events (
    tenant_id, event_type, person_id, subject_type, subject_id,
    source, source_event_id, idempotency_key, payload, occurred_at
  )
  values (
    p_tenant_id, p_event_type, v_person, p_subject_type, p_subject_id,
    p_source, p_source_event_id, p_idempotency_key, coalesce(p_payload, '{}'::jsonb), p_occurred_at
  )
  on conflict (tenant_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  perform public.crm_enqueue_campaign_trigger_jobs(v_id);
  return v_id;
end;
$$;

revoke all on function public.crm_emit_automation_event(uuid, text, text, uuid, text, jsonb, text, uuid, timestamptz) from public;
grant execute on function public.crm_emit_automation_event(uuid, text, text, uuid, text, jsonb, text, uuid, timestamptz) to service_role;

-- client state changes become automation events (additive, alongside the legacy path)
create or replace function public.crm_emit_client_state_automation_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_event_type text;
begin
  if new.to_value is null then
    return new;
  end if;

  v_event_type := case new.dimension::text
    when 'lifecycle' then 'client.lifecycle_changed'
    when 'engagement' then 'client.engagement_changed'
    else 'client.' || new.dimension::text || '_changed'
  end;

  perform public.crm_emit_automation_event(
    new.tenant_id,
    v_event_type,
    'client',
    new.client_id,
    'client_state_audit:' || new.id::text,
    jsonb_build_object(
      'dimension', new.dimension::text,
      'from_value', new.from_value,
      'to_value', new.to_value,
      'source', new.source
    ),
    'crm_client_state_audit',
    new.id,
    coalesce(new.created_at, now())
  );

  return new;
end;
$$;

drop trigger if exists crm_client_state_automation_event on public.crm_client_state_audit;
create trigger crm_client_state_automation_event
after insert on public.crm_client_state_audit
for each row execute function public.crm_emit_client_state_automation_event();

-- ---------- Phase 5: worker claim + execution ----------
create or replace function public.crm_claim_campaign_trigger_jobs(
  p_worker_id text,
  p_limit integer default 25,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_token uuid := gen_random_uuid();
  v_rows jsonb;
begin
  -- recover stale leases
  update public.crm_campaign_trigger_jobs
  set status = 'pending', claim_token = null, claimed_at = null, updated_at = now()
  where status = 'processing'
    and claimed_at < now() - make_interval(secs => greatest(coalesce(p_lease_seconds, 300), 30));

  with due as (
    select j.id
    from public.crm_campaign_trigger_jobs j
    where j.status = 'pending'
      and j.due_at <= now()
      and j.attempt_count < j.max_attempts
    order by j.due_at
    limit greatest(least(coalesce(p_limit, 25), 200), 1)
    for update skip locked
  )
  update public.crm_campaign_trigger_jobs j
  set status = 'processing',
      claim_token = v_token,
      claimed_at = now(),
      attempt_count = j.attempt_count + 1,
      evaluation_result = j.evaluation_result || jsonb_build_object('claimedBy', p_worker_id),
      updated_at = now()
  from due
  where j.id = due.id
  returning jsonb_build_object('jobId', j.id, 'claimToken', v_token, 'attemptCount', j.attempt_count)
  into v_rows;

  return coalesce((
    select jsonb_agg(jsonb_build_object('jobId', j.id, 'claimToken', j.claim_token, 'attemptCount', j.attempt_count))
    from public.crm_campaign_trigger_jobs j
    where j.claim_token = v_token and j.status = 'processing'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.crm_claim_campaign_trigger_jobs(text, integer, integer) from public;
grant execute on function public.crm_claim_campaign_trigger_jobs(text, integer, integer) to service_role;

create or replace function public.crm_execute_campaign_trigger_job(p_job_id uuid, p_claim_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_job public.crm_campaign_trigger_jobs;
  v_rule public.crm_campaign_trigger_rules;
  v_registry public.crm_campaign_registry;
  v_client public.clients;
  v_current text;
  v_expected text;
  v_concurrency jsonb;
  v_shadow boolean;
  v_enrollment_id uuid;
  v_first_step record;
  v_scheduled timestamptz;
  v_result jsonb;
begin
  select * into v_job from public.crm_campaign_trigger_jobs
  where id = p_job_id and claim_token = p_claim_token and status = 'processing'
  for update;

  if v_job.id is null then
    return jsonb_build_object('ok', false, 'error_code', 'job_not_claimed');
  end if;

  select * into v_rule from public.crm_campaign_trigger_rules where id = v_job.trigger_rule_id;
  select * into v_registry from public.crm_campaign_registry where id = v_rule.campaign_registry_id;

  v_shadow := not private.crm_control_plane_flag(v_job.tenant_id, 'client_trigger_cutover_enabled');

  -- rule / campaign must still be live
  if v_rule.id is null or not v_rule.active or v_registry.id is null or not v_registry.is_active then
    update public.crm_campaign_trigger_jobs
    set status = 'skipped', skip_reason = 'campaign_or_rule_inactive', updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'campaign_or_rule_inactive');
  end if;

  if v_job.subject_type <> 'client' then
    update public.crm_campaign_trigger_jobs
    set status = 'skipped', skip_reason = 'subject_not_supported', updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'subject_not_supported');
  end if;

  select * into v_client from public.clients where id = v_job.subject_id and tenant_id = v_job.tenant_id;
  if v_client.id is null then
    update public.crm_campaign_trigger_jobs
    set status = 'skipped', skip_reason = 'subject_missing', updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'subject_missing');
  end if;

  -- revalidate current state against the originating event
  v_expected := (select e.payload->>'to_value' from public.crm_automation_events e where e.id = v_job.event_id);
  if v_expected is not null then
    select a.to_value into v_current
    from public.crm_client_state_audit a
    where a.client_id = v_job.subject_id
      and a.dimension::text = (select e.payload->>'dimension' from public.crm_automation_events e where e.id = v_job.event_id)
    order by a.created_at desc
    limit 1;

    if v_current is distinct from v_expected then
      update public.crm_campaign_trigger_jobs
      set status = 'skipped', skip_reason = 'state_no_longer_matches',
          evaluation_result = v_job.evaluation_result || jsonb_build_object('expected', v_expected, 'current', v_current),
          updated_at = now()
      where id = v_job.id;
      return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'state_no_longer_matches');
    end if;
  end if;

  -- suppression / eligibility
  if v_client.contact_policy::text = 'do_not_contact' then
    update public.crm_campaign_trigger_jobs
    set status = 'skipped', skip_reason = 'do_not_contact', updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'do_not_contact');
  end if;

  -- participation history: never re-enrol the same subject in the same campaign twice
  if exists (
    select 1 from public.crm_campaign_enrollments e
    where e.tenant_id = v_job.tenant_id
      and e.client_id = v_job.subject_id
      and e.campaign_id = v_registry.source_campaign_id
  ) then
    update public.crm_campaign_trigger_jobs
    set status = 'skipped', skip_reason = 'already_participated', updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'already_participated');
  end if;

  -- concurrency
  v_concurrency := public.crm_evaluate_campaign_concurrency(
    v_job.tenant_id, v_registry.id, 'client', v_job.subject_id
  );

  if not coalesce((v_concurrency->>'allowed')::boolean, false) then
    update public.crm_campaign_trigger_jobs
    set status = 'skipped', skip_reason = coalesce(v_concurrency->>'reason', 'concurrency_blocked'),
        evaluation_result = v_job.evaluation_result || jsonb_build_object('concurrency', v_concurrency),
        updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', coalesce(v_concurrency->>'reason', 'concurrency_blocked'));
  end if;

  -- SHADOW MODE: record the decision, never enrol
  if v_shadow then
    update public.crm_campaign_trigger_jobs
    set status = 'skipped',
        skip_reason = 'shadow_mode',
        evaluation_result = v_job.evaluation_result || jsonb_build_object(
          'shadow', true,
          'wouldEnroll', true,
          'campaignRegistryId', v_registry.id,
          'sourceCampaignId', v_registry.source_campaign_id,
          'evaluatedAt', now()
        ),
        updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'outcome', 'shadow_would_enroll', 'campaignRegistryId', v_registry.id);
  end if;

  -- real enrolment
  insert into public.crm_campaign_enrollments
    (campaign_id, client_id, tenant_id, current_step, status, enrolled_at)
  values
    (v_registry.source_campaign_id, v_job.subject_id, v_job.tenant_id, 0, 'active', now())
  returning id into v_enrollment_id;

  select id, delay_days, delay_hours, channel into v_first_step
  from public.crm_campaign_steps
  where campaign_id = v_registry.source_campaign_id and is_active = true
  order by step_order
  limit 1;

  if v_first_step.id is not null then
    v_scheduled := now()
      + make_interval(days => coalesce(v_first_step.delay_days, 0), hours => coalesce(v_first_step.delay_hours, 0));

    insert into public.crm_campaign_step_logs
      (enrollment_id, step_id, tenant_id, client_id, scheduled_for, status, channel)
    values
      (v_enrollment_id, v_first_step.id, v_job.tenant_id, v_job.subject_id, v_scheduled, 'scheduled', v_first_step.channel);
  end if;

  insert into public.crm_activity_events (tenant_id, client_id, event_type, metadata)
  values (v_job.tenant_id, v_job.subject_id, 'campaign_auto_enrolled', jsonb_build_object(
    'triggered_by', 'campaign_trigger_engine',
    'trigger_rule_id', v_rule.id,
    'campaign_id', v_registry.source_campaign_id,
    'campaign_registry_id', v_registry.id,
    'enrollment_id', v_enrollment_id
  ));

  update public.crm_campaign_trigger_jobs
  set status = 'enrolled',
      engine_enrollment_id = v_enrollment_id,
      evaluation_result = v_job.evaluation_result || jsonb_build_object('enrolledAt', now(), 'concurrency', v_concurrency),
      updated_at = now()
  where id = v_job.id;

  v_result := jsonb_build_object('ok', true, 'outcome', 'enrolled', 'enrollmentId', v_enrollment_id);
  return v_result;
exception when others then
  update public.crm_campaign_trigger_jobs
  set status = case when attempt_count >= max_attempts then 'failed' else 'pending' end,
      claim_token = null,
      claimed_at = null,
      evaluation_result = evaluation_result || jsonb_build_object('lastError', sqlerrm),
      updated_at = now()
  where id = p_job_id;
  return jsonb_build_object('ok', false, 'error_code', 'execution_failed', 'message', sqlerrm);
end;
$$;

revoke all on function public.crm_execute_campaign_trigger_job(uuid, uuid) from public;
grant execute on function public.crm_execute_campaign_trigger_job(uuid, uuid) to service_role;

-- ---------- Phase 8: legacy path stands down after cutover ----------
create or replace function public.crm_process_canonical_campaign_triggers()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_trigger RECORD;
  v_campaign RECORD;
  v_existing UUID;
  v_enrollment_id UUID;
  v_first_step RECORD;
  v_scheduled TIMESTAMPTZ;
BEGIN
  IF NEW.to_value IS NULL THEN
    RETURN NEW;
  END IF;

  -- After cutover the campaign trigger engine owns automatic enrolment.
  IF private.crm_control_plane_flag(NEW.tenant_id, 'client_trigger_cutover_enabled') THEN
    RETURN NEW;
  END IF;

  FOR v_trigger IN
    SELECT ct.*
    FROM public.crm_campaign_triggers ct
    WHERE ct.tenant_id = NEW.tenant_id
      AND ct.is_active = true
      AND ct.is_manual_only = false
      AND ct.trigger_dimension = NEW.dimension
      AND (
        (ct.trigger_operator = 'equals' AND ct.trigger_value = NEW.to_value)
        OR (ct.trigger_operator = 'not_equals' AND ct.trigger_value <> NEW.to_value)
        OR (ct.trigger_operator = 'any')
      )
  LOOP
    SELECT id, is_active INTO v_campaign
    FROM public.crm_campaigns
    WHERE id = v_trigger.campaign_id;

    IF v_campaign.id IS NULL OR v_campaign.is_active = false THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_existing
    FROM public.crm_campaign_enrollments
    WHERE client_id = NEW.client_id
      AND campaign_id = v_trigger.campaign_id
      AND status IN ('active','paused')
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_existing
    FROM public.crm_campaign_enrollments
    WHERE client_id = NEW.client_id AND status = 'active'
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.crm_campaign_enrollments
      (campaign_id, client_id, tenant_id, current_step, status, enrolled_at)
    VALUES
      (v_trigger.campaign_id, NEW.client_id, NEW.tenant_id, 0, 'active', now())
    RETURNING id INTO v_enrollment_id;

    SELECT id, delay_days, delay_hours, channel INTO v_first_step
    FROM public.crm_campaign_steps
    WHERE campaign_id = v_trigger.campaign_id AND is_active = true
    ORDER BY step_order LIMIT 1;

    IF v_first_step.id IS NOT NULL THEN
      v_scheduled := now()
        + (COALESCE(v_first_step.delay_days,0) || ' days')::interval
        + (COALESCE(v_first_step.delay_hours,0) || ' hours')::interval;

      INSERT INTO public.crm_campaign_step_logs
        (enrollment_id, step_id, tenant_id, client_id, scheduled_for, status, channel)
      VALUES
        (v_enrollment_id, v_first_step.id, NEW.tenant_id, NEW.client_id, v_scheduled, 'scheduled', v_first_step.channel);
    END IF;

    INSERT INTO public.crm_activity_events (tenant_id, client_id, event_type, metadata)
    VALUES (NEW.tenant_id, NEW.client_id, 'campaign_auto_enrolled', jsonb_build_object(
      'triggered_by', 'canonical_state_change',
      'campaign_id', v_trigger.campaign_id,
      'enrollment_id', v_enrollment_id
    ));
  END LOOP;

  RETURN NEW;
END;
$function$;

-- ---------- Phase 7: reply correlation ----------
alter table public.crm_email_messages
  add column if not exists enrollment_id uuid,
  add column if not exists step_log_id uuid;

create index if not exists crm_email_messages_enrollment_idx
  on public.crm_email_messages (tenant_id, enrollment_id) where enrollment_id is not null;
create index if not exists crm_email_messages_provider_thread_idx
  on public.crm_email_messages (tenant_id, provider_thread_id) where provider_thread_id is not null;

create or replace function public.crm_correlate_client_email_reply(p_inbound_email_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_inbound public.crm_email_messages;
  v_outbound public.crm_email_messages;
  v_enrollment public.crm_campaign_enrollments;
  v_registry_id uuid;
  v_basis text;
begin
  select * into v_inbound from public.crm_email_messages where id = p_inbound_email_message_id;
  if v_inbound.id is null or v_inbound.direction <> 'inbound' then
    return jsonb_build_object('ok', false, 'error_code', 'inbound_message_not_found');
  end if;

  -- 1. explicit CRM message header
  if v_inbound.in_reply_to_message_id is not null then
    select * into v_outbound from public.crm_email_messages
    where id = v_inbound.in_reply_to_message_id and tenant_id = v_inbound.tenant_id;
    v_basis := 'in_reply_to_message_id';
  end if;

  -- 2. tagged reply-to / crm header captured in metadata
  if v_outbound.id is null and coalesce(v_inbound.metadata->>'crm_email_message_id', '') <> '' then
    select * into v_outbound from public.crm_email_messages
    where tenant_id = v_inbound.tenant_id
      and id = (v_inbound.metadata->>'crm_email_message_id')::uuid;
    v_basis := 'crm_email_message_header';
  end if;

  -- 3. provider thread id
  if v_outbound.id is null and v_inbound.provider_thread_id is not null then
    select * into v_outbound from public.crm_email_messages
    where tenant_id = v_inbound.tenant_id
      and direction = 'outbound'
      and provider_thread_id = v_inbound.provider_thread_id
      and enrollment_id is not null
    order by occurred_at desc
    limit 1;
    v_basis := 'provider_thread_id';
  end if;

  if v_outbound.id is null or v_outbound.enrollment_id is null then
    insert into public.crm_activity_events (tenant_id, client_id, event_type, metadata)
    values (v_inbound.tenant_id, v_inbound.client_id, 'email_reply_uncorrelated', jsonb_build_object(
      'inbound_email_message_id', v_inbound.id
    ));
    return jsonb_build_object('ok', true, 'correlated', false, 'reason', 'no_campaign_correlation');
  end if;

  select * into v_enrollment from public.crm_campaign_enrollments where id = v_outbound.enrollment_id;
  if v_enrollment.id is null or v_enrollment.status not in ('active','paused') then
    return jsonb_build_object('ok', true, 'correlated', false, 'reason', 'enrollment_not_open');
  end if;

  update public.crm_campaign_enrollments
  set status = 'responded', completed_at = now(), updated_at = now()
  where id = v_enrollment.id;

  update public.crm_campaign_step_logs
  set status = 'skipped', skip_reason = 'client_responded', updated_at = now()
  where enrollment_id = v_enrollment.id and status = 'scheduled';

  select r.id into v_registry_id from public.crm_campaign_registry r
  where r.tenant_id = v_enrollment.tenant_id
    and r.engine = 'crm_campaigns'
    and r.source_campaign_id = v_enrollment.campaign_id;

  insert into public.crm_activity_events (tenant_id, client_id, event_type, metadata)
  values (v_enrollment.tenant_id, v_enrollment.client_id, 'campaign_enrollment_responded', jsonb_build_object(
    'enrollment_id', v_enrollment.id,
    'campaign_id', v_enrollment.campaign_id,
    'correlation_basis', v_basis,
    'inbound_email_message_id', v_inbound.id
  ));

  return jsonb_build_object('ok', true, 'correlated', true, 'enrollmentId', v_enrollment.id,
                            'campaignRegistryId', v_registry_id, 'basis', v_basis);
end;
$$;

revoke all on function public.crm_correlate_client_email_reply(uuid) from public;
grant execute on function public.crm_correlate_client_email_reply(uuid) to service_role;

-- ---------- Phase 9: completion outcome events ----------
create or replace function public.crm_emit_campaign_outcome_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_outcome text;
  v_registry_id uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_outcome := case new.status
    when 'completed' then 'campaign.completed'
    when 'responded' then 'campaign.responded'
    when 'no_response' then 'campaign.no_response'
    when 'interested' then 'campaign.interested'
    when 'suppressed' then 'campaign.suppressed'
    when 'failed' then 'campaign.failed'
    when 'cancelled' then 'campaign.manually_stopped'
    when 'stopped' then 'campaign.manually_stopped'
    else null
  end;

  if v_outcome is null then
    return new;
  end if;

  select r.id into v_registry_id from public.crm_campaign_registry r
  where r.tenant_id = new.tenant_id
    and r.engine = 'crm_campaigns'
    and r.source_campaign_id = new.campaign_id;

  perform public.crm_emit_automation_event(
    new.tenant_id,
    v_outcome,
    'client',
    new.client_id,
    'campaign_enrollment_outcome:' || new.id::text || ':' || new.status,
    jsonb_build_object(
      'campaign_registry_id', v_registry_id,
      'engine_enrollment_id', new.id,
      'campaign_id', new.campaign_id,
      'outcome', replace(v_outcome, 'campaign.', ''),
      'started_at', new.enrolled_at,
      'ended_at', coalesce(new.completed_at, now())
    ),
    'crm_campaign_enrollments',
    new.id,
    now()
  );

  return new;
end;
$$;

drop trigger if exists crm_campaign_enrollment_outcome_event on public.crm_campaign_enrollments;
create trigger crm_campaign_enrollment_outcome_event
after update of status on public.crm_campaign_enrollments
for each row execute function public.crm_emit_campaign_outcome_event();

-- ---------- Operator surface ----------
create or replace function public.crm_list_campaign_trigger_rules()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(false);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'campaignRegistryId', r.campaign_registry_id,
      'campaignName', reg.name,
      'campaignDomain', reg.campaign_domain,
      'concurrencyGroup', reg.concurrency_group,
      'eventType', r.event_type,
      'filterDefinition', r.filter_definition,
      'delayAmount', r.delay_amount,
      'delayUnit', r.delay_unit,
      'requiredSourceCampaignRegistryId', r.required_source_campaign_registry_id,
      'requiredSourceOutcome', r.required_source_outcome,
      'active', r.active,
      'version', r.version,
      'updatedAt', r.updated_at
    ) order by reg.name, r.event_type)
    from public.crm_campaign_trigger_rules r
    join public.crm_campaign_registry reg on reg.id = r.campaign_registry_id
    where r.tenant_id = v_tenant
  ), '[]'::jsonb);
end;
$$;

create or replace function public.crm_upsert_campaign_trigger_rule(
  p_rule_id uuid,
  p_campaign_registry_id uuid,
  p_event_type text,
  p_filter_definition jsonb,
  p_delay_amount integer,
  p_delay_unit text,
  p_required_source_campaign_registry_id uuid,
  p_required_source_outcome text,
  p_active boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_actor uuid := (v_context->>'actor_id')::uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  if v_reason is null then
    raise exception 'A reason is required to change a campaign trigger rule.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.crm_campaign_registry
    where id = p_campaign_registry_id and tenant_id = v_tenant
  ) then
    raise exception 'Unknown campaign.' using errcode = '22023';
  end if;

  if p_rule_id is null then
    insert into public.crm_campaign_trigger_rules (
      tenant_id, campaign_registry_id, event_type, filter_definition, delay_amount, delay_unit,
      required_source_campaign_registry_id, required_source_outcome, active, created_by_profile_id
    )
    values (
      v_tenant, p_campaign_registry_id, p_event_type, coalesce(p_filter_definition, '{}'::jsonb),
      coalesce(p_delay_amount, 0), coalesce(p_delay_unit, 'minutes'),
      p_required_source_campaign_registry_id, p_required_source_outcome,
      coalesce(p_active, false), v_actor
    )
    returning id into v_id;
  else
    update public.crm_campaign_trigger_rules
    set campaign_registry_id = p_campaign_registry_id,
        event_type = p_event_type,
        filter_definition = coalesce(p_filter_definition, '{}'::jsonb),
        delay_amount = coalesce(p_delay_amount, 0),
        delay_unit = coalesce(p_delay_unit, 'minutes'),
        required_source_campaign_registry_id = p_required_source_campaign_registry_id,
        required_source_outcome = p_required_source_outcome,
        active = coalesce(p_active, false),
        version = version + 1
    where id = p_rule_id and tenant_id = v_tenant
    returning id into v_id;

    if v_id is null then
      raise exception 'Unknown campaign trigger rule.' using errcode = '22023';
    end if;
  end if;

  insert into public.crm_activity_events (tenant_id, client_id, event_type, created_by_profile_id, metadata)
  values (v_tenant, null, 'campaign_trigger_rule_changed', v_actor, jsonb_build_object(
    'rule_id', v_id, 'campaign_registry_id', p_campaign_registry_id,
    'event_type', p_event_type, 'active', coalesce(p_active, false), 'reason', v_reason
  ));

  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.crm_campaign_trigger_shadow_report(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(false);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
begin
  return jsonb_build_object(
    'summary', coalesce((
      select jsonb_agg(jsonb_build_object('status', s.status, 'skipReason', s.skip_reason, 'count', s.count))
      from (
        select j.status, j.skip_reason, count(*) as count
        from public.crm_campaign_trigger_jobs j
        where j.tenant_id = v_tenant
        group by j.status, j.skip_reason
      ) s
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'jobId', j.id,
        'eventType', e.event_type,
        'subjectType', j.subject_type,
        'subjectId', j.subject_id,
        'campaignName', reg.name,
        'status', j.status,
        'skipReason', j.skip_reason,
        'dueAt', j.due_at,
        'wouldEnroll', coalesce((j.evaluation_result->>'wouldEnroll')::boolean, false),
        'enrollmentId', j.engine_enrollment_id,
        'createdAt', j.created_at
      ) order by j.created_at desc)
      from (
        select * from public.crm_campaign_trigger_jobs
        where tenant_id = v_tenant
        order by created_at desc
        limit greatest(least(coalesce(p_limit, 100), 500), 1)
      ) j
      join public.crm_campaign_trigger_rules r on r.id = j.trigger_rule_id
      join public.crm_campaign_registry reg on reg.id = r.campaign_registry_id
      join public.crm_automation_events e on e.id = j.event_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.crm_list_campaign_trigger_rules() from public;
revoke all on function public.crm_upsert_campaign_trigger_rule(uuid, uuid, text, jsonb, integer, text, uuid, text, boolean, text) from public;
revoke all on function public.crm_campaign_trigger_shadow_report(integer) from public;
grant execute on function public.crm_list_campaign_trigger_rules() to authenticated;
grant execute on function public.crm_upsert_campaign_trigger_rule(uuid, uuid, text, jsonb, integer, text, uuid, text, boolean, text) to authenticated;
grant execute on function public.crm_campaign_trigger_shadow_report(integer) to authenticated;

drop trigger if exists crm_campaign_trigger_rules_touch on public.crm_campaign_trigger_rules;
drop trigger if exists crm_campaign_trigger_jobs_touch on public.crm_campaign_trigger_jobs;
create trigger crm_campaign_trigger_jobs_touch before update on public.crm_campaign_trigger_jobs
for each row execute function public.crm_touch_updated_at();
create trigger crm_campaign_concurrency_groups_touch before update on public.crm_campaign_concurrency_groups
for each row execute function public.crm_touch_updated_at();