-- Forward-only correction. Keep established SECURITY DEFINER ownership and ACLs;
-- enforce caller capability before locking and scope cached results to the caller.
begin;

create or replace function public._crm_enrollment_tenant_check(p_enrollment_id uuid)
returns public.crm_campaign_enrollments
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_enrollment public.crm_campaign_enrollments;
  v_ctx jsonb;
  v_tenant_id uuid;
begin
  v_ctx := public.get_crm_operating_context();
  v_tenant_id := nullif(v_ctx->>'current_tenant_id','')::uuid;
  if auth.uid() is null or v_tenant_id is null
     or coalesce(v_ctx->>'crm_role','crm_none') not in ('crm_admin','crm_operator')
     or not coalesce((v_ctx->'capabilities'->>'mutate')::boolean,false) then
    raise exception 'permission denied: campaign lifecycle mutation requires an authorized operator' using errcode='42501';
  end if;
  -- Acquire the row before the wrapper checks its state, including different-key
  -- and no-key concurrent actions. Never lock a foreign tenant's enrollment.
  select * into v_enrollment from public.crm_campaign_enrollments
    where id=p_enrollment_id and tenant_id=v_tenant_id for update;
  if not found then raise exception 'enrollment_not_found' using errcode='P0002'; end if;
  return v_enrollment;
end;
$$;

create or replace function public._crm_idempotency_claim(
  p_key text, p_operation text, p_tenant_id uuid, p_target_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_entry public.crm_idempotency_keys;
begin
  if p_key is null or p_key='' then return null; end if;
  insert into public.crm_idempotency_keys(key,operation,actor_id,tenant_id,target_id,status,expires_at,result_json)
    values(p_key,p_operation,auth.uid(),p_tenant_id,p_target_id,'in_flight',now()+interval '24 hours',null)
    on conflict(key) do nothing returning * into v_entry;
  if found then return null; end if;
  -- ON CONFLICT may wait for another transaction. Re-read its committed result
  -- under a lock instead of returning an earlier stale NULL to the wrapper.
  select * into v_entry from public.crm_idempotency_keys where key=p_key for update;
  if not found or v_entry.operation is distinct from p_operation
      or v_entry.actor_id is distinct from auth.uid()
      or v_entry.tenant_id is distinct from p_tenant_id
      or v_entry.target_id is distinct from p_target_id then
    raise exception 'idempotency_scope_mismatch' using errcode='42501';
  end if;
  if v_entry.status='completed' and v_entry.result_json is not null then return v_entry.result_json; end if;
  -- A legacy committed in-flight entry cannot safely be executed again.
  raise exception 'idempotency_request_in_progress' using errcode='55000';
end;
$$;

create or replace function public._crm_idempotency_record(p_key text,p_operation text,p_result jsonb)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_key is null or p_key='' then return; end if;
  update public.crm_idempotency_keys set result_json=p_result,status='completed',updated_at=now()
    where key=p_key and operation=p_operation and actor_id is not distinct from auth.uid()
      and status='in_flight';
  if not found then raise exception 'idempotency_scope_mismatch' using errcode='42501'; end if;
end;
$$;

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

  -- CRM roles are tenant-specific. Do not require a single selected operating
  -- tenant here: the existing manual-enrollment contract supports multiple.
  if not exists (select 1 from public.crm_user_capabilities
    where profile_id=v_actor and tenant_id=v_campaign_tenant_id
      and crm_role in ('crm_admin','crm_operator')) then
    raise exception 'permission denied: campaign enrollment requires an authorized operator' using errcode='42501';
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


-- Reassert the internal boundary; CREATE OR REPLACE preserves service grants
-- and existing owners. No new browser or service privileges are introduced.
revoke execute on function public._crm_enrollment_tenant_check(uuid) from public,anon,authenticated;
revoke execute on function public._crm_idempotency_claim(text,text,uuid,uuid) from public,anon,authenticated;
revoke execute on function public._crm_idempotency_record(text,text,jsonb) from public,anon,authenticated;
commit;
