create or replace function public.list_relationship_feature_flags()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare
  v_context jsonb:=private.relationship_orchestration_context(false);
  v_tenant uuid:=(v_context->>'tenant_id')::uuid;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'flagName',f.flag_name,
      'enabled',f.enabled,
      'updatedAt',f.updated_at
    ) order by f.flag_name)
    from private.relationship_feature_flags f
    where f.tenant_id=v_tenant
  ),'[]'::jsonb);
end;
$function$;

create or replace function public.set_relationship_feature_flag(
  p_flag_name text,p_enabled boolean,p_reason text
)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_context jsonb:=private.relationship_orchestration_context(true);
  v_tenant uuid:=(v_context->>'tenant_id')::uuid;
  v_actor uuid:=(v_context->>'actor_id')::uuid;
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_integrity jsonb;
  v_nonzero int;
  v_previous boolean;
begin
  if p_flag_name<>all(array[
    'relationship_activity_capture_enabled','relationship_activity_mutation_enabled',
    'relationship_bty_auto_enrollment_enabled','relationship_gmail_observation_enabled',
    'relationship_calendar_observation_enabled','relationship_reconciliation_writes_enabled'
  ]::text[]) then
    raise exception 'Relationship feature flag is not recognized.' using errcode='22023';
  end if;
  if p_enabled is null then
    raise exception 'Relationship feature flag state is required.' using errcode='22023';
  end if;
  if v_reason is null then
    raise exception 'A reason is required to change a relationship feature flag.' using errcode='22023';
  end if;

  select enabled into v_previous from private.relationship_feature_flags
  where tenant_id=v_tenant and flag_name=p_flag_name;
  if not found then
    raise exception 'Relationship feature flag is not installed for this tenant.' using errcode='P0002';
  end if;

  if p_enabled then
    if p_flag_name='relationship_activity_mutation_enabled' then
      v_integrity:=public.list_relationship_orchestration_integrity();
      select count(*) into v_nonzero
      from jsonb_each_text(v_integrity->'invariants') e
      where coalesce(e.value,'0')<>'0';
      if v_nonzero>0 then
        raise exception 'Automatic lifecycle mutation cannot be enabled while integrity invariants are non-zero.'
          using errcode='23514';
      end if;
    elsif p_flag_name=any(array[
      'relationship_bty_auto_enrollment_enabled','relationship_reconciliation_writes_enabled'
    ]::text[]) then
      if not private.relationship_flag_enabled(v_tenant,'relationship_activity_mutation_enabled') then
        raise exception 'Automatic lifecycle mutation must be enabled first.' using errcode='23514';
      end if;
    end if;
  end if;

  update private.relationship_feature_flags
  set enabled=p_enabled,updated_by_profile_id=v_actor,updated_at=now()
  where tenant_id=v_tenant and flag_name=p_flag_name;

  insert into public.relationship_activity_events(
    tenant_id,activity_type,source,idempotency_key,occurred_at,processing_status,metadata,created_by_profile_id
  )
  values (
    v_tenant,'legacy_reconciliation','operator',
    'crm:feature-flag:'||p_flag_name||':'||to_char(now(),'YYYYMMDDHH24MISSUS'),
    now(),'applied',
    jsonb_build_object(
      'operation','feature_flag_change',
      'flagName',p_flag_name,
      'previousEnabled',v_previous,
      'enabled',p_enabled,
      'reason',v_reason
    ),
    v_actor
  );

  return jsonb_build_object('flagName',p_flag_name,'enabled',p_enabled,'previousEnabled',v_previous);
end;
$function$;

revoke all on function public.list_relationship_feature_flags(),
  public.set_relationship_feature_flag(text,boolean,text) from public,anon;
grant execute on function public.list_relationship_feature_flags(),
  public.set_relationship_feature_flag(text,boolean,text) to authenticated,service_role;