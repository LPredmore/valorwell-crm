create or replace function private.relationship_enrollment_json(p_enrollment_id uuid)
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', enrollment.id,
    'campaignId', enrollment.campaign_id,
    'contactId', enrollment.contact_id,
    'organizationId', enrollment.organization_id,
    'opportunityId', enrollment.opportunity_id,
    'recipientEmail', enrollment.recipient_email,
    'recipientName', enrollment.recipient_name,
    'status', enrollment.status,
    'currentStepPosition', enrollment.current_step_position,
    'nextScheduledAt', enrollment.next_scheduled_at,
    'stoppedReason', enrollment.stopped_reason,
    'respondedAt', enrollment.responded_at,
    'sourceLanguageMode', enrollment.source_language_mode,
    'personalizationContext', enrollment.personalization_context,
    'eligibilitySnapshot', enrollment.eligibility_snapshot,
    'safetyStatus', enrollment.safety_status,
    'safetySnapshot', enrollment.safety_snapshot,
    'safetyEvaluatedAt', enrollment.safety_evaluated_at,
    'safetyReadyAt', enrollment.safety_ready_at,
    'safetyBlockedAt', enrollment.safety_blocked_at,
    'deliveryEnabled', enrollment.delivery_enabled,
    'version', enrollment.version,
    'enrolledBy', enrollment.enrolled_by_profile_id,
    'createdAt', enrollment.created_at,
    'updatedAt', enrollment.updated_at,
    'createdBy', enrollment.created_by_profile_id,
    'updatedBy', enrollment.updated_by_profile_id
  ))
  from public.relationship_campaign_enrollments enrollment
  where enrollment.id = p_enrollment_id;
