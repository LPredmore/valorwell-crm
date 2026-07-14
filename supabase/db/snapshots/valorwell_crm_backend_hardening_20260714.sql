
-- ValorWell CRM backend corrective hardening — consolidated final-state migration
-- Target baseline: ValorWell shared Supabase project ahqauomkgflopxgnlndd
-- Contract: valorwell-crm-contracts@1.0.1+20260714
-- Prepared: 2026-07-14
--
-- IMPORTANT:
--   * These changes have ALREADY been applied to the live project.
--   * Keep this file for source control, rebuilds, or a matching non-production environment.
--   * Do NOT paste this entire file into the same live project unless you are intentionally
--     reconciling drift and have reviewed current dependencies/backups.
--   * Edge Function TypeScript is packaged separately; SQL cannot deploy those functions.

begin;

create schema if not exists private;


-- ---------------------------------------------------------------------------
-- 0. Authoritative CRM tenant-role helpers
-- ---------------------------------------------------------------------------
-- tenant_memberships proves tenant membership; user_roles is the authoritative
-- application role source (admin/staff/client).
create or replace function public.crm_has_role(
  _user_id uuid,
  _roles text[],
  _tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _user_id = auth.uid()
     and exists (
       select 1
       from public.tenant_memberships tm
       join public.user_roles ur on ur.user_id = tm.profile_id
       where tm.profile_id = _user_id
         and tm.tenant_id = _tenant_id
         and ur.role::text = any(_roles)
     )
$$;

create or replace function public.crm_has_role(
  _user_id uuid,
  _tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.crm_has_role(_user_id,array['admin','staff'],_tenant_id)
$$;

revoke all on function public.crm_has_role(uuid,text[],uuid) from public,anon;
revoke all on function public.crm_has_role(uuid,uuid) from public,anon;
grant execute on function public.crm_has_role(uuid,text[],uuid) to authenticated,service_role;
grant execute on function public.crm_has_role(uuid,uuid) to authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 1. Campaign step claim/recovery model
-- ---------------------------------------------------------------------------
alter table public.crm_campaign_step_logs
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_token uuid,
  add column if not exists claim_attempts integer not null default 0;

alter table public.crm_campaign_step_logs
  drop constraint if exists crm_campaign_step_logs_status_check;

alter table public.crm_campaign_step_logs
  add constraint crm_campaign_step_logs_status_check
  check (status = any (array[
    'scheduled'::text,
    'processing'::text,
    'sent'::text,
    'failed'::text,
    'cancelled'::text,
    'skipped'::text,
    'suppressed'::text
  ]));

create index if not exists crm_campaign_step_logs_processing_recovery_idx
  on public.crm_campaign_step_logs (claimed_at)
  where status = 'processing';

drop function if exists public.claim_pending_campaign_steps(integer);

create function public.claim_pending_campaign_steps(p_limit integer default 50)
returns table(
  id uuid,
  enrollment_id uuid,
  step_id uuid,
  tenant_id uuid,
  client_id uuid,
  scheduled_for timestamptz,
  channel text,
  claim_token uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Recover stale claims. A 30-minute lease is deliberately longer than the
  -- expected execution window and prevents permanently stranded rows.
  update public.crm_campaign_step_logs
     set status = 'scheduled',
         claimed_at = null,
         claim_token = null,
         updated_at = now(),
         skip_reason = coalesce(skip_reason, 'stale_claim_recovered')
   where status = 'processing'
     and claimed_at is not null
     and claimed_at < now() - interval '30 minutes';

  return query
  with candidates as (
    select l.id
      from public.crm_campaign_step_logs l
     where l.status = 'scheduled'
       and l.scheduled_for <= now()
     order by l.scheduled_for asc
     limit greatest(coalesce(p_limit, 50), 1)
     for update skip locked
  ),
  claimed as (
    update public.crm_campaign_step_logs l
       set status = 'processing',
           claimed_at = now(),
           claim_token = gen_random_uuid(),
           claim_attempts = l.claim_attempts + 1,
           updated_at = now()
      from candidates c
     where l.id = c.id
     returning l.id, l.enrollment_id, l.step_id, l.tenant_id, l.client_id,
               l.scheduled_for, l.channel, l.claim_token
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_pending_campaign_steps(integer)
  from public, anon, authenticated;
grant execute on function public.claim_pending_campaign_steps(integer)
  to service_role;

create or replace function public.release_campaign_step_claim(
  p_step_log_id uuid,
  p_claim_token uuid,
  p_status text,
  p_reason text default null,
  p_next_scheduled_for timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('scheduled','failed','skipped','suppressed','cancelled') then
    raise exception 'invalid release status' using errcode = '22023';
  end if;

  update public.crm_campaign_step_logs
     set status = p_status,
         skip_reason = case when p_status in ('skipped','suppressed') then p_reason else skip_reason end,
         error_message = case when p_status = 'failed' then p_reason else error_message end,
         scheduled_for = coalesce(p_next_scheduled_for, scheduled_for),
         claimed_at = null,
         claim_token = null,
         updated_at = now()
   where id = p_step_log_id
     and status = 'processing'
     and claim_token = p_claim_token;

  return found;
end;
$$;

revoke all on function public.release_campaign_step_claim(uuid,uuid,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.release_campaign_step_claim(uuid,uuid,text,text,timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. CRM contract version + idempotency infrastructure
-- ---------------------------------------------------------------------------
create or replace function private.crm_contract_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'valorwell-crm-contracts@1.0.1+20260714'::text
$$;

revoke all on function private.crm_contract_version() from public, anon, authenticated;

alter table public.crm_idempotency_keys
  add column if not exists tenant_id uuid,
  add column if not exists target_id uuid,
  add column if not exists action_key text,
  add column if not exists status text not null default 'completed',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists crm_idempotency_scope_uidx
  on public.crm_idempotency_keys
  (tenant_id, actor_id, operation, target_id, action_key)
  where tenant_id is not null
    and actor_id is not null
    and target_id is not null
    and action_key is not null;

create or replace function private.crm_idempotency_begin(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_operation text,
  p_target_id uuid,
  p_action_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope_key text;
  v_inserted integer;
  v_existing record;
begin
  if p_action_key is null or btrim(p_action_key) = '' then
    return jsonb_build_object(
      'proceed', false,
      'result', jsonb_build_object(
        'ok', false,
        'error_code', 'invalid_transition',
        'message', 'idempotency_key_required'
      )
    );
  end if;

  delete from public.crm_idempotency_keys where expires_at < now();

  v_scope_key := md5(concat_ws('|',
    p_tenant_id::text,
    p_actor_id::text,
    p_operation,
    p_target_id::text,
    p_action_key
  ));

  insert into public.crm_idempotency_keys(
    key, tenant_id, actor_id, operation, target_id, action_key,
    status, result_json, expires_at, created_at, updated_at
  )
  values(
    v_scope_key, p_tenant_id, p_actor_id, p_operation, p_target_id, p_action_key,
    'processing', null, now() + interval '24 hours', now(), now()
  )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    return jsonb_build_object('proceed', true, 'scope_key', v_scope_key);
  end if;

  select status, result_json
    into v_existing
    from public.crm_idempotency_keys
   where tenant_id = p_tenant_id
     and actor_id = p_actor_id
     and operation = p_operation
     and target_id = p_target_id
     and action_key = p_action_key;

  if v_existing.result_json is not null then
    return jsonb_build_object('proceed', false, 'result', v_existing.result_json);
  end if;

  return jsonb_build_object(
    'proceed', false,
    'result', jsonb_build_object(
      'ok', false,
      'error_code', 'unknown',
      'message', 'operation_in_progress'
    )
  );
end;
$$;

create or replace function private.crm_idempotency_complete(
  p_scope_key text,
  p_result jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.crm_idempotency_keys
     set status = 'completed',
         result_json = p_result,
         updated_at = now()
   where key = p_scope_key
$$;

revoke all on function private.crm_idempotency_begin(uuid,uuid,text,uuid,text)
  from public, anon, authenticated;
revoke all on function private.crm_idempotency_complete(text,jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Manual eligibility-review persistence
-- ---------------------------------------------------------------------------
create table if not exists public.crm_eligibility_manual_reviews (
  client_id uuid primary key references public.clients(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reason text,
  owner text not null,
  next_action text not null,
  review_due_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

alter table public.crm_eligibility_manual_reviews enable row level security;

revoke all on public.crm_eligibility_manual_reviews from public, anon, authenticated;
grant select on public.crm_eligibility_manual_reviews to authenticated;
grant all on public.crm_eligibility_manual_reviews to service_role;

drop policy if exists crm_eligibility_manual_reviews_select_tenant
  on public.crm_eligibility_manual_reviews;

create policy crm_eligibility_manual_reviews_select_tenant
  on public.crm_eligibility_manual_reviews
  for select to authenticated
  using (
    tenant_id in (
      select tm.tenant_id
      from public.tenant_memberships tm
      where tm.profile_id = auth.uid()
    )
  );


-- ---------------------------------------------------------------------------
-- 3A. Canonical write-guard alignment for the CRM contract engine
-- ---------------------------------------------------------------------------
-- The pre-existing clients trigger blocks protected-state writes unless an
-- approved workflow context is present. This replacement preserves the
-- registration/intake/appointment/admin/service pathways and adds the
-- authenticated CRM contract context used by the mutation engine below.
create or replace function public.enforce_canonical_client_state_write()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_source text := nullif(current_setting('valorwell.client_state_source',true),'');
  v_reason text := nullif(current_setting('valorwell.client_state_reason',true),'');
  v_engine text := nullif(current_setting('valorwell.client_state_engine',true),'');
  v_selection_engine text := nullif(current_setting('valorwell.therapist_selection_engine',true),'');
  v_registration_engine text := nullif(current_setting('valorwell.registration_workflow',true),'');
  v_intake_engine text := nullif(current_setting('valorwell.intake_readiness_workflow',true),'');
  v_booking_engine text := nullif(current_setting('valorwell.appointment_booking_engine',true),'');
  v_actor_id uuid := nullif(current_setting('valorwell.client_state_actor_id',true),'')::uuid;
  v_request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',
    nullif(nullif(current_setting('role',true),''),'none')
  );
begin
  if not (
    old.lifecycle_stage is distinct from new.lifecycle_stage or
    old.engagement_state is distinct from new.engagement_state or
    old.at_risk is distinct from new.at_risk or
    old.eligibility_state is distinct from new.eligibility_state or
    old.contact_policy is distinct from new.contact_policy or
    old.service_policy is distinct from new.service_policy or
    old.closure_reason is distinct from new.closure_reason or
    old.care_cadence is distinct from new.care_cadence
  ) then
    return new;
  end if;

  if current_user in ('postgres','supabase_admin')
     and v_request_role is null
     and auth.uid() is null
     and v_source = 'migration_backfill' then
    return new;
  end if;

  if v_engine is distinct from 'on' then
    raise exception 'Canonical client state must be changed through an approved transition function'
      using errcode = '42501';
  end if;

  if v_source = 'crm_contract'
     and auth.uid() is not null
     and v_actor_id = auth.uid()
     and nullif(btrim(v_reason),'') is not null
     and public.crm_has_role(auth.uid(),array['admin','staff'],new.tenant_id) then
    return new;
  end if;

  if v_source = 'therapist_selection'
     and v_selection_engine = 'on'
     and auth.uid() is not null
     and v_actor_id = auth.uid() then
    return new;
  end if;

  if v_source = 'registration_flow'
     and v_registration_engine = 'on'
     and old.lifecycle_stage::text = 'registration'
     and new.lifecycle_stage::text = 'intake'
     and auth.uid() is not null
     and v_actor_id = auth.uid()
     and (
       old.profile_id = auth.uid()
       or public.has_role(auth.uid(),'admin'::public.app_role)
     ) then
    return new;
  end if;

  if v_source = 'intake_flow'
     and v_intake_engine = 'on'
     and old.lifecycle_stage::text = 'intake'
     and new.lifecycle_stage::text = 'matching'
     and auth.uid() is not null
     and v_actor_id = auth.uid()
     and (
       old.profile_id = auth.uid()
       or public.has_role(auth.uid(),'admin'::public.app_role)
     ) then
    return new;
  end if;

  if v_source = 'appointment_trigger'
     and v_booking_engine = 'on'
     and auth.uid() is not null
     and v_actor_id = auth.uid() then
    return new;
  end if;

  if v_request_role = 'service_role' or current_user = 'service_role' then
    if v_source is null
       or (v_source = 'admin_override_correction' and v_actor_id is null) then
      raise exception 'Automated client-state transitions require source context and admin overrides require an actor'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if auth.uid() is null
     or not public.has_role(auth.uid(),'admin'::public.app_role)
     or v_source is distinct from 'admin_override_correction'
     or nullif(btrim(v_reason),'') is null
     or v_actor_id is distinct from auth.uid() then
    raise exception 'Admin canonical client-state changes require the approved override workflow, actor, and reason'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3B. Activity-event taxonomy required by the canonical RPCs and senders
-- ---------------------------------------------------------------------------
alter table public.crm_activity_events
  drop constraint if exists crm_activity_events_event_type_check;

alter table public.crm_activity_events
  add constraint crm_activity_events_event_type_check
  check (event_type = any (array[
    'status_change'::text,
    'note_added'::text,
    'email_sent'::text,
    'email_received'::text,
    'email_suppressed'::text,
    'sms_sent'::text,
    'sms_received'::text,
    'sms_suppressed'::text,
    'conversation_linked'::text,
    'bulk_send'::text,
    'campaign_auto_cancelled'::text,
    'campaign_auto_enrolled'::text,
    'campaign_enrolled'::text,
    'campaign_cancelled_by_policy'::text,
    'campaign_completion_state_action_deferred'::text,
    'client_synced_to_clickup'::text,
    'lifecycle_changed'::text,
    'engagement_changed'::text,
    'contact_policy_changed'::text,
    'service_policy_changed'::text,
    'eligibility_changed'::text,
    'care_cadence_changed'::text,
    'clinician_assigned'::text,
    'closed'::text,
    'reopened'::text
  ]));


-- ---------------------------------------------------------------------------
-- 4. One internal mutation engine for the nine public RPCs
-- ---------------------------------------------------------------------------
create or replace function private.crm_mutate_client_impl(
  p_operation text,
  p_client_id uuid,
  p_text_value text,
  p_uuid_value uuid,
  p_json_value jsonb,
  p_reason text,
  p_disposition_reason text,
  p_concurrency_token text,
  p_idempotency_key uuid,
  p_contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_client public.clients%rowtype;
  v_current_token text;
  v_idem jsonb;
  v_scope_key text;
  v_result jsonb;
  v_to_lifecycle public.client_lifecycle_stage_enum;
  v_to_engagement public.client_engagement_state_enum;
  v_to_contact public.client_contact_policy_enum;
  v_to_service public.client_service_policy_enum;
  v_to_eligibility public.client_eligibility_state_enum;
  v_to_cadence public.client_care_cadence_enum;
  v_to_closure public.client_closure_reason_enum;
  v_prior_lifecycle public.client_lifecycle_stage_enum;
  v_staff_tenant uuid;
  v_allowed boolean := false;
  v_enrollment record;
begin
  if p_contract_version is distinct from private.crm_contract_version() then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'contract_version_mismatch',
      'message', private.crm_contract_version()
    );
  end if;

  if v_actor is null then
    return jsonb_build_object('ok', false, 'error_code', 'unauthorized');
  end if;

  if p_idempotency_key is null then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'invalid_transition',
      'message', 'idempotency_key_required'
    );
  end if;

  if p_concurrency_token is null
     or btrim(p_concurrency_token) = ''
     or lower(p_concurrency_token) = 'auto' then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'concurrency_conflict',
      'message', 'exact_concurrency_token_required'
    );
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'invalid_transition',
      'message', 'reason_required'
    );
  end if;

  select *
    into v_client
    from public.clients
   where id = p_client_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'unauthorized');
  end if;

  if not public.crm_has_role(
    v_actor,
    array['admin','staff'],
    v_client.tenant_id
  ) then
    return jsonb_build_object('ok', false, 'error_code', 'unauthorized');
  end if;

  select coalesce(
           m.concurrency_token::text,
           md5(v_client.id::text || coalesce(v_client.updated_at::text, ''))
         )
    into v_current_token
    from public.crm_client_canonical_meta m
   where m.client_id = v_client.id
     and m.tenant_id = v_client.tenant_id;

  if v_current_token is null then
    v_current_token := md5(v_client.id::text || coalesce(v_client.updated_at::text, ''));
  end if;

  if v_current_token <> p_concurrency_token then
    return jsonb_build_object('ok', false, 'error_code', 'concurrency_conflict');
  end if;

  v_idem := private.crm_idempotency_begin(
    v_client.tenant_id,
    v_actor,
    p_operation,
    p_client_id,
    p_idempotency_key::text
  );

  if not coalesce((v_idem->>'proceed')::boolean, false) then
    return v_idem->'result';
  end if;

  v_scope_key := v_idem->>'scope_key';

  if p_operation = 'crm_transition_lifecycle' then
    v_to_lifecycle := public._crm_lifecycle_from_label(p_text_value);
    if v_to_lifecycle is null then
      v_result := jsonb_build_object(
        'ok', false, 'error_code', 'invalid_transition', 'message', 'unknown_stage'
      );
    elsif v_to_lifecycle = v_client.lifecycle_stage then
      v_result := jsonb_build_object('ok', true);
    else
      v_allowed := case v_client.lifecycle_stage
        when 'registration' then v_to_lifecycle in ('intake','closed')
        when 'intake' then v_to_lifecycle in ('registration','matching','closed')
        when 'matching' then v_to_lifecycle in ('intake','matched','closed')
        when 'matched' then v_to_lifecycle in ('matching','scheduled','closed')
        when 'scheduled' then v_to_lifecycle in ('matched','early_care','closed')
        when 'early_care' then v_to_lifecycle in ('scheduled','established_care','closed')
        when 'established_care' then v_to_lifecycle in ('early_care','closed')
        when 'closed' then false
        else false
      end;

      if not v_allowed then
        v_result := jsonb_build_object(
          'ok', false,
          'error_code', 'invalid_transition',
          'message', v_client.lifecycle_stage::text || '→' || v_to_lifecycle::text || ' not allowed'
        );
      else
        if v_to_lifecycle = 'closed' then
          v_to_closure := public._crm_closure_from_label(p_disposition_reason);
          if v_to_closure is null then
            v_result := jsonb_build_object(
              'ok', false,
              'error_code', 'invalid_transition',
              'message', 'disposition_reason_required'
            );
          end if;
        end if;

        if v_result is null then
          update public.clients
             set lifecycle_stage = v_to_lifecycle,
                 lifecycle_stage_changed_at = now(),
                 closure_reason = case when v_to_lifecycle = 'closed' then v_to_closure else closure_reason end,
                 closed_at = case when v_to_lifecycle = 'closed' then now() else closed_at end,
                 updated_at = now()
           where id = p_client_id;

          perform public._crm_emit_state_change(
            v_client.tenant_id, p_client_id,
            'lifecycle_stage'::public.client_state_dimension_enum,
            v_client.lifecycle_stage::text, v_to_lifecycle::text,
            p_reason, p_disposition_reason, v_actor, p_idempotency_key,
            'lifecycle_changed'
          );
          perform public._crm_bump_token(p_client_id, v_client.tenant_id);
          v_result := jsonb_build_object('ok', true);
        end if;
      end if;
    end if;

  elsif p_operation = 'crm_set_engagement' then
    v_to_engagement := public._crm_engagement_from_label(p_text_value);
    if v_to_engagement is null then
      v_result := jsonb_build_object('ok',false,'error_code','invalid_transition','message','unknown_state');
    elsif v_to_engagement = v_client.engagement_state then
      v_result := jsonb_build_object('ok',true);
    else
      update public.clients
         set engagement_state = v_to_engagement,
             engagement_state_changed_at = now(),
             updated_at = now()
       where id = p_client_id;
      perform public._crm_emit_state_change(
        v_client.tenant_id,p_client_id,
        'engagement_state'::public.client_state_dimension_enum,
        v_client.engagement_state::text,v_to_engagement::text,
        p_reason,null,v_actor,p_idempotency_key,'engagement_changed'
      );
      perform public._crm_bump_token(p_client_id,v_client.tenant_id);
      v_result := jsonb_build_object('ok',true);
    end if;

  elsif p_operation = 'crm_set_contact_policy' then
    v_to_contact := public._crm_contact_policy_from_label(p_text_value);
    if v_to_contact is null then
      v_result := jsonb_build_object('ok',false,'error_code','invalid_transition','message','unknown_policy');
    elsif v_to_contact = v_client.contact_policy then
      v_result := jsonb_build_object('ok',true);
    else
      update public.clients
         set contact_policy = v_to_contact,
             contact_policy_changed_at = now(),
             updated_at = now()
       where id = p_client_id;
      perform public._crm_emit_state_change(
        v_client.tenant_id,p_client_id,
        'contact_policy'::public.client_state_dimension_enum,
        v_client.contact_policy::text,v_to_contact::text,
        p_reason,null,v_actor,p_idempotency_key,'contact_policy_changed'
      );

      if v_to_contact = 'do_not_contact' then
        for v_enrollment in
          select id
          from public.crm_campaign_enrollments
          where tenant_id = v_client.tenant_id
            and client_id = p_client_id
            and status = 'active'
          for update
        loop
          update public.crm_campaign_enrollments
             set status = 'cancelled',
                 pause_reason = 'DNC set via crm_set_contact_policy',
                 updated_at = now()
           where id = v_enrollment.id;

          insert into public.crm_activity_events(
            tenant_id,client_id,event_type,old_value,new_value,metadata,created_by_profile_id
          )
          values(
            v_client.tenant_id,p_client_id,'campaign_cancelled_by_policy',
            'active','cancelled',
            jsonb_build_object(
              'enrollment_id',v_enrollment.id,
              'reason','DNC',
              'correlation_id',p_idempotency_key
            ),
            v_actor
          );
        end loop;
      end if;

      perform public._crm_bump_token(p_client_id,v_client.tenant_id);
      v_result := jsonb_build_object('ok',true);
    end if;

  elsif p_operation = 'crm_set_service_policy' then
    v_to_service := public._crm_service_policy_from_label(p_text_value);
    if v_to_service is null then
      v_result := jsonb_build_object('ok',false,'error_code','invalid_transition','message','unknown_policy');
    elsif v_to_service = v_client.service_policy then
      v_result := jsonb_build_object('ok',true);
    else
      update public.clients
         set service_policy = v_to_service,
             service_policy_changed_at = now(),
             updated_at = now()
       where id = p_client_id;
      perform public._crm_emit_state_change(
        v_client.tenant_id,p_client_id,
        'service_policy'::public.client_state_dimension_enum,
        v_client.service_policy::text,v_to_service::text,
        p_reason,null,v_actor,p_idempotency_key,'service_policy_changed'
      );
      perform public._crm_bump_token(p_client_id,v_client.tenant_id);
      v_result := jsonb_build_object('ok',true);
    end if;

  elsif p_operation = 'crm_set_eligibility' then
    v_to_eligibility := public._crm_eligibility_from_label(p_text_value);
    if v_to_eligibility is null then
      v_result := jsonb_build_object('ok',false,'error_code','invalid_transition','message','unknown_state');
    elsif v_to_eligibility = 'manual_review'
      and (
        p_json_value is null
        or not (p_json_value ? 'owner')
        or not (p_json_value ? 'next_action')
        or not (p_json_value ? 'review_due_at')
      ) then
      v_result := jsonb_build_object(
        'ok',false,'error_code','invalid_transition','message','manual_review_payload_required'
      );
    else
      update public.clients
         set eligibility_state = v_to_eligibility,
             eligibility_state_changed_at = case
               when v_to_eligibility is distinct from v_client.eligibility_state then now()
               else eligibility_state_changed_at
             end,
             updated_at = now()
       where id = p_client_id;

      if v_to_eligibility = 'manual_review' then
        insert into public.crm_eligibility_manual_reviews(
          client_id,tenant_id,reason,owner,next_action,review_due_at,
          active,created_at,updated_at,closed_at
        )
        values(
          p_client_id,v_client.tenant_id,
          coalesce(nullif(p_json_value->>'reason',''),p_reason),
          p_json_value->>'owner',
          p_json_value->>'next_action',
          (p_json_value->>'review_due_at')::timestamptz,
          true,now(),now(),null
        )
        on conflict (client_id) do update
          set reason = excluded.reason,
              owner = excluded.owner,
              next_action = excluded.next_action,
              review_due_at = excluded.review_due_at,
              active = true,
              updated_at = now(),
              closed_at = null;
      else
        update public.crm_eligibility_manual_reviews
           set active = false,
               closed_at = coalesce(closed_at,now()),
               updated_at = now()
         where client_id = p_client_id
           and active;
      end if;

      if v_to_eligibility is distinct from v_client.eligibility_state then
        perform public._crm_emit_state_change(
          v_client.tenant_id,p_client_id,
          'eligibility_state'::public.client_state_dimension_enum,
          v_client.eligibility_state::text,v_to_eligibility::text,
          p_reason,null,v_actor,p_idempotency_key,'eligibility_changed'
        );
        perform public._crm_bump_token(p_client_id,v_client.tenant_id);
      end if;
      v_result := jsonb_build_object('ok',true);
    end if;

  elsif p_operation = 'crm_set_care_cadence' then
    v_to_cadence := public._crm_cadence_from_label(p_text_value);
    if v_to_cadence is null then
      v_result := jsonb_build_object('ok',false,'error_code','invalid_transition','message','unknown_cadence');
    elsif v_to_cadence = v_client.care_cadence then
      v_result := jsonb_build_object('ok',true);
    else
      update public.clients
         set care_cadence = v_to_cadence,
             care_cadence_changed_at = now(),
             updated_at = now()
       where id = p_client_id;
      perform public._crm_emit_state_change(
        v_client.tenant_id,p_client_id,
        'care_cadence'::public.client_state_dimension_enum,
        v_client.care_cadence::text,v_to_cadence::text,
        p_reason,null,v_actor,p_idempotency_key,'care_cadence_changed'
      );
      perform public._crm_bump_token(p_client_id,v_client.tenant_id);
      v_result := jsonb_build_object('ok',true);
    end if;

  elsif p_operation = 'crm_assign_clinician' then
    select s.tenant_id
      into v_staff_tenant
      from public.staff s
     where s.id = p_uuid_value
       and s.prov_status::text = 'Active';

    if v_staff_tenant is null or v_staff_tenant <> v_client.tenant_id then
      v_result := jsonb_build_object(
        'ok',false,'error_code','invalid_transition','message','staff_not_in_tenant'
      );
    elsif p_uuid_value = v_client.primary_staff_id then
      v_result := jsonb_build_object('ok',true);
    else
      update public.clients
         set primary_staff_id = p_uuid_value,
             updated_at = now()
       where id = p_client_id;

      insert into public.crm_activity_events(
        tenant_id,client_id,event_type,old_value,new_value,metadata,created_by_profile_id
      )
      values(
        v_client.tenant_id,p_client_id,'clinician_assigned',
        v_client.primary_staff_id::text,p_uuid_value::text,
        jsonb_build_object('reason',p_reason,'correlation_id',p_idempotency_key),
        v_actor
      );

      perform public._crm_bump_token(p_client_id,v_client.tenant_id);
      v_result := jsonb_build_object('ok',true);
    end if;

  elsif p_operation = 'crm_close_client' then
    if v_client.lifecycle_stage = 'closed' then
      v_result := jsonb_build_object('ok',true);
    else
      v_to_closure := public._crm_closure_from_label(p_disposition_reason);
      if v_to_closure is null then
        v_result := jsonb_build_object(
          'ok',false,'error_code','invalid_transition','message','unknown_disposition_reason'
        );
      else
        update public.clients
           set lifecycle_stage = 'closed',
               lifecycle_stage_changed_at = now(),
               closure_reason = v_to_closure,
               closed_at = now(),
               updated_at = now()
         where id = p_client_id;

        perform public._crm_emit_state_change(
          v_client.tenant_id,p_client_id,
          'lifecycle_stage'::public.client_state_dimension_enum,
          v_client.lifecycle_stage::text,'closed',
          p_reason,p_disposition_reason,v_actor,p_idempotency_key,'closed'
        );
        perform public._crm_bump_token(p_client_id,v_client.tenant_id);
        v_result := jsonb_build_object('ok',true);
      end if;
    end if;

  elsif p_operation = 'crm_reopen_client' then
    if v_client.lifecycle_stage <> 'closed' then
      v_result := jsonb_build_object(
        'ok',false,'error_code','invalid_transition','message','client_not_closed'
      );
    else
      select a.from_value::public.client_lifecycle_stage_enum
        into v_prior_lifecycle
        from public.crm_client_state_audit a
       where a.client_id = p_client_id
         and a.dimension = 'lifecycle_stage'
         and a.to_value = 'closed'
       order by a.created_at desc
       limit 1;

      if v_prior_lifecycle is null or v_prior_lifecycle = 'closed' then
        v_prior_lifecycle := 'registration';
      end if;

      update public.clients
         set lifecycle_stage = v_prior_lifecycle,
             lifecycle_stage_changed_at = now(),
             closure_reason = null,
             closed_at = null,
             updated_at = now()
       where id = p_client_id;

      perform public._crm_emit_state_change(
        v_client.tenant_id,p_client_id,
        'lifecycle_stage'::public.client_state_dimension_enum,
        'closed',v_prior_lifecycle::text,
        p_reason,null,v_actor,p_idempotency_key,'reopened'
      );
      perform public._crm_bump_token(p_client_id,v_client.tenant_id);
      v_result := jsonb_build_object('ok',true);
    end if;

  else
    v_result := jsonb_build_object(
      'ok',false,'error_code','unknown','message','unknown_operation'
    );
  end if;

  perform private.crm_idempotency_complete(v_scope_key,v_result);
  return v_result;
end;
$$;

revoke all on function private.crm_mutate_client_impl(
  text,uuid,text,uuid,jsonb,text,text,text,uuid,text
) from public,anon,authenticated;

-- Idempotent replay and canonical-write guard context wrapper.
create or replace function private.crm_mutate_client(
  p_operation text,
  p_client_id uuid,
  p_text_value text,
  p_uuid_value uuid,
  p_json_value jsonb,
  p_reason text,
  p_disposition_reason text,
  p_concurrency_token text,
  p_idempotency_key uuid,
  p_contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_scope text;
  v_existing record;
  v_result jsonb;
  v_prev_engine text := current_setting('valorwell.client_state_engine',true);
  v_prev_source text := current_setting('valorwell.client_state_source',true);
  v_prev_reason text := current_setting('valorwell.client_state_reason',true);
  v_prev_actor text := current_setting('valorwell.client_state_actor_id',true);
begin
  if v_actor is not null and p_idempotency_key is not null then
    select c.tenant_id into v_tenant
    from public.clients c
    where c.id=p_client_id;

    if v_tenant is not null
       and public.crm_has_role(v_actor,array['admin','staff'],v_tenant) then
      v_scope := concat_ws('|',
        v_tenant::text,v_actor::text,p_operation,p_client_id::text,p_idempotency_key::text
      );
      perform pg_advisory_xact_lock(pg_catalog.hashtextextended(v_scope,0));

      select k.status,k.result_json into v_existing
      from public.crm_idempotency_keys k
      where k.tenant_id=v_tenant
        and k.actor_id=v_actor
        and k.operation=p_operation
        and k.target_id=p_client_id
        and k.action_key=p_idempotency_key::text
        and k.expires_at>=now();

      if v_existing.result_json is not null then
        return v_existing.result_json;
      end if;
      if v_existing.status='processing' then
        return jsonb_build_object(
          'ok',false,'error_code','unknown','message','operation_in_progress'
        );
      end if;
    end if;
  end if;

  perform set_config('valorwell.client_state_engine','on',true);
  perform set_config('valorwell.client_state_source','crm_contract',true);
  perform set_config('valorwell.client_state_reason',coalesce(p_reason,''),true);
  perform set_config('valorwell.client_state_actor_id',coalesce(v_actor::text,''),true);

  v_result := private.crm_mutate_client_impl(
    p_operation,p_client_id,p_text_value,p_uuid_value,p_json_value,p_reason,
    p_disposition_reason,p_concurrency_token,p_idempotency_key,p_contract_version
  );

  perform set_config('valorwell.client_state_engine',coalesce(v_prev_engine,''),true);
  perform set_config('valorwell.client_state_source',coalesce(v_prev_source,''),true);
  perform set_config('valorwell.client_state_reason',coalesce(v_prev_reason,''),true);
  perform set_config('valorwell.client_state_actor_id',coalesce(v_prev_actor,''),true);
  return v_result;
exception when others then
  perform set_config('valorwell.client_state_engine',coalesce(v_prev_engine,''),true);
  perform set_config('valorwell.client_state_source',coalesce(v_prev_source,''),true);
  perform set_config('valorwell.client_state_reason',coalesce(v_prev_reason,''),true);
  perform set_config('valorwell.client_state_actor_id',coalesce(v_prev_actor,''),true);
  raise;
end;
$$;

revoke all on function private.crm_mutate_client(
  text,uuid,text,uuid,jsonb,text,text,text,uuid,text
) from public,anon,authenticated;


-- Public wrappers: exact contract signatures.
create or replace function public.crm_transition_lifecycle(
  p_client_id uuid,
  p_to_stage text,
  p_reason text,
  p_disposition_reason text default null,
  p_concurrency_token text default null,
  p_idempotency_key uuid default null,
  p_contract_version text default null
)
returns jsonb
language sql
security definer
set search_path = public, private
as $$
  select private.crm_mutate_client(
    'crm_transition_lifecycle',p_client_id,p_to_stage,null,null,p_reason,
    p_disposition_reason,p_concurrency_token,p_idempotency_key,p_contract_version
  )
$$;

create or replace function public.crm_set_engagement(
  p_client_id uuid,
  p_to_state text,
  p_reason text,
  p_concurrency_token text default null,
  p_idempotency_key uuid default null,
  p_contract_version text default null
)
returns jsonb language sql security definer set search_path=public,private
as $$
  select private.crm_mutate_client(
    'crm_set_engagement',p_client_id,p_to_state,null,null,p_reason,
    null,p_concurrency_token,p_idempotency_key,p_contract_version
  )
$$;

create or replace function public.crm_set_contact_policy(
  p_client_id uuid,
  p_to_policy text,
  p_reason text,
  p_concurrency_token text default null,
  p_idempotency_key uuid default null,
  p_contract_version text default null
)
returns jsonb language sql security definer set search_path=public,private
as $$
  select private.crm_mutate_client(
    'crm_set_contact_policy',p_client_id,p_to_policy,null,null,p_reason,
    null,p_concurrency_token,p_idempotency_key,p_contract_version
  )
$$;

create or replace function public.crm_set_service_policy(
  p_client_id uuid,
  p_to_policy text,
  p_reason text,
  p_concurrency_token text default null,
  p_idempotency_key uuid default null,
  p_contract_version text default null
)
returns jsonb language sql security definer set search_path=public,private
as $$
  select private.crm_mutate_client(
    'crm_set_service_policy',p_client_id,p_to_policy,null,null,p_reason,
    null,p_concurrency_token,p_idempotency_key,p_contract_version
  )
$$;

create or replace function public.crm_set_eligibility(
  p_client_id uuid,
  p_to_state text,
  p_manual_review jsonb default null,
  p_reason text default null,
  p_concurrency_token text default null,
  p_idempotency_key uuid default null,
  p_contract_version text default null
)
returns jsonb language sql security definer set search_path=public,private
as $$
  select private.crm_mutate_client(
    'crm_set_eligibility',p_client_id,p_to_state,null,p_manual_review,p_reason,
    null,p_concurrency_token,p_idempotency_key,p_contract_version
  )
$$;

create or replace function public.crm_set_care_cadence(
  p_client_id uuid,
  p_to_cadence text,
  p_reason text,
  p_concurrency_token text default null,
  p_idempotency_key uuid default null,
  p_contract_version text default null
)
returns jsonb language sql security definer set search_path=public,private
as $$
  select private.crm_mutate_client(
    'crm_set_care_cadence',p_client_id,p_to_cadence,null,null,p_reason,
    null,p_concurrency_token,p_idempotency_key,p_contract_version
  )
$$;

create or replace function public.crm_assign_clinician(
  p_client_id uuid,
  p_staff_id uuid,
  p_reason text,
  p_concurrency_token text default null,
  p_idempotency_key uuid default null,
  p_contract_version text default null
)
returns jsonb language sql security definer set search_path=public,private
as $$
  select private.crm_mutate_client(
    'crm_assign_clinician',p_client_id,null,p_staff_id,null,p_reason,
    null,p_concurrency_token,p_idempotency_key,p_contract_version
  )
$$;

create or replace function public.crm_close_client(
  p_client_id uuid,
  p_disposition_reason text,
  p_reason text,
  p_concurrency_token text default null,
  p_idempotency_key uuid default null,
  p_contract_version text default null
)
returns jsonb language sql security definer set search_path=public,private
as $$
  select private.crm_mutate_client(
    'crm_close_client',p_client_id,null,null,null,p_reason,
    p_disposition_reason,p_concurrency_token,p_idempotency_key,p_contract_version
  )
$$;

create or replace function public.crm_reopen_client(
  p_client_id uuid,
  p_reason text,
  p_concurrency_token text default null,
  p_idempotency_key uuid default null,
  p_contract_version text default null
)
returns jsonb language sql security definer set search_path=public,private
as $$
  select private.crm_mutate_client(
    'crm_reopen_client',p_client_id,null,null,null,p_reason,
    null,p_concurrency_token,p_idempotency_key,p_contract_version
  )
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as proc
      from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public'
       and p.proname in (
         'crm_transition_lifecycle','crm_set_engagement','crm_set_contact_policy',
         'crm_set_service_policy','crm_set_eligibility','crm_set_care_cadence',
         'crm_assign_clinician','crm_close_client','crm_reopen_client'
       )
  loop
    execute format('revoke all on function %s from public, anon',r.proc);
    execute format('grant execute on function %s to authenticated, service_role',r.proc);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Server-only REMOVE command
-- ---------------------------------------------------------------------------
create or replace function public.crm_apply_remove(
  p_tenant_id uuid,
  p_client_id uuid,
  p_source text,
  p_correlation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
  v_actor uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_action text := coalesce(nullif(btrim(p_correlation_id),''),gen_random_uuid()::text);
  v_idem jsonb;
  v_scope_key text;
  v_result jsonb;
  v_enrollment record;
  v_prev_engine text := current_setting('valorwell.client_state_engine',true);
  v_prev_source text := current_setting('valorwell.client_state_source',true);
  v_prev_reason text := current_setting('valorwell.client_state_reason',true);
  v_prev_actor text := current_setting('valorwell.client_state_actor_id',true);
begin
  select * into v_client
  from public.clients
  where id=p_client_id and tenant_id=p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error_code','unknown_canonical_state');
  end if;

  v_idem := private.crm_idempotency_begin(
    p_tenant_id,v_actor,'crm_apply_remove',p_client_id,v_action
  );
  if not coalesce((v_idem->>'proceed')::boolean,false) then
    return v_idem->'result';
  end if;
  v_scope_key := v_idem->>'scope_key';

  if v_client.contact_policy<>'do_not_contact' then
    perform set_config('valorwell.client_state_engine','on',true);
    perform set_config('valorwell.client_state_source','inbound_remove_webhook',true);
    perform set_config(
      'valorwell.client_state_reason',
      'REMOVE keyword received via '||coalesce(p_source,'unknown'),
      true
    );
    perform set_config('valorwell.client_state_actor_id','',true);

    update public.clients
    set contact_policy='do_not_contact',
        contact_policy_changed_at=now(),
        updated_at=now()
    where id=p_client_id;

    perform set_config('valorwell.client_state_engine',coalesce(v_prev_engine,''),true);
    perform set_config('valorwell.client_state_source',coalesce(v_prev_source,''),true);
    perform set_config('valorwell.client_state_reason',coalesce(v_prev_reason,''),true);
    perform set_config('valorwell.client_state_actor_id',coalesce(v_prev_actor,''),true);

    perform public._crm_emit_state_change(
      p_tenant_id,p_client_id,
      'contact_policy'::public.client_state_dimension_enum,
      v_client.contact_policy::text,'do_not_contact',
      'REMOVE keyword received via '||coalesce(p_source,'unknown'),
      null,null,null,'contact_policy_changed'
    );
    perform public._crm_bump_token(p_client_id,p_tenant_id);
  end if;

  for v_enrollment in
    select id
    from public.crm_campaign_enrollments
    where tenant_id=p_tenant_id and client_id=p_client_id and status='active'
    for update
  loop
    update public.crm_campaign_enrollments
    set status='cancelled',pause_reason='REMOVE received',updated_at=now()
    where id=v_enrollment.id;

    insert into public.crm_activity_events(
      tenant_id,client_id,event_type,old_value,new_value,metadata,created_by_profile_id
    ) values(
      p_tenant_id,p_client_id,'campaign_cancelled_by_policy','active','cancelled',
      jsonb_build_object(
        'enrollment_id',v_enrollment.id,'reason','REMOVE',
        'source',p_source,'correlation_id',p_correlation_id
      ),
      null
    );
  end loop;

  update public.crm_campaign_step_logs
  set status='suppressed',
      skip_reason='suppressed:contact_policy_dnc',
      claimed_at=null,
      claim_token=null,
      updated_at=now()
  where tenant_id=p_tenant_id
    and client_id=p_client_id
    and status in ('scheduled','processing');

  v_result := jsonb_build_object('ok',true,'contact_policy','Do Not Contact');
  perform private.crm_idempotency_complete(v_scope_key,v_result);
  return v_result;
exception when others then
  perform set_config('valorwell.client_state_engine',coalesce(v_prev_engine,''),true);
  perform set_config('valorwell.client_state_source',coalesce(v_prev_source,''),true);
  perform set_config('valorwell.client_state_reason',coalesce(v_prev_reason,''),true);
  perform set_config('valorwell.client_state_actor_id',coalesce(v_prev_actor,''),true);
  raise;
end;
$$;

revoke all on function public.crm_apply_remove(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.crm_apply_remove(uuid,uuid,text,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Communication-policy evaluator
-- ---------------------------------------------------------------------------
create or replace function public.crm_evaluate_communication_policy(
  p_client_id uuid,
  p_channel text,
  p_message_class text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_client record;
  v_ordinary boolean := p_message_class in (
    'ordinary_promotional','ordinary_campaign_follow_up','wait_path_ordinary'
  );
  v_closed_blocked boolean := p_message_class in (
    'ordinary_promotional','ordinary_campaign_follow_up','wait_path_ordinary','active_care'
  );
begin
  if p_channel not in ('email','sms') then
    return jsonb_build_object(
      'allowed',false,'reason_code','class_never_permitted',
      'policy_version',private.crm_contract_version(),
      'contact_policy',null,'service_policy',null
    );
  end if;

  if p_message_class not in (
    'ordinary_promotional','ordinary_campaign_follow_up','wait_path_ordinary',
    'necessary_scheduling','active_care','billing_insurance',
    'clinical_safety_legal','transactional_account'
  ) then
    return jsonb_build_object(
      'allowed',false,'reason_code','class_never_permitted',
      'policy_version',private.crm_contract_version(),
      'contact_policy',null,'service_policy',null
    );
  end if;

  select c.tenant_id,c.contact_policy,c.service_policy,c.lifecycle_stage
    into v_client
    from public.clients c
   where c.id=p_client_id;

  if not found then
    return jsonb_build_object(
      'allowed',false,'reason_code','unknown_canonical_state',
      'policy_version',private.crm_contract_version(),
      'contact_policy',null,'service_policy',null
    );
  end if;

  if v_actor is not null
     and not public.crm_has_role(v_actor,array['admin','staff'],v_client.tenant_id) then
    return jsonb_build_object(
      'allowed',false,'reason_code','unknown_canonical_state',
      'policy_version',private.crm_contract_version(),
      'contact_policy',null,'service_policy',null
    );
  end if;

  if v_client.service_policy='service_blocked' then
    return jsonb_build_object(
      'allowed',false,'reason_code','service_policy_blocked',
      'policy_version',private.crm_contract_version(),
      'contact_policy',public._crm_contact_policy_to_label(v_client.contact_policy),
      'service_policy',public._crm_service_policy_to_label(v_client.service_policy)
    );
  end if;

  if v_client.contact_policy='do_not_contact' and v_ordinary then
    return jsonb_build_object(
      'allowed',false,'reason_code','contact_policy_dnc',
      'policy_version',private.crm_contract_version(),
      'contact_policy',public._crm_contact_policy_to_label(v_client.contact_policy),
      'service_policy',public._crm_service_policy_to_label(v_client.service_policy)
    );
  end if;

  if v_client.lifecycle_stage='closed' and v_closed_blocked then
    return jsonb_build_object(
      'allowed',false,'reason_code','lifecycle_closed_no_active_care',
      'policy_version',private.crm_contract_version(),
      'contact_policy',public._crm_contact_policy_to_label(v_client.contact_policy),
      'service_policy',public._crm_service_policy_to_label(v_client.service_policy)
    );
  end if;

  return jsonb_build_object(
    'allowed',true,'reason_code','ok',
    'policy_version',private.crm_contract_version(),
    'contact_policy',public._crm_contact_policy_to_label(v_client.contact_policy),
    'service_policy',public._crm_service_policy_to_label(v_client.service_policy)
  );
end;
$$;

revoke all on function public.crm_evaluate_communication_policy(uuid,text,text)
  from public,anon;
grant execute on function public.crm_evaluate_communication_policy(uuid,text,text)
  to authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 7. Canonical read model
-- ---------------------------------------------------------------------------
drop view if exists public.v_client_canonical_state;

create view public.v_client_canonical_state
with (security_invoker=true)
as
select
  c.id as client_id,
  c.tenant_id,
  'valorwell-crm-contracts@1.0.1+20260714'::text as contract_version,
  case c.lifecycle_stage::text
    when 'registration' then 'Registration'
    when 'intake' then 'Intake'
    when 'matching' then 'Matching'
    when 'matched' then 'Matched'
    when 'scheduled' then 'Scheduled'
    when 'early_care' then 'Early Care'
    when 'established_care' then 'Established Care'
    when 'closed' then 'Closed'
  end as lifecycle,
  case c.engagement_state::text
    when 'normal' then 'Normal'
    when 'unresponsive_warm' then 'Unresponsive Warm'
    when 'unresponsive_cold' then 'Unresponsive Cold'
    when 'went_dark' then 'Went Dark'
  end as engagement,
  jsonb_build_object(
    'at_risk',coalesce(c.at_risk,false),
    'evaluated_at',coalesce(c.at_risk_since,m.at_risk_marked_at,c.updated_at),
    'recommended_next_action',(
      select coalesce(nullif(t.description,''),t.title)
      from public.crm_tasks t
      where t.client_id=c.id
        and t.tenant_id=c.tenant_id
        and t.status not in ('completed','canceled')
      order by t.due_at nulls last,t.created_at
      limit 1
    ),
    'event_version',coalesce(m.concurrency_token::text,
      md5(c.id::text||coalesce(c.updated_at::text,''))),
    'reason',m.risk_reason
  ) as at_risk,
  case c.eligibility_state::text
    when 'eligible' then 'Eligible'
    when 'coverage_issue' then 'Coverage Issue'
    when 'manual_review' then 'Manual Review'
    when 'unknown' then 'Unknown'
  end as eligibility,
  case when emr.active then jsonb_build_object(
    'reason',emr.reason,
    'owner',emr.owner,
    'next_action',emr.next_action,
    'review_due_at',emr.review_due_at
  ) else null end as eligibility_manual_review,
  case c.contact_policy::text
    when 'normal' then 'Normal'
    when 'do_not_contact' then 'Do Not Contact'
  end as contact_policy,
  case c.service_policy::text
    when 'normal' then 'Normal'
    when 'service_blocked' then 'Service Blocked'
  end as service_policy,
  c.care_cadence::text as care_cadence,
  case c.closure_reason::text
    when 'not_the_right_time' then 'Not the Right Time'
    when 'found_somewhere_else' then 'Found Somewhere Else'
    when 'completed_care' then 'Completed Care'
    when 'paused_care' then 'Paused Care'
    when 'administrative' then 'Administrative'
    when 'went_dark' then 'Went Dark'
    when 'other' then 'Other'
    else null
  end as disposition_reason,
  c.closed_at as disposition_at,
  c.primary_staff_id as assigned_therapist_id,
  (
    select min(a.start_at)
    from public.appointments a
    where a.client_id=c.id
      and a.start_at>now()
      and a.status::text not in ('cancelled','late_cancel/noshow')
  ) as next_appointment_at,
  coalesce((
    select case
      when d.resolved_at is not null then 'resolved'
      when coalesce(d.last_option_count,0)>0 then 'options_available'
      when d.pathway_code='wait' then 'wait_active'
      else 'open'
    end
    from public.client_provider_demand d
    where d.client_id=c.id
    order by d.opened_at desc
    limit 1
  ),'none') as provider_demand_state,
  coalesce(m.concurrency_token::text,
    md5(c.id::text||coalesce(c.updated_at::text,''))) as concurrency_token,
  c.updated_at
from public.clients c
left join public.crm_client_canonical_meta m
  on m.client_id=c.id and m.tenant_id=c.tenant_id
left join public.crm_eligibility_manual_reviews emr
  on emr.client_id=c.id and emr.tenant_id=c.tenant_id and emr.active
where c.tenant_id in (
  select tm.tenant_id
  from public.tenant_memberships tm
  where tm.profile_id=auth.uid()
);

revoke all on public.v_client_canonical_state from public,anon,authenticated;
grant select on public.v_client_canonical_state to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Report read models
-- ---------------------------------------------------------------------------
drop view if exists public.v_crm_reports_funnel;
create view public.v_crm_reports_funnel with (security_invoker=true) as
with weeks as (
  select date_trunc('week',a.created_at)::date bucket_start,
         (date_trunc('week',a.created_at)+interval '7 days')::date bucket_end,
         a.tenant_id,a.to_value stage,count(*) entered_count
  from public.crm_client_state_audit a
  where a.dimension='lifecycle_stage'
  group by 1,2,3,4
),
exits as (
  select date_trunc('week',a.created_at)::date bucket_start,
         a.tenant_id,a.from_value stage,count(*) exited_count
  from public.crm_client_state_audit a
  where a.dimension='lifecycle_stage' and a.from_value is not null
  group by 1,2,3
),
cur as (
  select c.tenant_id,c.lifecycle_stage::text stage,count(*) current_count
  from public.clients c group by 1,2
),
dwell as (
  select c.tenant_id,c.lifecycle_stage::text stage,
         percentile_cont(0.5) within group (
           order by extract(epoch from(now()-c.lifecycle_stage_changed_at))/86400.0
         ) median_days_in_stage
  from public.clients c
  where c.lifecycle_stage_changed_at is not null
  group by 1,2
)
select w.tenant_id,w.bucket_start,w.bucket_end,w.stage,
       w.entered_count::int,
       coalesce(e.exited_count,0)::int exited_count,
       coalesce(cur.current_count,0)::int current_count,
       coalesce(d.median_days_in_stage,0)::numeric median_days_in_stage
from weeks w
left join exits e on e.tenant_id=w.tenant_id and e.bucket_start=w.bucket_start and e.stage=w.stage
left join cur on cur.tenant_id=w.tenant_id and cur.stage=w.stage
left join dwell d on d.tenant_id=w.tenant_id and d.stage=w.stage
where w.tenant_id in (
  select tenant_id from public.tenant_memberships where profile_id=auth.uid()
);

drop view if exists public.v_crm_reports_engagement;
create view public.v_crm_reports_engagement with (security_invoker=true) as
with ordered as (
  select a.*,
         lag(a.created_at) over(partition by a.client_id order by a.created_at) prev_at,
         lag(a.to_value) over(partition by a.client_id order by a.created_at) prev_state
  from public.crm_client_state_audit a
  where a.dimension='engagement_state'
),
weeks as (
  select date_trunc('week',created_at)::date bucket_start,
         (date_trunc('week',created_at)+interval '7 days')::date bucket_end,
         tenant_id,to_value engagement,count(*) entered_count
  from ordered group by 1,2,3,4
),
normal_duration as (
  select date_trunc('week',created_at)::date bucket_start,
         tenant_id,
         avg(extract(epoch from(created_at-prev_at))/86400.0) avg_days
  from ordered
  where to_value='normal'
    and prev_at is not null
    and prev_state is distinct from 'normal'
  group by 1,2
),
cur as (
  select tenant_id,engagement_state::text engagement,count(*) current_count
  from public.clients group by 1,2
)
select w.tenant_id,w.bucket_start,w.bucket_end,w.engagement,
       coalesce(cur.current_count,0)::int current_count,
       w.entered_count::int,
       case when w.engagement='normal' then nd.avg_days::numeric else null::numeric end
         as avg_days_to_normal
from weeks w
left join cur on cur.tenant_id=w.tenant_id and cur.engagement=w.engagement
left join normal_duration nd on nd.tenant_id=w.tenant_id and nd.bucket_start=w.bucket_start
where w.tenant_id in (
  select tenant_id from public.tenant_memberships where profile_id=auth.uid()
);

drop view if exists public.v_crm_reports_closure;
create view public.v_crm_reports_closure with (security_invoker=true) as
with closed as (
  select date_trunc('week',a.created_at)::date bucket_start,
         (date_trunc('week',a.created_at)+interval '7 days')::date bucket_end,
         a.tenant_id,coalesce(a.disposition_reason,'unspecified') disposition_reason,
         count(*) closed_count
  from public.crm_client_state_audit a
  where a.dimension='lifecycle_stage' and a.to_value='closed'
  group by 1,2,3,4
),
reopened as (
  select date_trunc('week',a.created_at)::date bucket_start,
         a.tenant_id,count(*) reopened_count
  from public.crm_client_state_audit a
  where a.dimension='lifecycle_stage' and a.from_value='closed'
  group by 1,2
)
select c.tenant_id,c.bucket_start,c.bucket_end,c.disposition_reason,
       c.closed_count::int,
       coalesce(r.reopened_count,0)::int reopened_count,
       (c.closed_count-coalesce(r.reopened_count,0))::int net_closed
from closed c
left join reopened r on r.tenant_id=c.tenant_id and r.bucket_start=c.bucket_start
where c.tenant_id in (
  select tenant_id from public.tenant_memberships where profile_id=auth.uid()
);

drop view if exists public.v_crm_reports_campaigns;
create view public.v_crm_reports_campaigns with (security_invoker=true) as
with enr as (
  select date_trunc('week',e.enrolled_at)::date bucket_start,
         (date_trunc('week',e.enrolled_at)+interval '7 days')::date bucket_end,
         e.tenant_id,e.campaign_id,
         count(*) enrolled_count,
         count(*) filter(where e.status='completed') completed_count,
         count(*) filter(where e.status='cancelled') cancelled_count,
         count(*) filter(where e.status='responded') responded_count
  from public.crm_campaign_enrollments e
  group by 1,2,3,4
),
steps as (
  select date_trunc('week',sl.created_at)::date bucket_start,
         sl.tenant_id,cs.campaign_id,
         count(*) filter(where sl.status='failed') failed_count
  from public.crm_campaign_step_logs sl
  join public.crm_campaign_steps cs on cs.id=sl.step_id
  group by 1,2,3
),
suppressed as (
  select date_trunc('week',ae.created_at)::date bucket_start,
         ae.tenant_id,
         nullif(ae.metadata->>'campaign_id','')::uuid campaign_id,
         count(*) suppressed_count
  from public.crm_activity_events ae
  where ae.event_type in ('email_suppressed','sms_suppressed')
    and ae.metadata ? 'campaign_id'
  group by 1,2,3
)
select e.tenant_id,e.bucket_start,e.bucket_end,e.campaign_id,
       e.enrolled_count::int,e.completed_count::int,e.cancelled_count::int,
       e.responded_count::int,
       coalesce(sup.suppressed_count,0)::int suppressed_count,
       coalesce(st.failed_count,0)::int failed_count
from enr e
left join steps st
  on st.tenant_id=e.tenant_id and st.campaign_id=e.campaign_id and st.bucket_start=e.bucket_start
left join suppressed sup
  on sup.tenant_id=e.tenant_id and sup.campaign_id=e.campaign_id and sup.bucket_start=e.bucket_start
where e.tenant_id in (
  select tenant_id from public.tenant_memberships where profile_id=auth.uid()
);

drop view if exists public.v_crm_reports_tasks;
create view public.v_crm_reports_tasks with (security_invoker=true) as
with weekly as (
  select date_trunc('week',created_at)::date bucket_start,
         (date_trunc('week',created_at)+interval '7 days')::date bucket_end,
         tenant_id,owner_id assignee_id,
         count(*) filter(where status not in ('completed','canceled')) open_count,
         count(*) filter(where completed_at is not null or status='completed') completed_count,
         count(*) filter(
           where status not in ('completed','canceled')
             and due_at is not null and due_at<now()
         ) overdue_count,
         percentile_cont(0.5) within group (
           order by extract(epoch from(completed_at-created_at))/3600.0
         ) filter(where completed_at is not null) median_hours_to_complete
  from public.crm_tasks
  group by 1,2,3,4
)
select tenant_id,bucket_start,bucket_end,assignee_id,
       open_count::int,completed_count::int,overdue_count::int,
       coalesce(median_hours_to_complete,0)::numeric median_hours_to_complete
from weekly
where tenant_id in (
  select tenant_id from public.tenant_memberships where profile_id=auth.uid()
);

drop view if exists public.v_crm_reports_exceptions;
create view public.v_crm_reports_exceptions with (security_invoker=true) as
with weekly as (
  select date_trunc('week',created_at)::date bucket_start,
         (date_trunc('week',created_at)+interval '7 days')::date bucket_end,
         tenant_id,type::text exception_type,
         count(*) raised_count,
         count(*) filter(where status='resolved') resolved_count,
         count(*) filter(where status in ('open','in_review')) open_count,
         percentile_cont(0.5) within group (
           order by extract(epoch from(updated_at-created_at))/3600.0
         ) filter(where status='resolved') median_hours_to_resolve
  from public.crm_exceptions
  group by 1,2,3,4
)
select tenant_id,bucket_start,bucket_end,exception_type,
       raised_count::int,resolved_count::int,open_count::int,
       coalesce(median_hours_to_resolve,0)::numeric median_hours_to_resolve
from weekly
where tenant_id in (
  select tenant_id from public.tenant_memberships where profile_id=auth.uid()
);

do $$
declare v_name text;
begin
  foreach v_name in array array[
    'v_crm_reports_funnel','v_crm_reports_engagement','v_crm_reports_closure',
    'v_crm_reports_campaigns','v_crm_reports_tasks','v_crm_reports_exceptions'
  ]
  loop
    execute format('revoke all on public.%I from public,anon,authenticated',v_name);
    execute format('grant select on public.%I to authenticated',v_name);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Direct-write bypass prevention
-- ---------------------------------------------------------------------------
revoke update on public.clients from authenticated;

do $$
declare v_columns text;
begin
  select string_agg(format('%I',column_name),', ' order by ordinal_position)
    into v_columns
    from information_schema.columns
   where table_schema='public'
     and table_name='clients'
     and column_name <> all(array[
       'id','tenant_id','profile_id',
       'pat_status','status_changed_at',
       'primary_staff_id',
       'lifecycle_stage','lifecycle_stage_changed_at',
       'engagement_state','engagement_state_changed_at',
       'at_risk','at_risk_since','at_risk_anchor_at',
       'eligibility_state','eligibility_state_changed_at',
       'contact_policy','contact_policy_changed_at',
       'service_policy','service_policy_changed_at',
       'closure_reason','closed_at',
       'care_cadence','care_cadence_changed_at',
       'contract_version'
     ]);

  if v_columns is not null then
    execute format('grant update (%s) on public.clients to authenticated',v_columns);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Shared-table RLS and role hardening
-- ---------------------------------------------------------------------------
alter table public.user_roles enable row level security;
revoke all on public.user_roles from anon;
revoke all on public.user_roles from authenticated;
grant select,insert,update,delete on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

drop policy if exists "Staff can view tenant clients" on public.clients;
drop policy if exists "Staff can update tenant clients" on public.clients;

create policy "Staff can view tenant clients"
  on public.clients for select to authenticated
  using (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));

create policy "Staff can update tenant clients"
  on public.clients for update to authenticated
  using (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id))
  with check (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));

drop policy if exists crm_activity_events_select_tenant on public.crm_activity_events;
create policy crm_activity_events_select_tenant
  on public.crm_activity_events for select to authenticated
  using (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));

drop policy if exists crm_eligibility_manual_reviews_select_tenant
  on public.crm_eligibility_manual_reviews;
create policy crm_eligibility_manual_reviews_select_tenant
  on public.crm_eligibility_manual_reviews for select to authenticated
  using (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));

-- Replace legacy campaign membership-only policies with authoritative staff/admin checks.
do $$
declare p record;
begin
  for p in
    select policyname,tablename
    from pg_policies
    where schemaname='public'
      and tablename in (
        'crm_campaigns','crm_campaign_steps',
        'crm_campaign_enrollments','crm_campaign_step_logs'
      )
      and policyname not ilike 'Service role%'
  loop
    execute format('drop policy %I on public.%I',p.policyname,p.tablename);
  end loop;
end $$;

create policy crm_campaigns_staff_select
  on public.crm_campaigns for select to authenticated
  using (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));
create policy crm_campaigns_staff_insert
  on public.crm_campaigns for insert to authenticated
  with check (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));
create policy crm_campaigns_staff_update
  on public.crm_campaigns for update to authenticated
  using (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id))
  with check (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));
create policy crm_campaigns_staff_delete
  on public.crm_campaigns for delete to authenticated
  using (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));

create policy crm_campaign_steps_staff_select
  on public.crm_campaign_steps for select to authenticated
  using (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));
create policy crm_campaign_steps_staff_insert
  on public.crm_campaign_steps for insert to authenticated
  with check (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));
