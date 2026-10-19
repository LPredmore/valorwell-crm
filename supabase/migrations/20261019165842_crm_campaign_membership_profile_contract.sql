-- Separate follow-on to the reviewed nine-migration October rollout.
-- The authoritative tenant_memberships relation identifies a member by profile_id.
-- Preserve the reviewed lifecycle function's authorization, idempotency and grants.
begin;
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
commit;
