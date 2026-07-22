create or replace function private.issue_relationship_unsubscribe_token(
  p_tenant_id uuid,p_contact_id uuid,p_campaign_id uuid,p_email text,p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid:=gen_random_uuid();
  v_email text:=nullif(lower(btrim(p_email)),'');
  v_expires timestamptz:=coalesce(p_expires_at,now()+interval '30 days');
  v_raw text;
  v_hash text;
begin
  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'A valid unsubscribe email is required.' using errcode='22023'; end if;
  if v_expires<=now() then raise exception 'Unsubscribe token expiration must be in the future.' using errcode='22023'; end if;
  if not exists(select 1 from public.tenants where id=p_tenant_id) then raise exception 'Tenant not found.' using errcode='P0002'; end if;
  if p_contact_id is not null and not exists(select 1 from public.relationship_contacts where tenant_id=p_tenant_id and id=p_contact_id) then raise exception 'Relationship contact not found.' using errcode='P0002'; end if;
  if p_campaign_id is not null and not exists(select 1 from public.relationship_campaigns where tenant_id=p_tenant_id and id=p_campaign_id) then raise exception 'Relationship campaign not found.' using errcode='P0002'; end if;
  v_raw:=v_id::text||'.'||encode(extensions.gen_random_bytes(32),'hex');
  v_hash:=encode(extensions.digest(v_raw,'sha256'),'hex');
  insert into private.relationship_unsubscribe_tokens(id,tenant_id,token_hash,contact_id,campaign_id,email,expires_at)
  values(v_id,p_tenant_id,v_hash,p_contact_id,p_campaign_id,v_email,v_expires);
  return jsonb_build_object('token',v_raw,'expiresAt',v_expires,'email',v_email,'contactId',p_contact_id,'campaignId',p_campaign_id);
end;
$function$;
create or replace function private.process_relationship_unsubscribe(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_hash text;
  v_token private.relationship_unsubscribe_tokens%rowtype;
  v_request_id uuid;
  v_suppression_id uuid;
  v_existing boolean:=false;
  v_outcome text;
  v_enrollment record;
begin
  if nullif(btrim(p_token),'') is null or length(btrim(p_token))>512 then
    insert into public.relationship_unsubscribe_requests(tenant_id,outcome,processed_at,metadata)
    values(null,'invalid_token',now(),jsonb_build_object('reason','invalid_format')) returning id into v_request_id;
    return private.relationship_unsubscribe_request_json(v_request_id);
  end if;
  v_hash:=encode(extensions.digest(btrim(p_token),'sha256'),'hex');
  select * into v_token from private.relationship_unsubscribe_tokens where token_hash=v_hash for update;
  if not found or v_token.expires_at<=now() then
    insert into public.relationship_unsubscribe_requests(tenant_id,token_id,email,outcome,processed_at,metadata)
    values(case when found then v_token.tenant_id else null end,case when found then v_token.id else null end,
      case when found then v_token.email else null end,'invalid_token',now(),jsonb_build_object('reason',case when found then 'expired' else 'not_found' end))
    returning id into v_request_id;
    return private.relationship_unsubscribe_request_json(v_request_id);
  end if;
  select id into v_suppression_id from public.relationship_suppressions suppression
  where suppression.tenant_id=v_token.tenant_id and suppression.scope='email' and suppression.reason='unsubscribe'
    and lower(suppression.email)=lower(v_token.email) and suppression.revoked_at is null
    and suppression.effective_at<=now() and (suppression.expires_at is null or suppression.expires_at>now())
  limit 1;
  v_existing:=v_suppression_id is not null or v_token.used_at is not null;
  if v_suppression_id is null then
    insert into public.relationship_suppressions(tenant_id,scope,reason,email,effective_at,source,metadata)
    values(v_token.tenant_id,'email','unsubscribe',v_token.email,now(),'unsubscribe',jsonb_build_object('token_id',v_token.id))
    returning id into v_suppression_id;
  end if;
  update private.relationship_unsubscribe_tokens set used_at=coalesce(used_at,now()) where id=v_token.id;
  for v_enrollment in
    select id from public.relationship_campaign_enrollments
    where tenant_id=v_token.tenant_id and lower(recipient_email)=lower(v_token.email)
  loop
    perform private.revalidate_relationship_enrollment(v_token.tenant_id,v_enrollment.id,null,'Recipient unsubscribed from relationship outreach.');
    insert into public.relationship_enrollment_events(tenant_id,enrollment_id,event_type,reason,metadata)
    values(v_token.tenant_id,v_enrollment.id,'unsubscribe_processed','Recipient unsubscribe processed.',jsonb_build_object('suppression_id',v_suppression_id,'token_id',v_token.id));
  end loop;
  insert into public.relationship_unsubscribe_requests(tenant_id,token_id,email,processed_at,suppression_id,outcome,metadata)
  values(v_token.tenant_id,v_token.id,v_token.email,now(),v_suppression_id,case when v_existing then 'already_unsubscribed' else 'unsubscribed' end,
    jsonb_build_object('campaign_id',v_token.campaign_id,'contact_id',v_token.contact_id)) returning id,outcome into v_request_id,v_outcome;
  if v_token.contact_id is not null then
    insert into public.relationship_interactions(tenant_id,contact_id,interaction_type,occurred_at,summary,metadata)
    values(v_token.tenant_id,v_token.contact_id,'unsubscribe',now(),'Recipient unsubscribed from relationship outreach.',jsonb_build_object('request_id',v_request_id,'suppression_id',v_suppression_id,'campaign_id',v_token.campaign_id));
  end if;
  return private.relationship_unsubscribe_request_json(v_request_id);
end;
$function$;
create or replace function public.evaluate_relationship_enrollment_safety(p_enrollment_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_context jsonb:=private.relationship_safety_context(false);
  v_tenant_id uuid:=(v_context->>'tenant_id')::uuid;
  v_enrollment_tenant uuid;
begin
  select tenant_id into v_enrollment_tenant from public.relationship_campaign_enrollments where id=p_enrollment_id;
  if v_enrollment_tenant is distinct from v_tenant_id then raise exception 'Relationship campaign enrollment not found.' using errcode='P0002'; end if;
  return private.evaluate_relationship_enrollment_safety(p_enrollment_id);
end;
$function$;
create or replace function public.apply_relationship_suppression(p_payload jsonb,p_idempotency_key text)
returns jsonb language sql set search_path to '' as $function$
  select private.apply_relationship_suppression(p_payload,p_idempotency_key);
$function$;
create or replace function public.revoke_relationship_suppression(p_suppression_id uuid,p_expected_version bigint,p_idempotency_key text,p_reason text default null)
returns jsonb language sql set search_path to '' as $function$
  select private.revoke_relationship_suppression(p_suppression_id,p_expected_version,p_idempotency_key,p_reason);
$function$;
create or replace function public.revalidate_relationship_enrollment_safety(p_enrollment_id uuid,p_expected_version bigint,p_idempotency_key text,p_reason text default null)
returns jsonb language sql set search_path to '' as $function$
  select private.revalidate_relationship_enrollment_safety(p_enrollment_id,p_expected_version,p_idempotency_key,p_reason);
$function$;
create or replace function public.process_relationship_unsubscribe(p_token text)
returns jsonb language sql security definer set search_path to '' as $function$
  select private.process_relationship_unsubscribe(p_token);
$function$;
revoke all on function private.relationship_safety_context(boolean) from public,anon,authenticated;
revoke all on function private.relationship_suppression_json(uuid) from public,anon,authenticated;
revoke all on function private.relationship_unsubscribe_request_json(uuid) from public,anon,authenticated;
revoke all on function private.evaluate_relationship_safety_values(uuid,uuid,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function private.evaluate_relationship_enrollment_safety(uuid) from public,anon,authenticated;
revoke all on function private.set_relationship_enrollment_safety_on_insert() from public,anon,authenticated;
revoke all on function private.revalidate_relationship_enrollment(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function private.apply_relationship_suppression(jsonb,text) from public,anon,authenticated;
revoke all on function private.revoke_relationship_suppression(uuid,bigint,text,text) from public,anon,authenticated;
revoke all on function private.revalidate_relationship_enrollment_safety(uuid,bigint,text,text) from public,anon,authenticated;
revoke all on function private.issue_relationship_unsubscribe_token(uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function private.process_relationship_unsubscribe(text) from public,anon,authenticated;
grant execute on function private.apply_relationship_suppression(jsonb,text) to authenticated,service_role;
grant execute on function private.revoke_relationship_suppression(uuid,bigint,text,text) to authenticated,service_role;
grant execute on function private.revalidate_relationship_enrollment_safety(uuid,bigint,text,text) to authenticated,service_role;
grant execute on function private.issue_relationship_unsubscribe_token(uuid,uuid,uuid,text,timestamptz) to service_role;
grant execute on function private.process_relationship_unsubscribe(text) to anon,authenticated,service_role;
revoke all on function public.evaluate_relationship_enrollment_safety(uuid) from public,anon,authenticated;
revoke all on function public.apply_relationship_suppression(jsonb,text) from public,anon,authenticated;
revoke all on function public.revoke_relationship_suppression(uuid,bigint,text,text) from public,anon,authenticated;
revoke all on function public.revalidate_relationship_enrollment_safety(uuid,bigint,text,text) from public,anon,authenticated;
revoke all on function public.process_relationship_unsubscribe(text) from public,anon,authenticated;
grant execute on function public.evaluate_relationship_enrollment_safety(uuid) to authenticated,service_role;
grant execute on function public.apply_relationship_suppression(jsonb,text) to authenticated,service_role;
grant execute on function public.revoke_relationship_suppression(uuid,bigint,text,text) to authenticated,service_role;
grant execute on function public.revalidate_relationship_enrollment_safety(uuid,bigint,text,text) to authenticated,service_role;
grant execute on function public.process_relationship_unsubscribe(text) to anon,authenticated,service_role;