create policy crm_campaign_steps_staff_update
  on public.crm_campaign_steps for update to authenticated
  using (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id))
  with check (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));
create policy crm_campaign_steps_staff_delete
  on public.crm_campaign_steps for delete to authenticated
  using (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));

create policy crm_campaign_enrollments_staff_select
  on public.crm_campaign_enrollments for select to authenticated
  using (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));
create policy crm_campaign_enrollments_staff_insert
  on public.crm_campaign_enrollments for insert to authenticated
  with check (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));
create policy crm_campaign_enrollments_staff_update
  on public.crm_campaign_enrollments for update to authenticated
  using (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id))
  with check (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));
create policy crm_campaign_enrollments_staff_delete
  on public.crm_campaign_enrollments for delete to authenticated
  using (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));

create policy crm_campaign_step_logs_staff_select
  on public.crm_campaign_step_logs for select to authenticated
  using (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));
create policy crm_campaign_step_logs_staff_insert
  on public.crm_campaign_step_logs for insert to authenticated
  with check (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));
create policy crm_campaign_step_logs_staff_update
  on public.crm_campaign_step_logs for update to authenticated
  using (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id))
  with check (public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id));

-- Inbound SMS is written only by service-role webhook processing.
alter table public.crm_inbound_sms_logs enable row level security;
revoke all on public.crm_inbound_sms_logs from public,anon,authenticated;
grant select,update on public.crm_inbound_sms_logs to authenticated;
grant all on public.crm_inbound_sms_logs to service_role;

