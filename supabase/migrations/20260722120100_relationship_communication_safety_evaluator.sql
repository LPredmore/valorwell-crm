create or replace function private.relationship_safety_context(p_require_mutation boolean default false)
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  select private.relationship_campaign_context(p_require_mutation);
$function$;
create or replace function private.relationship_suppression_json(p_suppression_id uuid)
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', suppression.id,
    'scope', suppression.scope,
    'reason', suppression.reason,
    'organizationId', suppression.organization_id,
    'contactId', suppression.contact_id,
    'campaignId', suppression.campaign_id,
    'email', suppression.email,
    'effectiveAt', suppression.effective_at,
    'expiresAt', suppression.expires_at,
    'revokedAt', suppression.revoked_at,
    'revokedBy', suppression.revoked_by_profile_id,
    'version', suppression.version,
    'source', suppression.source,
    'metadata', suppression.metadata,
    'createdAt', suppression.created_at,
    'updatedAt', suppression.updated_at,
    'createdBy', suppression.created_by_profile_id,
    'updatedBy', suppression.updated_by_profile_id
  ))
  from public.relationship_suppressions suppression
  where suppression.id = p_suppression_id;
$function$;
create or replace function private.relationship_unsubscribe_request_json(p_request_id uuid)
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', request.id,
    'tokenId', request.token_id,
    'email', request.email,
    'processedAt', request.processed_at,
    'suppressionId', request.suppression_id,
    'outcome', request.outcome,
    'createdAt', request.created_at,
    'updatedAt', request.updated_at
  ))
  from public.relationship_unsubscribe_requests request
  where request.id = p_request_id;
$function$;
create or replace function private.evaluate_relationship_safety_values(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_contact_id uuid,
  p_organization_id uuid,
  p_opportunity_id uuid,
  p_recipient_email text,
  p_source_language_mode text,
  p_eligibility_snapshot jsonb
)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_campaign public.relationship_campaigns%rowtype;
  v_contact public.relationship_contacts%rowtype;
  v_organization public.relationship_organizations%rowtype;
  v_opportunity public.relationship_opportunities%rowtype;
  v_referral public.relationship_referrals%rowtype;
  v_referral_id uuid := nullif(p_eligibility_snapshot ->> 'verifiedReferralId', '')::uuid;
  v_email text := nullif(lower(btrim(p_recipient_email)), '');
  v_reasons text[] := '{}'::text[];
  v_suppressions jsonb := '[]'::jsonb;
  v_primary jsonb;
  v_source_valid boolean := true;