$function$;
create or replace function private.enroll_relationship_targets(p_campaign_id uuid, p_targets jsonb, p_expected_campaign_version bigint, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_context jsonb := private.relationship_enrollment_context(true);
  v_actor uuid := (v_context ->> 'actor_id')::uuid;
  v_tenant_id uuid := (v_context ->> 'tenant_id')::uuid;
  v_campaign public.relationship_campaigns%rowtype;
  v_target jsonb;
  v_evaluation jsonb;
  v_evaluations jsonb := '[]'::jsonb;
  v_existing_operation text;
  v_existing_campaign_id uuid;
  v_existing_response jsonb;
  v_enrollment_id uuid;
  v_enrollment_ids uuid[] := '{}'::uuid[];
  v_contact_id uuid;
  v_organization_id uuid;
  v_opportunity_id uuid;
  v_first_step public.relationship_campaign_steps%rowtype;
  v_due_at timestamptz;
  v_response jsonb;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Enrollment idempotency key is required.' using errcode = '22023';
  end if;
  if p_targets is null or jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) = 0 then
    raise exception 'At least one enrollment target is required.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_targets) > 100 then
    raise exception 'Enrollment is limited to 100 targets per request.' using errcode = '22023';
  end if;
  select operation, campaign_id, response
  into v_existing_operation, v_existing_campaign_id, v_existing_response
  from private.relationship_enrollment_idempotency
  where tenant_id = v_tenant_id and idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing_operation <> 'enroll' or v_existing_campaign_id <> p_campaign_id then
      raise exception 'Enrollment idempotency key was already used for a different operation.' using errcode = '23505';
    end if;
    return v_existing_response;
  end if;
  select * into v_campaign
  from public.relationship_campaigns campaign
  where campaign.tenant_id = v_tenant_id and campaign.id = p_campaign_id
  for update;
  if not found then raise exception 'Relationship campaign not found.' using errcode = 'P0002'; end if;
  if p_expected_campaign_version is null or p_expected_campaign_version <> v_campaign.version then
    raise exception 'Campaign changed after it was loaded. Refresh and retry.' using errcode = '40001';
  end if;
  if v_campaign.status <> 'active' then raise exception 'Only an active campaign definition can accept enrollments.' using errcode = '22023'; end if;
  select * into v_first_step
  from public.relationship_campaign_steps step
  where step.tenant_id = v_tenant_id and step.campaign_id = p_campaign_id and step.is_active
  order by step.position limit 1;
  if not found then raise exception 'Campaign has no active step to plan.' using errcode = '22023'; end if;
  for v_target in select value from jsonb_array_elements(p_targets) loop
    v_evaluation := private.evaluate_relationship_campaign_target(v_tenant_id, p_campaign_id, v_target);
    v_evaluations := v_evaluations || jsonb_build_array(v_evaluation);
    if coalesce((v_evaluation ->> 'eligible')::boolean, false) is not true then
      raise exception 'Enrollment target is not eligible: %', coalesce(v_evaluation -> 'reasons', '[]'::jsonb)::text using errcode = '22023';
    end if;
  end loop;
  for v_evaluation in select value from jsonb_array_elements(v_evaluations) loop
    v_contact_id := (v_evaluation ->> 'resolvedContactId')::uuid;
    v_organization_id := nullif(v_evaluation ->> 'organizationId', '')::uuid;
    v_opportunity_id := nullif(v_evaluation ->> 'opportunityId', '')::uuid;
    v_due_at := private.relationship_campaign_schedule_at(
      now(), v_campaign.default_timezone, v_campaign.weekdays_only,
      v_campaign.send_window_start, v_campaign.send_window_end, v_first_step.delay_days
    );
    insert into public.relationship_campaign_enrollments (
      tenant_id, campaign_id, contact_id, organization_id, opportunity_id,
      recipient_email, recipient_name, status, current_step_position, next_scheduled_at,
      source_language_mode, personalization_context, eligibility_snapshot,
      safety_status, delivery_enabled, enrolled_by_profile_id, metadata,
      created_by_profile_id, updated_by_profile_id
    ) values (
      v_tenant_id, p_campaign_id, v_contact_id, v_organization_id, v_opportunity_id,
      v_evaluation ->> 'recipientEmail', v_evaluation ->> 'recipientName', 'pending',
      v_first_step.position, v_due_at,
      v_evaluation ->> 'sourceLanguageMode', coalesce(v_evaluation -> 'personalizationContext', '{}'::jsonb),
      v_evaluation, 'pending_pass_11', false, v_actor,
      jsonb_build_object('execution_boundary', 'disabled_until_pass_12'),
      v_actor, v_actor
    ) returning id into v_enrollment_id;
    v_enrollment_ids := array_append(v_enrollment_ids, v_enrollment_id);
    insert into private.relationship_campaign_work_items (
      tenant_id, campaign_id, enrollment_id, campaign_step_id, step_position,
      status, due_at, available_at, idempotency_key, metadata
    ) values (
      v_tenant_id, p_campaign_id, v_enrollment_id, v_first_step.id, v_first_step.position,
      'planned', v_due_at, v_due_at,
      format('enrollment:%s:step:%s', v_enrollment_id, v_first_step.id),
      jsonb_build_object('execution_boundary', 'dormant_until_pass_12')
    );
    insert into public.relationship_enrollment_events (
      tenant_id, enrollment_id, event_type, from_status, to_status, reason,
      actor_profile_id, metadata
    ) values
      (v_tenant_id, v_enrollment_id, 'enrolled', null, 'pending',
       'Recipient resolved, preliminary eligibility snapshotted, and communication safety passed.', v_actor,
       jsonb_build_object('safety_status', 'ready', 'delivery_enabled', false, 'policy_version', 'pass11-v1')),
      (v_tenant_id, v_enrollment_id, 'safety_ready', 'pending', 'pending',
       'Enrollment passed current communication safety policy.', v_actor,
       jsonb_build_object('delivery_enabled', false, 'policy_version', 'pass11-v1')),
      (v_tenant_id, v_enrollment_id, 'work_planned', 'pending', 'pending',
       'First campaign step planned; delivery remains disabled until Pass 12.', v_actor,
       jsonb_build_object('step_position', v_first_step.position, 'due_at', v_due_at));
    insert into public.relationship_interactions (
      tenant_id, organization_id, contact_id, opportunity_id, interaction_type,
      occurred_at, summary, metadata, created_by_profile_id, updated_by_profile_id
    ) values (
      v_tenant_id, v_organization_id, v_contact_id, v_opportunity_id,
      'campaign_enrollment', now(),
      format('Added %s to campaign %s after communication safety review. Delivery remains disabled.',
        coalesce(v_evaluation ->> 'recipientName', v_evaluation ->> 'recipientEmail'), v_campaign.name),
      jsonb_build_object('campaign_id', p_campaign_id, 'enrollment_id', v_enrollment_id,
        'safety_status', 'ready', 'delivery_enabled', false),
      v_actor, v_actor
    );
  end loop;
  select coalesce(jsonb_agg(private.relationship_enrollment_json(enrollment.id) order by enrollment.created_at, enrollment.id), '[]'::jsonb)
  into v_response
  from public.relationship_campaign_enrollments enrollment
  where enrollment.tenant_id = v_tenant_id and enrollment.id = any (v_enrollment_ids);
  insert into private.relationship_enrollment_idempotency (
    tenant_id, idempotency_key, operation, campaign_id, actor_profile_id, response
  ) values (v_tenant_id, btrim(p_idempotency_key), 'enroll', p_campaign_id, v_actor, v_response);
  return v_response;