drop policy if exists "Service role can insert inbound SMS logs" on public.crm_inbound_sms_logs;
drop policy if exists "Users can view inbound SMS for their tenant" on public.crm_inbound_sms_logs;
drop policy if exists crm_inbound_sms_logs_staff_select on public.crm_inbound_sms_logs;
drop policy if exists crm_inbound_sms_logs_staff_update on public.crm_inbound_sms_logs;

create policy crm_inbound_sms_logs_staff_select
  on public.crm_inbound_sms_logs for select to authenticated
  using (
    tenant_id is not null
    and public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id)
  );

create policy crm_inbound_sms_logs_staff_update
  on public.crm_inbound_sms_logs for update to authenticated
  using (
    tenant_id is not null
    and public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id)
  )
  with check (
    tenant_id is not null
    and public.crm_has_role(auth.uid(),array['admin','staff'],tenant_id)
  );

-- ---------------------------------------------------------------------------
-- 11. Retire legacy status/ClickUp paths and lock obsolete RPCs
-- ---------------------------------------------------------------------------
drop trigger if exists trg_cancel_campaign_on_status_change on public.clients;
drop trigger if exists trg_enroll_campaign_on_status_change on public.clients;

-- Drop the obsolete unsafe overload if it exists.
drop function if exists public.set_client_contact_policy(
  uuid,uuid,public.client_contact_policy_enum,text,uuid,text,text
);

