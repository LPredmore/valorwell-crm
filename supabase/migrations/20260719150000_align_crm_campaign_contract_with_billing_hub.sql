-- Align the ValorWell CRM campaign contract with the live Billing Hub schema.
-- This migration is intentionally limited to CRM campaign operations.

begin;

-- The action RPCs already emit these audit events. Keep the database audit
-- vocabulary aligned with the canonical CRM operations exposed to the app.
alter table public.crm_activity_events
  drop constraint if exists crm_activity_events_event_type_check;

alter table public.crm_activity_events
  add constraint crm_activity_events_event_type_check
  check (
    event_type = any (
      array[
        'status_change',
        'note_added',
        'email_sent',
        'email_received',
        'email_suppressed',
        'sms_sent',
        'sms_received',
        'sms_suppressed',
        'conversation_linked',
        'bulk_send',
        'campaign_auto_cancelled',
        'campaign_auto_enrolled',
        'campaign_enrolled',
        'campaign_cancelled_by_policy',
        'campaign_completion_state_action_deferred',
        'campaign_enrollment_paused',
        'campaign_enrollment_resumed',
        'campaign_enrollment_cancelled',
        'campaign_enrollment_responded',
        'campaign_enrollment_restarted',
        'client_synced_to_clickup',
        'lifecycle_changed',
        'engagement_changed',
        'contact_policy_changed',
        'service_policy_changed',
        'eligibility_changed',
        'care_cadence_changed',
        'clinician_assigned',
        'closed',
        'reopened'
      ]::text[]
    )
  );

-- Replace the obsolete response_payload references with the current
-- crm_idempotency_keys/result_json helper contract.
create or replace function public.crm_enroll_clients_in_campaign(
  p_campaign_id uuid,
  p_client_ids uuid[],
  p_reason text,
  p_idempotency_key uuid,
  p_contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  v_campaign_tenant_id uuid;
  v_campaign_is_active boolean;
  v_first_step_id uuid;
  v_first_step_delay_days integer;
  v_first_step_delay_hours integer;
  v_first_step_channel text;
  v_client_id uuid;
  v_client_tenant_id uuid;
  v_existing uuid;
  v_enrollment_id uuid;
  v_scheduled timestamptz;
  v_policy jsonb;
  v_first_channel text;
  v_message_class text := 'ordinary_campaign_follow_up';
  v_results jsonb := '[]'::jsonb;
  v_cached jsonb;
  v_idempotency_key text := p_idempotency_key::text;
begin
  if v_actor is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select tenant_id, is_active
    into v_campaign_tenant_id, v_campaign_is_active
    from public.crm_campaigns
   where id = p_campaign_id;

  if not found then
    raise exception 'campaign_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
      from public.tenant_memberships
     where user_id = v_actor
       and tenant_id = v_campaign_tenant_id
  ) then
    raise exception 'unauthorized_tenant' using errcode = '42501';
  end if;

  v_cached := public._crm_idempotency_claim(
    v_idempotency_key,
    'crm_enroll_clients_in_campaign',
    v_campaign_tenant_id,
    p_campaign_id
  );

  if v_cached is not null then
    return v_cached;
  end if;

  select id, delay_days, delay_hours, channel
    into v_first_step_id,
         v_first_step_delay_days,
         v_first_step_delay_hours,
         v_first_step_channel
    from public.crm_campaign_steps
   where campaign_id = p_campaign_id
     and is_active = true
   order by step_order
   limit 1;

  v_first_channel := coalesce(v_first_step_channel, 'email');

  foreach v_client_id in array coalesce(p_client_ids, array[]::uuid[])
  loop
    v_client_tenant_id := null;
    v_existing := null;
    v_enrollment_id := null;

    select tenant_id
      into v_client_tenant_id
      from public.clients
     where id = v_client_id;

    if not found or v_client_tenant_id <> v_campaign_tenant_id then
      v_results := v_results || jsonb_build_object(
        'client_id', v_client_id,
        'status', 'skipped',
        'reason', 'client_not_in_tenant'
      );
      continue;
    end if;

    if v_campaign_is_active = false then
      v_results := v_results || jsonb_build_object(
        'client_id', v_client_id,
        'status', 'skipped',
        'reason', 'campaign_inactive'
      );
      continue;
    end if;

    select id
      into v_existing
      from public.crm_campaign_enrollments
     where client_id = v_client_id
       and campaign_id = p_campaign_id
       and status in ('active', 'paused')
     limit 1;

    if v_existing is not null then
      v_results := v_results || jsonb_build_object(
        'client_id', v_client_id,
        'status', 'skipped',
        'reason', 'already_enrolled',
        'enrollment_id', v_existing
      );
      continue;
    end if;

    v_existing := null;

    select id
      into v_existing
      from public.crm_campaign_enrollments
     where tenant_id = v_campaign_tenant_id
       and client_id = v_client_id
       and status = 'active'
     limit 1;

    if v_existing is not null then
      v_results := v_results || jsonb_build_object(
        'client_id', v_client_id,
        'status', 'skipped',
        'reason', 'has_other_active_campaign',
        'enrollment_id', v_existing
      );
      continue;
    end if;

    v_policy := public.crm_evaluate_communication_policy(
      v_client_id,
      v_first_channel,
      v_message_class
    );

    if coalesce((v_policy ->> 'allowed')::boolean, false) = false then
      v_results := v_results || jsonb_build_object(
        'client_id', v_client_id,
        'status', 'suppressed',
        'reason', coalesce(v_policy ->> 'reason_code', 'policy_denied')
      );
      continue;
    end if;

    insert into public.crm_campaign_enrollments (
      campaign_id,
      client_id,
      tenant_id,
      current_step,
      status,
      enrolled_at,
      enrolled_by_profile_id
    )
    values (
      p_campaign_id,
      v_client_id,
      v_campaign_tenant_id,
      0,
      'active',
      now(),
      v_actor
    )
    returning id into v_enrollment_id;

    if v_first_step_id is not null then
      v_scheduled := now()
        + make_interval(days => coalesce(v_first_step_delay_days, 0))
        + make_interval(hours => coalesce(v_first_step_delay_hours, 0));

      insert into public.crm_campaign_step_logs (
        enrollment_id,
        step_id,
        tenant_id,
        client_id,
        scheduled_for,
        status,
        channel
      )
      values (
        v_enrollment_id,
        v_first_step_id,
        v_campaign_tenant_id,
        v_client_id,
        v_scheduled,
        'scheduled',
        v_first_step_channel
      );
    end if;

    insert into public.crm_activity_events (
      tenant_id,
      client_id,
      event_type,
      new_value,
      metadata,
      created_by_profile_id
    )
    values (
      v_campaign_tenant_id,
      v_client_id,
      'campaign_enrolled',
      p_campaign_id::text,
      jsonb_build_object(
        'campaign_id', p_campaign_id,
        'enrollment_id', v_enrollment_id,
        'reason', p_reason,
        'idempotency_key', p_idempotency_key,
        'contract_version', p_contract_version,
        'source', 'manual'
      ),
      v_actor
    );

    v_results := v_results || jsonb_build_object(
      'client_id', v_client_id,
      'status', 'enrolled',
      'enrollment_id', v_enrollment_id
    );
  end loop;

  perform public._crm_idempotency_record(
    v_idempotency_key,
    'crm_enroll_clients_in_campaign',
    v_results
  );

  return v_results;