begin
  select * into v_campaign
  from public.relationship_campaigns campaign
  where campaign.tenant_id = p_tenant_id and campaign.id = p_campaign_id;
  if not found then
    v_reasons := array_append(v_reasons, 'campaign_not_found');
  elsif v_campaign.status <> 'active' then
    v_reasons := array_append(v_reasons, 'campaign_not_active');
  end if;
  select * into v_contact
  from public.relationship_contacts contact
  where contact.tenant_id = p_tenant_id and contact.id = p_contact_id;
  if not found then
    v_reasons := array_append(v_reasons, 'contact_not_found');
  else
    if nullif(lower(btrim(v_contact.email)), '') is null then
      v_reasons := array_append(v_reasons, 'missing_email');
    elsif nullif(lower(btrim(v_contact.email)), '') is distinct from v_email then
      v_reasons := array_append(v_reasons, 'recipient_email_changed');
    end if;
    if v_contact.do_not_contact then
      v_reasons := array_append(v_reasons, 'contact_do_not_contact');
    end if;
  end if;
  if p_organization_id is not null then
    select * into v_organization
    from public.relationship_organizations organization
    where organization.tenant_id = p_tenant_id and organization.id = p_organization_id;
    if not found then
      v_reasons := array_append(v_reasons, 'organization_not_found');
    else
      if v_organization.do_not_contact then
        v_reasons := array_append(v_reasons, 'organization_do_not_contact');
      end if;
      if not exists (
        select 1 from public.relationship_contact_organizations affiliation
        where affiliation.tenant_id = p_tenant_id
          and affiliation.organization_id = p_organization_id
          and affiliation.contact_id = p_contact_id
      ) then
        v_reasons := array_append(v_reasons, 'contact_not_linked_to_organization');
      end if;
    end if;
  end if;
  if p_opportunity_id is not null then
    select * into v_opportunity
    from public.relationship_opportunities opportunity
    where opportunity.tenant_id = p_tenant_id and opportunity.id = p_opportunity_id;
    if not found then
      v_reasons := array_append(v_reasons, 'opportunity_not_found');
    else
      if v_opportunity.organization_id is distinct from p_organization_id
         or (v_opportunity.primary_contact_id is not null and v_opportunity.primary_contact_id is distinct from p_contact_id) then
        v_reasons := array_append(v_reasons, 'opportunity_context_changed');
      end if;
      if v_opportunity.status <> all (array['qualified','ready_for_campaign']::text[]) then
        v_reasons := array_append(v_reasons, 'opportunity_not_qualified');
      end if;
      if v_opportunity.review_status <> 'approved' then
        v_reasons := array_append(v_reasons, 'review_not_approved');
      end if;
    end if;
  end if;
  if p_source_language_mode = any (array['verified_anonymous','verified_named']::text[]) then
    v_source_valid := false;
    if v_referral_id is not null then
      select * into v_referral
      from public.relationship_referrals referral
      where referral.tenant_id = p_tenant_id and referral.id = v_referral_id;
      v_source_valid := found
        and v_referral.verified
        and v_referral.revoked_at is null
        and ((v_referral.contact_id is not null and v_referral.contact_id = p_contact_id)
          or (v_referral.organization_id is not null and v_referral.organization_id = p_organization_id))
        and ((p_source_language_mode = 'verified_anonymous' and v_referral.disclosure = 'community_anonymous')
          or (p_source_language_mode = 'verified_named' and v_referral.disclosure = 'named_referrer'
            and nullif(btrim(v_referral.named_referrer), '') is not null));
    end if;
    if not v_source_valid then
      v_reasons := array_append(v_reasons, 'source_evidence_invalid');
    end if;
  end if;
  with matches as (
    select suppression.*,
      case suppression.scope
        when 'global' then 1 when 'email' then 2 when 'contact' then 3
        when 'organization' then 4 when 'campaign' then 5 else 99 end as scope_rank,
      case suppression.reason
        when 'complaint' then 1 when 'unsubscribe' then 2 when 'do_not_contact' then 3
        when 'invalid_address' then 4 when 'bounce' then 5 when 'manual' then 6
        when 'campaign_stop' then 7 else 99 end as reason_rank
    from public.relationship_suppressions suppression
    where suppression.tenant_id = p_tenant_id
      and suppression.revoked_at is null
      and suppression.effective_at <= now()
      and (suppression.expires_at is null or suppression.expires_at > now())
      and (
        suppression.scope = 'global'
        or (suppression.scope = 'email' and lower(suppression.email) = v_email)
        or (suppression.scope = 'contact' and suppression.contact_id = p_contact_id)
        or (suppression.scope = 'organization' and suppression.organization_id = p_organization_id)
        or (suppression.scope = 'campaign' and suppression.campaign_id = p_campaign_id)
      )
  ), ordered as (
    select * from matches order by scope_rank, reason_rank, effective_at, id
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', id, 'scope', scope, 'reason', reason,
      'organizationId', organization_id, 'contactId', contact_id,
      'campaignId', campaign_id, 'email', email,
      'effectiveAt', effective_at, 'expiresAt', expires_at
    )) order by scope_rank, reason_rank, effective_at, id), '[]'::jsonb),
    (jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', id, 'scope', scope, 'reason', reason,
      'organizationId', organization_id, 'contactId', contact_id,
      'campaignId', campaign_id, 'email', email,
      'effectiveAt', effective_at, 'expiresAt', expires_at
    )) order by scope_rank, reason_rank, effective_at, id) -> 0)
  into v_suppressions, v_primary
  from ordered;
  if jsonb_array_length(v_suppressions) > 0 then
    v_reasons := array_append(v_reasons, 'suppressed');
  end if;
  v_reasons := array(select distinct reason from unnest(v_reasons) reason order by reason);
  return jsonb_strip_nulls(jsonb_build_object(
    'eligible', cardinality(v_reasons) = 0,
    'safetyEligible', cardinality(v_reasons) = 0,
    'safetyStatus', case when cardinality(v_reasons) = 0 then 'ready' else 'blocked' end,
    'deliveryEnabled', false,
    'reasons', to_jsonb(v_reasons),
    'suppressions', v_suppressions,
    'primarySuppression', v_primary,
    'policyVersion', 'pass11-v1',
    'evaluatedAt', now(),
    'campaignId', p_campaign_id,
    'contactId', p_contact_id,
    'organizationId', p_organization_id,
    'opportunityId', p_opportunity_id,
    'recipientEmail', v_email,
    'sourceLanguageMode', p_source_language_mode
  ));