-- Lock obsolete canonical writers/internal helpers to service_role without
-- assuming every historical function exists in every environment.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as proc
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        '_crm_ensure_meta',
        'assign_client_clinician',
        'set_client_care_cadence',
        'set_client_contact_policy',
        'set_client_disposition',
        'set_client_eligibility_state',
        'set_client_engagement_state',
        'set_client_risk',
        'set_client_service_policy',
        'transition_client_lifecycle',
        'crm_bulk_update_client_status',
        'cancel_campaign_on_status_change',
        'enroll_campaign_on_status_change'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated',r.proc);
    execute format('grant execute on function %s to service_role',r.proc);
  end loop;
end $$;

-- Retire automatic client ClickUp mirroring at the enqueue point.
create or replace function public.trg_enqueue_clickup_sync(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  return;
end;
$$;

revoke all on function public.trg_enqueue_clickup_sync(uuid)
  from public,anon,authenticated;
grant execute on function public.trg_enqueue_clickup_sync(uuid)
  to service_role;

-- Tenant-safe Help Scout lookup.
create or replace function public.find_clients_by_emails_insensitive(
  p_tenant_id uuid,
  p_emails text[]
)
returns table(id uuid,email text)
language sql
stable
security definer
set search_path=public
as $$
  select c.id,c.email
  from public.clients c
  where c.tenant_id=p_tenant_id
    and lower(c.email)=any(p_emails)
    and (
      coalesce(auth.jwt()->>'role','')='service_role'
      or public.crm_has_role(auth.uid(),array['admin','staff'],p_tenant_id)
    )
$$;

revoke all on function public.find_clients_by_emails_insensitive(uuid,text[])
  from public,anon;
grant execute on function public.find_clients_by_emails_insensitive(uuid,text[])
  to authenticated,service_role;

-- Tenant-safe atomic campaign-step save.
create or replace function public.crm_save_campaign_steps(
  p_campaign_id uuid,
  p_tenant_id uuid,
  p_steps jsonb
)
returns setof public.crm_campaign_steps
language plpgsql
security definer
set search_path=public
as $$
declare
  v_kept_ids uuid[];
begin
  if not public.crm_has_role(auth.uid(),array['admin','staff'],p_tenant_id) then
    raise exception 'Not authorized for tenant %',p_tenant_id using errcode='42501';
  end if;

  if not exists(
    select 1 from public.crm_campaigns
    where id=p_campaign_id and tenant_id=p_tenant_id
  ) then
    raise exception 'Campaign not found' using errcode='42704';
  end if;

  select coalesce(array_agg((s->>'id')::uuid),array[]::uuid[])
    into v_kept_ids
  from jsonb_array_elements(p_steps) s
  where nullif(s->>'id','') is not null;

  delete from public.crm_campaign_steps
  where campaign_id=p_campaign_id
    and tenant_id=p_tenant_id
    and not(id=any(v_kept_ids));

  insert into public.crm_campaign_steps(
    id,campaign_id,tenant_id,step_order,delay_days,delay_hours,
    channel,email_subject,email_body_html,sms_body_text,is_active,signature_id
  )
  select
    coalesce(nullif(s->>'id','')::uuid,gen_random_uuid()),
    p_campaign_id,p_tenant_id,(s->>'step_order')::int,
    coalesce((s->>'delay_days')::int,0),
    coalesce((s->>'delay_hours')::int,0),
    s->>'channel',
    case when s->>'channel'='email' then s->>'email_subject' end,
    case when s->>'channel'='email' then s->>'email_body_html' end,
    case when s->>'channel'='sms' then s->>'sms_body_text' end,
    coalesce((s->>'is_active')::boolean,true),
    case when s->>'channel'='email' and nullif(s->>'signature_id','') is not null
      then (s->>'signature_id')::uuid end
  from jsonb_array_elements(p_steps) s
  on conflict(id) do update set
    step_order=excluded.step_order,
    delay_days=excluded.delay_days,
    delay_hours=excluded.delay_hours,
    channel=excluded.channel,
    email_subject=excluded.email_subject,
    email_body_html=excluded.email_body_html,
    sms_body_text=excluded.sms_body_text,
    is_active=excluded.is_active,
    signature_id=excluded.signature_id,
    updated_at=now();

  return query
  select * from public.crm_campaign_steps
  where campaign_id=p_campaign_id and tenant_id=p_tenant_id
  order by step_order;
end;
$$;

revoke all on function public.crm_save_campaign_steps(uuid,uuid,jsonb)
  from public,anon;
grant execute on function public.crm_save_campaign_steps(uuid,uuid,jsonb)
  to authenticated,service_role;

-- Harden mapping/update helper search paths.
alter function public._crm_lifecycle_from_label(text) set search_path=public;
alter function public._crm_lifecycle_to_label(public.client_lifecycle_stage_enum) set search_path=public;
alter function public._crm_engagement_from_label(text) set search_path=public;
alter function public._crm_engagement_to_label(public.client_engagement_state_enum) set search_path=public;
alter function public._crm_contact_policy_from_label(text) set search_path=public;
alter function public._crm_contact_policy_to_label(public.client_contact_policy_enum) set search_path=public;
alter function public._crm_service_policy_from_label(text) set search_path=public;
alter function public._crm_service_policy_to_label(public.client_service_policy_enum) set search_path=public;
alter function public._crm_eligibility_from_label(text) set search_path=public;
alter function public._crm_eligibility_to_label(public.client_eligibility_state_enum) set search_path=public;
alter function public._crm_closure_from_label(text) set search_path=public;
alter function public._crm_closure_to_label(public.client_closure_reason_enum) set search_path=public;
alter function public._crm_cadence_from_label(text) set search_path=public;
alter function public.crm_touch_updated_at() set search_path=public;

revoke all on function public.crm_touch_updated_at()
  from public,anon,authenticated;
grant execute on function public.crm_touch_updated_at()
  to service_role;

commit;
