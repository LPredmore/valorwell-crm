create or replace function private.apply_relationship_suppression(p_payload jsonb, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_context jsonb := private.relationship_safety_context(true);
  v_actor uuid := (v_context ->> 'actor_id')::uuid;
  v_tenant_id uuid := (v_context ->> 'tenant_id')::uuid;
  v_scope text := lower(btrim(p_payload ->> 'scope'));
  v_reason text := lower(btrim(p_payload ->> 'reason'));
  v_org_id uuid := nullif(p_payload ->> 'organizationId', '')::uuid;
  v_contact_id uuid := nullif(p_payload ->> 'contactId', '')::uuid;
  v_campaign_id uuid := nullif(p_payload ->> 'campaignId', '')::uuid;
  v_email text := nullif(lower(btrim(p_payload ->> 'email')), '');
  v_effective_at timestamptz := coalesce(nullif(p_payload ->> 'effectiveAt', '')::timestamptz, now());
  v_expires_at timestamptz := nullif(p_payload ->> 'expiresAt', '')::timestamptz;
  v_source text := coalesce(nullif(lower(btrim(p_payload ->> 'source')), ''), 'crm_manual');
  v_metadata jsonb := coalesce(p_payload -> 'metadata', '{}'::jsonb);
  v_suppression_id uuid;
  v_existing_operation text;
  v_existing_suppression_id uuid;
  v_existing_response jsonb;
  v_response jsonb;
  v_enrollment record;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'Suppression payload must be an object.' using errcode='22023'; end if;
  if nullif(btrim(p_idempotency_key), '') is null then raise exception 'Suppression idempotency key is required.' using errcode='22023'; end if;
  if v_scope <> all (array['global','organization','contact','email','campaign']::text[]) then raise exception 'Suppression scope is invalid.' using errcode='22023'; end if;
  if v_reason <> all (array['manual','unsubscribe','do_not_contact','invalid_address','bounce','complaint','campaign_stop']::text[]) then raise exception 'Suppression reason is invalid.' using errcode='22023'; end if;
  if jsonb_typeof(v_metadata) <> 'object' then raise exception 'Suppression metadata must be an object.' using errcode='22023'; end if;
  if v_expires_at is not null and v_expires_at <= v_effective_at then raise exception 'Suppression expiration must follow its effective time.' using errcode='22023'; end if;
  if not (
    (v_scope='global' and v_org_id is null and v_contact_id is null and v_campaign_id is null and v_email is null)
    or (v_scope='organization' and v_org_id is not null and v_contact_id is null and v_campaign_id is null and v_email is null)
    or (v_scope='contact' and v_org_id is null and v_contact_id is not null and v_campaign_id is null and v_email is null)
    or (v_scope='email' and v_org_id is null and v_contact_id is null and v_campaign_id is null and v_email is not null)
    or (v_scope='campaign' and v_org_id is null and v_contact_id is null and v_campaign_id is not null and v_email is null)
  ) then raise exception 'Suppression target does not match its scope.' using errcode='22023'; end if;
  select operation, suppression_id, response into v_existing_operation, v_existing_suppression_id, v_existing_response
  from private.relationship_safety_idempotency where tenant_id=v_tenant_id and idempotency_key=btrim(p_idempotency_key);
  if found then
    if v_existing_operation <> 'apply_suppression' then raise exception 'Safety idempotency key was used for another operation.' using errcode='23505'; end if;
    return v_existing_response;
  end if;
  if v_org_id is not null and not exists(select 1 from public.relationship_organizations where tenant_id=v_tenant_id and id=v_org_id) then raise exception 'Relationship organization not found.' using errcode='P0002'; end if;
  if v_contact_id is not null and not exists(select 1 from public.relationship_contacts where tenant_id=v_tenant_id and id=v_contact_id) then raise exception 'Relationship contact not found.' using errcode='P0002'; end if;
  if v_campaign_id is not null and not exists(select 1 from public.relationship_campaigns where tenant_id=v_tenant_id and id=v_campaign_id) then raise exception 'Relationship campaign not found.' using errcode='P0002'; end if;
  select id into v_suppression_id
  from public.relationship_suppressions suppression
  where suppression.tenant_id=v_tenant_id and suppression.scope=v_scope and suppression.reason=v_reason
    and suppression.revoked_at is null
    and suppression.organization_id is not distinct from v_org_id
    and suppression.contact_id is not distinct from v_contact_id
    and suppression.campaign_id is not distinct from v_campaign_id
    and lower(suppression.email) is not distinct from v_email
  limit 1;
  if v_suppression_id is null then
    insert into public.relationship_suppressions (
      tenant_id,scope,reason,organization_id,contact_id,campaign_id,email,effective_at,expires_at,
      source,metadata,created_by_profile_id,updated_by_profile_id
    ) values (
      v_tenant_id,v_scope,v_reason,v_org_id,v_contact_id,v_campaign_id,v_email,v_effective_at,v_expires_at,
      v_source,v_metadata,v_actor,v_actor
    ) returning id into v_suppression_id;
  end if;
  for v_enrollment in
    select enrollment.id
    from public.relationship_campaign_enrollments enrollment
    where enrollment.tenant_id=v_tenant_id
      and (v_scope='global'
        or (v_scope='organization' and enrollment.organization_id=v_org_id)
        or (v_scope='contact' and enrollment.contact_id=v_contact_id)
        or (v_scope='email' and lower(enrollment.recipient_email)=v_email)
        or (v_scope='campaign' and enrollment.campaign_id=v_campaign_id))
  loop
    perform private.revalidate_relationship_enrollment(v_tenant_id,v_enrollment.id,v_actor,
      format('Suppression applied: %s / %s.',v_scope,v_reason));
  end loop;
  if v_scope='organization' and not exists(select 1 from public.relationship_campaign_enrollments e where e.tenant_id=v_tenant_id and e.organization_id=v_org_id) then
    insert into public.relationship_interactions(tenant_id,organization_id,interaction_type,occurred_at,summary,metadata,created_by_profile_id,updated_by_profile_id)
    values(v_tenant_id,v_org_id,'suppression',now(),'Communication suppression applied to organization.',jsonb_build_object('suppression_id',v_suppression_id,'reason',v_reason),v_actor,v_actor);
  elsif v_scope='contact' and not exists(select 1 from public.relationship_campaign_enrollments e where e.tenant_id=v_tenant_id and e.contact_id=v_contact_id) then
    insert into public.relationship_interactions(tenant_id,contact_id,interaction_type,occurred_at,summary,metadata,created_by_profile_id,updated_by_profile_id)
    values(v_tenant_id,v_contact_id,'suppression',now(),'Communication suppression applied to contact.',jsonb_build_object('suppression_id',v_suppression_id,'reason',v_reason),v_actor,v_actor);
  end if;
  v_response := private.relationship_suppression_json(v_suppression_id);
  insert into private.relationship_safety_idempotency(tenant_id,idempotency_key,operation,suppression_id,actor_profile_id,response)
  values(v_tenant_id,btrim(p_idempotency_key),'apply_suppression',v_suppression_id,v_actor,v_response);
  return v_response;
end;
$function$;
create or replace function private.revoke_relationship_suppression(p_suppression_id uuid,p_expected_version bigint,p_idempotency_key text,p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_context jsonb := private.relationship_safety_context(true);
  v_actor uuid := (v_context ->> 'actor_id')::uuid;
  v_tenant_id uuid := (v_context ->> 'tenant_id')::uuid;
  v_suppression public.relationship_suppressions%rowtype;
  v_existing_operation text;
  v_existing_suppression_id uuid;
  v_existing_response jsonb;
  v_response jsonb;
  v_enrollment record;
begin
  if nullif(btrim(p_idempotency_key),'') is null then raise exception 'Suppression revocation idempotency key is required.' using errcode='22023'; end if;
  select operation,suppression_id,response into v_existing_operation,v_existing_suppression_id,v_existing_response
  from private.relationship_safety_idempotency where tenant_id=v_tenant_id and idempotency_key=btrim(p_idempotency_key);
  if found then
    if v_existing_operation<>'revoke_suppression' or v_existing_suppression_id<>p_suppression_id then raise exception 'Safety idempotency key was used for another operation.' using errcode='23505'; end if;
    return v_existing_response;
  end if;
  select * into v_suppression from public.relationship_suppressions
  where tenant_id=v_tenant_id and id=p_suppression_id for update;
  if not found then raise exception 'Relationship suppression not found.' using errcode='P0002'; end if;
  if p_expected_version is null or p_expected_version<>v_suppression.version then raise exception 'Suppression changed after it was loaded. Refresh and retry.' using errcode='40001'; end if;
  if v_suppression.revoked_at is null then
    update public.relationship_suppressions
    set revoked_at=now(),revoked_by_profile_id=v_actor,
      metadata=metadata||jsonb_strip_nulls(jsonb_build_object('revocation_reason',nullif(btrim(p_reason),''))),
      updated_by_profile_id=v_actor
    where id=v_suppression.id;
  end if;
  for v_enrollment in
    select enrollment.id from public.relationship_campaign_enrollments enrollment
    where enrollment.tenant_id=v_tenant_id
      and (v_suppression.scope='global'
        or (v_suppression.scope='organization' and enrollment.organization_id=v_suppression.organization_id)
        or (v_suppression.scope='contact' and enrollment.contact_id=v_suppression.contact_id)
        or (v_suppression.scope='email' and lower(enrollment.recipient_email)=lower(v_suppression.email))
        or (v_suppression.scope='campaign' and enrollment.campaign_id=v_suppression.campaign_id))
  loop
    perform private.revalidate_relationship_enrollment(v_tenant_id,v_enrollment.id,v_actor,'Suppression revoked; enrollment remains terminal until explicitly re-enrolled.');
    insert into public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,reason,actor_profile_id,metadata)
    values(v_tenant_id,v_enrollment.id,'suppression_revoked',nullif(btrim(p_reason),''),v_actor,jsonb_build_object('suppression_id',p_suppression_id,'auto_resumed',false));
  end loop;
  if v_suppression.organization_id is not null then
    insert into public.relationship_interactions(tenant_id,organization_id,interaction_type,occurred_at,summary,metadata,created_by_profile_id,updated_by_profile_id)
    values(v_tenant_id,v_suppression.organization_id,'suppression',now(),'Communication suppression revoked; no automatic outreach resumed.',jsonb_build_object('suppression_id',p_suppression_id,'reason',nullif(btrim(p_reason),'')),v_actor,v_actor);
  elsif v_suppression.contact_id is not null then
    insert into public.relationship_interactions(tenant_id,contact_id,interaction_type,occurred_at,summary,metadata,created_by_profile_id,updated_by_profile_id)
    values(v_tenant_id,v_suppression.contact_id,'suppression',now(),'Communication suppression revoked; no automatic outreach resumed.',jsonb_build_object('suppression_id',p_suppression_id,'reason',nullif(btrim(p_reason),'')),v_actor,v_actor);
  end if;
  v_response:=private.relationship_suppression_json(p_suppression_id);
  insert into private.relationship_safety_idempotency(tenant_id,idempotency_key,operation,suppression_id,actor_profile_id,response)
  values(v_tenant_id,btrim(p_idempotency_key),'revoke_suppression',p_suppression_id,v_actor,v_response);
  return v_response;
end;
$function$;
create or replace function private.revalidate_relationship_enrollment_safety(p_enrollment_id uuid,p_expected_version bigint,p_idempotency_key text,p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_context jsonb := private.relationship_safety_context(true);
  v_actor uuid := (v_context ->> 'actor_id')::uuid;
  v_tenant_id uuid := (v_context ->> 'tenant_id')::uuid;
  v_enrollment public.relationship_campaign_enrollments%rowtype;
  v_existing_operation text;
  v_existing_enrollment_id uuid;
  v_existing_response jsonb;
  v_response jsonb;
begin
  if nullif(btrim(p_idempotency_key),'') is null then raise exception 'Safety revalidation idempotency key is required.' using errcode='22023'; end if;
  select operation,enrollment_id,response into v_existing_operation,v_existing_enrollment_id,v_existing_response
  from private.relationship_safety_idempotency where tenant_id=v_tenant_id and idempotency_key=btrim(p_idempotency_key);
  if found then
    if v_existing_operation<>'revalidate_enrollment' or v_existing_enrollment_id<>p_enrollment_id then raise exception 'Safety idempotency key was used for another operation.' using errcode='23505'; end if;
    return v_existing_response;
  end if;
  select * into v_enrollment from public.relationship_campaign_enrollments where tenant_id=v_tenant_id and id=p_enrollment_id for update;
  if not found then raise exception 'Relationship campaign enrollment not found.' using errcode='P0002'; end if;
  if p_expected_version is null or p_expected_version<>v_enrollment.version then raise exception 'Enrollment changed after it was loaded. Refresh and retry.' using errcode='40001'; end if;
  v_response:=private.revalidate_relationship_enrollment(v_tenant_id,p_enrollment_id,v_actor,p_reason);
  insert into private.relationship_safety_idempotency(tenant_id,idempotency_key,operation,enrollment_id,actor_profile_id,response)
  values(v_tenant_id,btrim(p_idempotency_key),'revalidate_enrollment',p_enrollment_id,v_actor,v_response);
  return v_response;
end;
$function$;