end;
$function$;

-- These RPCs are authenticated CRM operations. Their internal tenant checks
-- remain authoritative, but anonymous/public execution is unnecessary.
revoke execute on function public.crm_enroll_clients_in_campaign(uuid, uuid[], text, uuid, text) from public, anon;
revoke execute on function public.crm_pause_enrollment(uuid, text, text) from public, anon;
revoke execute on function public.crm_resume_enrollment(uuid, text, text) from public, anon;
revoke execute on function public.crm_cancel_enrollment(uuid, text, text) from public, anon;
revoke execute on function public.crm_mark_enrollment_responded(uuid, text, text) from public, anon;
revoke execute on function public.crm_restart_enrollment(uuid, text, text) from public, anon;

grant execute on function public.crm_enroll_clients_in_campaign(uuid, uuid[], text, uuid, text) to authenticated, service_role;
grant execute on function public.crm_pause_enrollment(uuid, text, text) to authenticated, service_role;
grant execute on function public.crm_resume_enrollment(uuid, text, text) to authenticated, service_role;
grant execute on function public.crm_cancel_enrollment(uuid, text, text) to authenticated, service_role;
grant execute on function public.crm_mark_enrollment_responded(uuid, text, text) to authenticated, service_role;
grant execute on function public.crm_restart_enrollment(uuid, text, text) to authenticated, service_role;

comment on function public.crm_enroll_clients_in_campaign(uuid, uuid[], text, uuid, text) is
  'Canonical authenticated CRM manual-enrollment RPC aligned to the Billing Hub idempotency contract.';

commit;