end;
$function$;
create or replace function private.evaluate_relationship_enrollment_safety(p_enrollment_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_enrollment public.relationship_campaign_enrollments%rowtype;
begin
  select * into v_enrollment from public.relationship_campaign_enrollments where id = p_enrollment_id;
  if not found then
    raise exception 'Relationship campaign enrollment not found.' using errcode = 'P0002';
  end if;
  return private.evaluate_relationship_safety_values(
    v_enrollment.tenant_id, v_enrollment.campaign_id, v_enrollment.contact_id,
    v_enrollment.organization_id, v_enrollment.opportunity_id,
    v_enrollment.recipient_email, v_enrollment.source_language_mode,
    v_enrollment.eligibility_snapshot
  );
end;
$function$;
create or replace function private.set_relationship_enrollment_safety_on_insert()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_safety jsonb;
begin
  v_safety := private.evaluate_relationship_safety_values(
    new.tenant_id, new.campaign_id, new.contact_id, new.organization_id,
    new.opportunity_id, new.recipient_email, new.source_language_mode,
    new.eligibility_snapshot
  );
  if coalesce((v_safety ->> 'eligible')::boolean, false) is not true then
    raise exception 'Enrollment target is blocked by communication safety policy: %', coalesce(v_safety -> 'reasons', '[]'::jsonb)::text using errcode = '22023';
  end if;
  new.safety_status := 'ready';
  new.safety_snapshot := v_safety;
  new.safety_evaluated_at := now();
  new.safety_ready_at := now();
  new.safety_blocked_at := null;
  return new;
end;
$function$;
create trigger relationship_campaign_enrollments_safety_insert
before insert on public.relationship_campaign_enrollments
for each row execute function private.set_relationship_enrollment_safety_on_insert();
create or replace function private.revalidate_relationship_enrollment(
  p_tenant_id uuid,
  p_enrollment_id uuid,
  p_actor_id uuid,
  p_event_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_enrollment public.relationship_campaign_enrollments%rowtype;
  v_safety jsonb;
  v_ready boolean;
  v_old_status text;
  v_new_status text;
  v_event_type text;
  v_reason text;
begin
  select * into v_enrollment
  from public.relationship_campaign_enrollments enrollment
  where enrollment.tenant_id = p_tenant_id and enrollment.id = p_enrollment_id
  for update;
  if not found then
    raise exception 'Relationship campaign enrollment not found.' using errcode = 'P0002';
  end if;
  v_safety := private.evaluate_relationship_enrollment_safety(v_enrollment.id);
  v_ready := coalesce((v_safety ->> 'eligible')::boolean, false);
  v_old_status := v_enrollment.status;
  v_new_status := v_enrollment.status;
  v_reason := coalesce(nullif(btrim(p_event_reason), ''), array_to_string(array(select jsonb_array_elements_text(coalesce(v_safety -> 'reasons', '[]'::jsonb))), ', '));
  if v_ready then
    update public.relationship_campaign_enrollments
    set safety_status = 'ready',
        safety_snapshot = v_safety,
        safety_evaluated_at = now(),
        safety_ready_at = now(),
        safety_blocked_at = null,
        updated_by_profile_id = p_actor_id
    where id = v_enrollment.id;
    v_event_type := 'safety_ready';
  else
    if v_enrollment.status = any (array['pending','active','paused']::text[]) then
      v_new_status := 'suppressed';
    end if;
    update public.relationship_campaign_enrollments
    set safety_status = 'blocked',
        safety_snapshot = v_safety,
        safety_evaluated_at = now(),
        safety_blocked_at = now(),
        safety_ready_at = null,
        status = v_new_status,
        next_scheduled_at = case when v_new_status = 'suppressed' then null else next_scheduled_at end,
        stopped_reason = case when v_new_status = 'suppressed' then coalesce(nullif(v_reason, ''), 'Blocked by communication safety policy.') else stopped_reason end,
        updated_by_profile_id = p_actor_id
    where id = v_enrollment.id;
    update private.relationship_campaign_work_items
    set status = 'cancelled', claim_token = null, claimed_by = null, claimed_at = null,
        lease_expires_at = null, updated_at = now(),
        metadata = metadata || jsonb_build_object('cancelled_reason', coalesce(nullif(v_reason, ''), 'Communication safety policy blocked enrollment.'))
    where tenant_id = p_tenant_id and enrollment_id = v_enrollment.id
      and status = any (array['planned','retry_wait','claimed']::text[]);
    v_event_type := case when v_new_status = 'suppressed' and v_old_status <> 'suppressed' then 'suppressed' else 'safety_blocked' end;
  end if;
  insert into public.relationship_enrollment_events (
    tenant_id, enrollment_id, event_type, from_status, to_status, reason,
    actor_profile_id, metadata
  ) values (
    p_tenant_id, v_enrollment.id, v_event_type, v_old_status, v_new_status,
    nullif(v_reason, ''), p_actor_id,
    jsonb_build_object('safety', v_safety, 'delivery_enabled', false)
  );
  if not v_ready and v_new_status = 'suppressed' then
    insert into public.relationship_interactions (
      tenant_id, organization_id, contact_id, opportunity_id, interaction_type,
      occurred_at, summary, metadata, created_by_profile_id, updated_by_profile_id
    ) values (
      p_tenant_id, v_enrollment.organization_id, v_enrollment.contact_id, v_enrollment.opportunity_id,
      'suppression', now(), 'Campaign enrollment stopped by communication safety policy.',
      jsonb_build_object('campaign_id', v_enrollment.campaign_id, 'enrollment_id', v_enrollment.id,
        'reason', v_reason, 'safety', v_safety), p_actor_id, p_actor_id
    );
  end if;
  return private.relationship_enrollment_json(v_enrollment.id);
end;
$function$;