end;
$function$;
create or replace function private.revalidate_enrollments_for_contact_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_enrollment record;
begin
  if new.do_not_contact is distinct from old.do_not_contact or new.email is distinct from old.email then
    for v_enrollment in select id from public.relationship_campaign_enrollments where tenant_id=new.tenant_id and contact_id=new.id loop
      perform private.revalidate_relationship_enrollment(new.tenant_id,v_enrollment.id,auth.uid(),'Contact communication policy changed.');
    end loop;
  end if;
  return new;
end;
$function$;
create trigger relationship_contacts_revalidate_enrollment_safety
after update of do_not_contact,email on public.relationship_contacts
for each row execute function private.revalidate_enrollments_for_contact_change();
create or replace function private.revalidate_enrollments_for_organization_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_enrollment record;
begin
  if new.do_not_contact is distinct from old.do_not_contact then
    for v_enrollment in select id from public.relationship_campaign_enrollments where tenant_id=new.tenant_id and organization_id=new.id loop
      perform private.revalidate_relationship_enrollment(new.tenant_id,v_enrollment.id,auth.uid(),'Organization communication policy changed.');
    end loop;
  end if;
  return new;
end;
$function$;
create trigger relationship_organizations_revalidate_enrollment_safety
after update of do_not_contact on public.relationship_organizations
for each row execute function private.revalidate_enrollments_for_organization_change();
create or replace function private.revalidate_enrollments_for_referral_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_enrollment record;
begin
  if new.verified is distinct from old.verified or new.revoked_at is distinct from old.revoked_at
     or new.disclosure is distinct from old.disclosure or new.named_referrer is distinct from old.named_referrer then
    for v_enrollment in
      select id from public.relationship_campaign_enrollments
      where tenant_id=new.tenant_id and eligibility_snapshot ->> 'verifiedReferralId'=new.id::text
    loop
      perform private.revalidate_relationship_enrollment(new.tenant_id,v_enrollment.id,auth.uid(),'Verified referral evidence changed.');
    end loop;
  end if;
  return new;
end;
$function$;
create trigger relationship_referrals_revalidate_enrollment_safety
after update of verified,revoked_at,disclosure,named_referrer on public.relationship_referrals
for each row execute function private.revalidate_enrollments_for_referral_change();
create or replace function private.stop_enrollments_for_campaign_terminal_state()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_enrollment record;
begin
  if new.status is distinct from old.status and new.status=any(array['completed','archived']::text[]) then
    for v_enrollment in
      select id from public.relationship_campaign_enrollments
      where tenant_id=new.tenant_id and campaign_id=new.id
        and status=any(array['pending','active','paused']::text[])
    loop
      perform private.revalidate_relationship_enrollment(new.tenant_id,v_enrollment.id,auth.uid(),format('Campaign entered terminal state: %s.',new.status));
    end loop;
  end if;
  return new;
end;
$function$;
create trigger relationship_campaigns_stop_terminal_enrollments
after update of status on public.relationship_campaigns
for each row execute function private.stop_enrollments_for_campaign_terminal_state();
create or replace function private.enforce_relationship_work_claim_safety()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_safety jsonb; v_enrollment public.relationship_campaign_enrollments%rowtype; v_campaign public.relationship_campaigns%rowtype;
begin
  if new.status='claimed' and old.status is distinct from 'claimed' then
    select * into v_enrollment from public.relationship_campaign_enrollments where tenant_id=new.tenant_id and id=new.enrollment_id;
    select * into v_campaign from public.relationship_campaigns where tenant_id=new.tenant_id and id=new.campaign_id;
    v_safety:=private.evaluate_relationship_enrollment_safety(new.enrollment_id);
    if v_campaign.execution_enabled is not true or v_enrollment.delivery_enabled is not true
       or v_enrollment.safety_status<>'ready' or coalesce((v_safety->>'eligible')::boolean,false) is not true then
      raise exception 'Campaign work cannot be claimed because execution, delivery, or current communication safety policy is not ready.' using errcode='42501';
    end if;
  end if;
  return new;
end;
$function$;
create trigger relationship_campaign_work_claim_safety
before update of status on private.relationship_campaign_work_items
for each row execute function private.enforce_relationship_work_claim_safety();
revoke all on function private.relationship_enrollment_json(uuid) from public,anon,authenticated;
grant execute on function private.relationship_enrollment_json(uuid) to authenticated,service_role;
revoke all on function private.enroll_relationship_targets(uuid,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function private.enroll_relationship_targets(uuid,jsonb,bigint,text) to authenticated,service_role;
revoke all on function private.revalidate_enrollments_for_contact_change() from public,anon,authenticated;
revoke all on function private.revalidate_enrollments_for_organization_change() from public,anon,authenticated;
revoke all on function private.revalidate_enrollments_for_referral_change() from public,anon,authenticated;
revoke all on function private.stop_enrollments_for_campaign_terminal_state() from public,anon,authenticated;
revoke all on function private.enforce_relationship_work_claim_safety() from public,anon,authenticated;
