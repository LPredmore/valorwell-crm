alter table private.relationship_enrollment_idempotency
  add column if not exists work_item_id uuid
  references private.relationship_campaign_work_items(id) on delete cascade;

create index if not exists relationship_enrollment_idempotency_work_item_idx
  on private.relationship_enrollment_idempotency (work_item_id, created_at desc)
  where work_item_id is not null;

revoke execute on function private.relationship_enrollment_json(uuid) from authenticated;
revoke execute on function private.evaluate_relationship_campaign_target(uuid, uuid, jsonb) from authenticated;
grant execute on function private.relationship_enrollment_json(uuid) to service_role;
grant execute on function private.evaluate_relationship_campaign_target(uuid, uuid, jsonb) to service_role;

-- Preserve the Pass 10 target resolver and place referral-evidence validation
-- around it. Verified source language can never be selected by assertion alone.
do $$
begin
  if to_regprocedure('private.evaluate_relationship_campaign_target_base(uuid,uuid,jsonb)') is null then
    alter function private.evaluate_relationship_campaign_target(uuid, uuid, jsonb)
      rename to evaluate_relationship_campaign_target_base;
  end if;
end;
$$;

create or replace function private.evaluate_relationship_campaign_target(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_target jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_mode text := coalesce(nullif(p_target ->> 'sourceLanguageMode', ''), 'none');
  v_referral_id uuid := nullif(p_target ->> 'verifiedReferralId', '')::uuid;
  v_contact_id uuid;
  v_organization_id uuid;
  v_referral public.relationship_referrals%rowtype;
  v_referral_valid boolean := false;
  v_reasons text[] := '{}'::text[];
  v_personalization jsonb;
begin
  v_result := private.evaluate_relationship_campaign_target_base(
    p_tenant_id,
    p_campaign_id,
    p_target
  );

  select coalesce(array_agg(reason), '{}'::text[])
  into v_reasons
  from jsonb_array_elements_text(coalesce(v_result -> 'reasons', '[]'::jsonb)) reason;

  v_contact_id := nullif(v_result ->> 'resolvedContactId', '')::uuid;
  v_organization_id := nullif(v_result ->> 'organizationId', '')::uuid;

  if v_mode = any (array['verified_anonymous', 'verified_named']::text[]) then
    if v_referral_id is not null then
      select * into v_referral
      from public.relationship_referrals referral
      where referral.tenant_id = p_tenant_id
        and referral.id = v_referral_id;

      v_referral_valid := found
        and v_referral.verified
        and v_referral.revoked_at is null
        and (
          (v_referral.contact_id is not null and v_referral.contact_id = v_contact_id)
          or (v_referral.organization_id is not null and v_referral.organization_id = v_organization_id)
        )
        and (
          (v_mode = 'verified_anonymous' and v_referral.disclosure = 'community_anonymous')
          or (
            v_mode = 'verified_named'
            and v_referral.disclosure = 'named_referrer'
            and nullif(btrim(v_referral.named_referrer), '') is not null
          )
        );
    end if;

    if v_referral_valid then
      v_personalization := coalesce(v_result -> 'personalizationContext', '{}'::jsonb)
        || jsonb_build_object(
          'verifiedReferralId', v_referral.id,
          'verifiedReferralDisclosure', v_referral.disclosure
        );
      v_result := v_result || jsonb_build_object(
        'verifiedReferralId', v_referral.id,
        'personalizationContext', v_personalization
      );
    else
      v_reasons := array_append(v_reasons, 'source_language_not_allowed');
      v_result := v_result - 'verifiedReferralId';
    end if;
  elsif v_referral_id is not null then
    v_reasons := array_append(v_reasons, 'source_language_not_allowed');
    v_result := v_result - 'verifiedReferralId';
  end if;

  v_reasons := array(
    select distinct reason
    from unnest(v_reasons) reason
    order by reason
  );

  return v_result || jsonb_build_object(
    'eligible', cardinality(v_reasons) = 0,
    'reasons', to_jsonb(v_reasons),
    'safetyStatus', 'pending_pass_11',
    'safetyEligible', false,
    'deliveryEnabled', false,
    'executionEnabled', false,
    'executionBoundary', 'disabled_until_passes_11_12'
  );
end;
$$;

revoke all on function private.evaluate_relationship_campaign_target(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function private.evaluate_relationship_campaign_target(uuid, uuid, jsonb)
  to service_role;

-- Planned and retry-wait work must always retain at least one claim attempt.
alter table private.relationship_campaign_work_items
  drop constraint if exists relationship_campaign_work_items_retry_budget_check;
alter table private.relationship_campaign_work_items
  add constraint relationship_campaign_work_items_retry_budget_check check (
    status <> all (array['planned', 'retry_wait']::text[])
    or attempt_count < max_attempts
  );

-- Preserve the Pass 10 SKIP LOCKED claim implementation and place terminal
-- lease-expiration handling around it.
do $$
begin
  if to_regprocedure('private.claim_relationship_campaign_work_base(text,integer,integer)') is null then
    alter function private.claim_relationship_campaign_work(text, integer, integer)
      rename to claim_relationship_campaign_work_base;
  end if;
end;
$$;

create or replace function private.claim_relationship_campaign_work(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  with expired as (
    update private.relationship_campaign_work_items item
    set status = 'failed',
        claim_token = null,
        claimed_by = null,
        claimed_at = null,
        lease_expires_at = null,
        last_error_code = 'lease_expired_attempts_exhausted',
        last_error_message = 'Worker lease expired after the final allowed attempt.',
        updated_at = now()
    where item.status = 'claimed'
      and item.lease_expires_at <= now()
      and item.attempt_count >= item.max_attempts
    returning item.tenant_id, item.enrollment_id, item.id
  ), enrollment_updates as (
    update public.relationship_campaign_enrollments enrollment
    set status = 'failed',
        next_scheduled_at = null,
        updated_by_profile_id = null
    from expired
    where enrollment.tenant_id = expired.tenant_id
      and enrollment.id = expired.enrollment_id
      and enrollment.status = any (array['pending', 'active']::text[])
    returning enrollment.id
  )
  insert into public.relationship_enrollment_events (
    tenant_id,
    enrollment_id,
    event_type,
    from_status,
    to_status,
    reason,
    actor_profile_id,
    metadata
  )
  select expired.tenant_id,
         expired.enrollment_id,
         'failed',
         null,
         'failed',
         'Worker lease expired after the final allowed attempt.',
         null,
         jsonb_build_object(
           'work_item_id', expired.id,
           'error_code', 'lease_expired_attempts_exhausted'
         )
  from expired;

  update private.relationship_campaign_work_items item
  set status = 'retry_wait',
      claim_token = null,
      claimed_by = null,
      claimed_at = null,
      lease_expires_at = null,
      available_at = now(),
      last_error_code = 'lease_expired',
      last_error_message = 'Previous worker lease expired before result recording.',
      updated_at = now()
  where item.status = 'claimed'
    and item.lease_expires_at <= now()
    and item.attempt_count < item.max_attempts;

  return private.claim_relationship_campaign_work_base(
    p_worker_id,
    p_limit,
    p_lease_seconds
  );
end;
$$;

revoke all on function private.claim_relationship_campaign_work(text, integer, integer)
  from public, anon, authenticated;
grant execute on function private.claim_relationship_campaign_work(text, integer, integer)
  to service_role;

-- Bind every idempotent result response to the exact claimed work item.
do $$
begin
  if to_regprocedure('private.record_relationship_campaign_work_result_base(uuid,uuid,text,text,timestamptz,text,text)') is null then
    alter function private.record_relationship_campaign_work_result(
      uuid,
      uuid,
      text,
      text,
      timestamptz,
      text,
      text
    ) rename to record_relationship_campaign_work_result_base;
  end if;
end;
$$;

create or replace function private.record_relationship_campaign_work_result(
  p_work_item_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_idempotency_key text,
  p_retry_at timestamptz default null,
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item private.relationship_campaign_work_items%rowtype;
  v_existing_operation text;
  v_existing_work_item_id uuid;
  v_existing_response jsonb;
  v_response jsonb;
begin
  select * into v_item
  from private.relationship_campaign_work_items item
  where item.id = p_work_item_id;

  if not found then
    raise exception 'Campaign work item not found.' using errcode = 'P0002';
  end if;

  select operation, work_item_id, response
  into v_existing_operation, v_existing_work_item_id, v_existing_response
  from private.relationship_enrollment_idempotency
  where tenant_id = v_item.tenant_id
    and idempotency_key = btrim(p_idempotency_key);

  if found then
    if v_existing_operation <> 'work_result'
       or v_existing_work_item_id is distinct from v_item.id then
      raise exception 'Work result idempotency key was already used for a different operation or work item.'
        using errcode = '23505';
    end if;
    return v_existing_response;
  end if;

  v_response := private.record_relationship_campaign_work_result_base(
    p_work_item_id,
    p_claim_token,
    p_outcome,
    p_idempotency_key,
    p_retry_at,
    p_error_code,
    p_error_message
  );

  update private.relationship_enrollment_idempotency
  set work_item_id = p_work_item_id
  where tenant_id = v_item.tenant_id
    and idempotency_key = btrim(p_idempotency_key)
    and operation = 'work_result';

  return v_response;
end;
$$;

revoke all on function private.record_relationship_campaign_work_result(
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  text,
  text
) from public, anon, authenticated;
grant execute on function private.record_relationship_campaign_work_result(
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  text,
  text
) to service_role;

comment on column private.relationship_enrollment_idempotency.work_item_id is
  'Binds a service result replay to one exact relationship campaign work item.';
