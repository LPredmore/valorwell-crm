-- Forward-only deployment envelope. Historical files/ledger remain unchanged.
-- Apply only this new version, not the superseded historical source files.
-- Prerequisites/recovery: docs/production-completion-2026-10-21.md.
BEGIN;
DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261020214527') THEN
  RAISE EXCEPTION 'Expected reviewed production baseline 20261020214527';
 END IF;
END $preflight$;
-- Read-only production definition fingerprints captured 2026-10-21.
DO $drift$
DECLARE entry record;
BEGIN
 FOR entry IN SELECT * FROM (VALUES
  ('public._crm_enrollment_tenant_check(uuid)','d46c778465deac143d3e4d47a38aeb3f2461566d262c43be418b990d21177f97'),
  ('public._crm_idempotency_claim(text,text,uuid,uuid)','4da46609342309a396b8a5f842c14fad7f6e44200059538e9207e0b3ce643e37'),
  ('public._crm_idempotency_record(text,text,jsonb)','04bc11b4eff017168e06770584a1fa382cacae1af61accb2001d717b20089fdd'),
  ('public.crm_correlate_client_email_reply(uuid)','38cc6a93a4070c54d80e423665cbdec7861f7b988ee16b3a5bf622a3f6fd8004'),
  ('public.crm_donor_overview()','b769782258d410d1bd9a647af238f7ec7605e7b2f2b7855789b7944f241415fe'),
  ('public.crm_emit_automation_event(uuid,text,text,uuid,text,jsonb,text,uuid,timestamp with time zone)','959e5fcce87a1e08db473dfaeaaf80aed64d870dc1db6f0b8c9a329ccf3a1e7f'),
  ('public.crm_enqueue_campaign_trigger_jobs(uuid)','1bb4b75f9b06b3f63748e0d483d3e249c2d67fafbd8a01a60a1767a965b7c13f'),
  ('public.crm_enqueue_donor_transactions(text,boolean,integer)','aae3defdd5fe92c5849f5c19e11a3445ff877c5b4b69c037dc85da0b03caa359'),
  ('public.crm_enroll_clients_in_campaign(uuid,uuid[],text,uuid,text)','6a4a2056f0a0fd68de33323645df9f1f8023a722e303e7cac8905c97fa7e28c5'),
  ('public.crm_evaluate_campaign_concurrency(uuid,uuid,text,uuid)','61ed82a147a1914ae22c1d29f7c82943f78ff2a728f7b3ada7ea29484aa04703'),
  ('private.invalidate_ai_operations_video_downstream_on_title_change()','8ec1c2286dcdbda05240a80db535e970a8d8134ec379e9ec09daa4407eb46ec1'),
  ('public.social_queue_publish(uuid)','d4109ff32fbc5a6fac9db43f03b3209b368fd7a54cad7ec4641fd3e9d0666f4e')
 ) AS expected(signature,sha256) LOOP
 IF to_regprocedure(entry.signature) IS NULL OR NOT EXISTS (
 SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(entry.signature) AND proowner='postgres'::regrole
 AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')=entry.sha256) THEN
 RAISE EXCEPTION 'Function drift for %: obtain updated private review before release',entry.signature;
 END IF;
 END LOOP;
END $drift$;
-- Reviewed source: 20261019000200_revoke_direct_crm_idempotency_helpers.sql
-- Forward-only least-privilege correction for internal CRM idempotency helpers.
-- Live audit 2026-10-18: authenticated could call both SECURITY DEFINER
-- helpers directly. _crm_idempotency_claim accepts a caller-supplied tenant ID
-- without independently validating tenant membership; _record can overwrite
-- a keyed result. These helpers are internal to postgres-owned SECURITY DEFINER
-- campaign lifecycle RPCs, not browser entry points.
-- Preserve the service_role's explicit grants and postgres owner privileges.

revoke execute on function public._crm_idempotency_claim(text,text,uuid,uuid)
  from public, anon, authenticated;
revoke execute on function public._crm_idempotency_record(text,text,jsonb)
  from public, anon, authenticated;

-- Reviewed source: 20261019000310_campaign_lifecycle_authorization_and_idempotency.sql
-- Forward-only correction. Keep established SECURITY DEFINER ownership and ACLs;
-- enforce caller capability before locking and scope cached results to the caller.

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

-- Reviewed source: 20261019165842_crm_campaign_membership_profile_contract.sql
-- Separate follow-on to the reviewed nine-migration October rollout.
-- The authoritative tenant_memberships relation identifies a member by profile_id.
-- Preserve the reviewed lifecycle function's authorization, idempotency and grants.

do $repair$
declare
  v_definition text := pg_get_functiondef(
    'public.crm_enroll_clients_in_campaign(uuid,uuid[],text,uuid,text)'::regprocedure
  );
  v_before text := E'where user_id = v_actor\n       and tenant_id = v_campaign_tenant_id';
  v_after text := E'where profile_id = v_actor\n       and tenant_id = v_campaign_tenant_id';
begin
  if position('campaign enrollment requires an authorized operator' in v_definition) = 0 then
    raise exception 'Apply the reviewed campaign lifecycle authorization migration before this correction';
  end if;
  if position(v_before in v_definition) = 0 then
    if position(v_after in v_definition) > 0 then return; end if;
    raise exception 'Unrecognized campaign membership predicate; review function drift before applying';
  end if;
  execute replace(v_definition, v_before, v_after);
end;
$repair$;

-- Reviewed source: 20261019000400_internal_campaign_social_worker_acl.sql
-- Narrow direct invocation of privileged CRM internal worker RPCs.
-- Social queue publish is intentionally called by social-media-manager using
-- its own service-role client after authenticated tenant/capability checks.
-- Trigger jobs are emitted by the postgres-owned SECURITY DEFINER
-- crm_emit_automation_event; the other helpers are internal worker utilities.

revoke execute on function public.social_queue_publish(uuid) from public, anon, authenticated;
revoke execute on function public.crm_enqueue_campaign_trigger_jobs(uuid) from public, anon, authenticated;
revoke execute on function public.crm_correlate_client_email_reply(uuid) from public, anon, authenticated;
revoke execute on function public.crm_evaluate_campaign_concurrency(uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.social_queue_publish(uuid) to service_role;
grant execute on function public.crm_enqueue_campaign_trigger_jobs(uuid) to service_role;
grant execute on function public.crm_correlate_client_email_reply(uuid) to service_role;
grant execute on function public.crm_evaluate_campaign_concurrency(uuid,uuid,text,uuid) to service_role;

-- Reviewed source: 20261019000410_ai_ops_title_trigger_search_path.sql
-- Supabase advisor 0011: this SECURITY INVOKER trigger is in private,
-- calls only pg_catalog builtins, and accesses NEW/OLD row values.
-- Pin its search path to remove caller-controlled resolution.

alter function private.invalidate_ai_operations_video_downstream_on_title_change()
  set search_path = '';

-- Reviewed source: 20261019000500_fail_closed_legacy_donor_attribution.sql
-- Legacy Givebutter is retired. Historic donations lack a trusted tenant key.
-- A CRM user's selected tenant must never be used to claim every global
-- Givebutter donation as belonging to that tenant.
-- Preserve all imported evidence and previously queued records. No deletion.

create or replace function public.crm_donor_overview()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $body$
declare
  v_context jsonb := private.relationship_campaign_context(false);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
begin
  return jsonb_build_object(
    'donors', (select count(*) from public.crm_donors where tenant_id=v_tenant),
    'recurringDonors', (select count(*) from public.crm_donors where tenant_id=v_tenant and recurring_status='active'),
    'lifetimeAmount', coalesce((select sum(lifetime_amount) from public.crm_donors where tenant_id=v_tenant),0),
    'queuePending', (select count(*) from public.crm_donor_ingest_queue where tenant_id=v_tenant and status='pending'),
    'queueFailed', (select count(*) from public.crm_donor_ingest_queue where tenant_id=v_tenant and status='failed'),
    -- Do not report a global, cross-tenant count as a tenant donation metric.
    'totalDonations', null,
    'totalDonationsStatus', 'legacy_source_tenant_ownership_unverified'
  );
end;
$body$;
create or replace function public.crm_enqueue_donor_transactions(
  p_reason text, p_historical boolean default true, p_limit integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $body$
begin
  -- Preserve the existing CRM permission boundary even on rejected attempts.
  perform private.relationship_campaign_context(true);
  raise exception 'LEGACY_DONOR_SOURCE_OWNERSHIP_REQUIRED: historical Givebutter enqueue is disabled until each transaction has a verified tenant mapping'
    using errcode='42501';
end;
$body$;
-- Keep existing explicit permissions for crm_donor_overview, but never grant
-- an unverified legacy replay path to service_role or an authenticated user.

-- Reviewed source: 20261019000600_restrict_crm_automation_event_emitter.sql
-- Restrict direct browser invocation of the privileged automation-event emitter.
-- Live 2026-10-18 audit: authenticated EXECUTE on a postgres-owned
-- SECURITY DEFINER RPC accepting caller-supplied tenant, event, subject,
-- payload, and source. The function writes automation events and immediately
-- invokes the campaign trigger-job helper.
-- Reviewed database call sites are postgres-owned SECURITY DEFINER functions;
-- the trusted service_role is explicitly retained.
-- Forward only; no event, campaign, or queued job is mutated by this change.

revoke execute on function public.crm_emit_automation_event(
  uuid,text,text,uuid,text,jsonb,text,uuid,timestamptz
) from public, anon, authenticated;
grant execute on function public.crm_emit_automation_event(
  uuid,text,text,uuid,text,jsonb,text,uuid,timestamptz
) to service_role;

-- Reviewed source: 20261019000800_campaign_lifecycle_forbidden_response.sql
-- Forward-only HTTP error classification correction. Missing and foreign targets
-- share the same denial, without exposing whether a foreign enrollment exists.
-- Preserve owner, ACL, VOLATILE and FOR UPDATE scope from 00310.

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
  if not found then raise exception 'enrollment_not_found' using errcode='42501'; end if;
  return v_enrollment;
end;
$$;

COMMIT;
