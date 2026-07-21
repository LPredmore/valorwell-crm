create or replace function public.relationship_stage_transition_allowed(p_from_stage text, p_to_stage text)
returns boolean
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select case p_from_stage
    when 'identified' then p_to_stage = any (array['qualified_outreach','nurture','closed_no_fit','inactive'])
    when 'qualified_outreach' then p_to_stage = any (array['contacted','nurture','closed_no_fit'])
    when 'contacted' then p_to_stage = any (array['engaged','discovery','nurture','closed_no_fit'])
    when 'engaged' then p_to_stage = any (array['discovery','next_step_agreed','nurture','inactive'])
    when 'discovery' then p_to_stage = any (array['next_step_agreed','active','nurture','closed_no_fit'])
    when 'next_step_agreed' then p_to_stage = any (array['active','nurture','closed_no_fit'])
    when 'active' then p_to_stage = any (array['nurture','inactive'])
    when 'nurture' then p_to_stage = any (array['qualified_outreach','contacted','closed_no_fit','inactive'])
    when 'closed_no_fit' then p_to_stage = 'identified'
    when 'inactive' then p_to_stage = any (array['identified','nurture'])
    else false
  end;
$$;

create or replace function public.transition_relationship_stage(
  p_to_stage text,
  p_organization_id uuid default null,
  p_contact_id uuid default null,
  p_reason text default null,
  p_changed_at timestamptz default now()
)
returns public.relationship_stage_history
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_from_stage text;
  v_history public.relationship_stage_history%rowtype;
begin
  if v_actor is null then
    raise exception 'Authenticated CRM access is required.' using errcode = '42501';
  end if;

  if num_nonnulls(p_organization_id, p_contact_id) <> 1 then
    raise exception 'Exactly one organization or contact is required.' using errcode = '22023';
  end if;

  if p_to_stage is null or not (p_to_stage = any (array['identified','qualified_outreach','contacted','engaged','discovery','next_step_agreed','active','nurture','closed_no_fit','inactive']::text[])) then
    raise exception 'Invalid relationship stage.' using errcode = '22023';
  end if;

  if p_organization_id is not null then
    select tenant_id, relationship_stage into v_tenant_id, v_from_stage
    from public.relationship_organizations where id = p_organization_id for update;
  else
    select tenant_id, relationship_stage into v_tenant_id, v_from_stage
    from public.relationship_contacts where id = p_contact_id for update;
  end if;

  if v_tenant_id is null then
    raise exception 'Relationship subject not found.' using errcode = 'P0002';
  end if;

  if not public.crm_has_role(v_actor, array['admin','staff'], v_tenant_id) then
    raise exception 'You do not have permission to transition this relationship.' using errcode = '42501';
  end if;

  if v_from_stage = p_to_stage then
    select * into v_history from public.relationship_stage_history h
    where h.tenant_id = v_tenant_id
      and h.organization_id is not distinct from p_organization_id
      and h.contact_id is not distinct from p_contact_id
      and h.to_stage = p_to_stage
    order by h.changed_at desc, h.created_at desc limit 1;
    if found then return v_history; end if;
    raise exception 'Relationship is already in the requested stage.' using errcode = '22023';
  end if;

  if not public.relationship_stage_transition_allowed(v_from_stage, p_to_stage) then
    raise exception 'Relationship stage transition from % to % is not allowed.', v_from_stage, p_to_stage using errcode = '22023';
  end if;

  if p_organization_id is not null then
    update public.relationship_organizations set relationship_stage = p_to_stage
    where id = p_organization_id and tenant_id = v_tenant_id;
  else
    update public.relationship_contacts set relationship_stage = p_to_stage
    where id = p_contact_id and tenant_id = v_tenant_id;
  end if;

  insert into public.relationship_stage_history (
    tenant_id, organization_id, contact_id, from_stage, to_stage, changed_at,
    reason, created_by_profile_id, updated_by_profile_id
  ) values (
    v_tenant_id, p_organization_id, p_contact_id, v_from_stage, p_to_stage,
    coalesce(p_changed_at, now()), nullif(btrim(p_reason), ''), v_actor, v_actor
  ) returning * into v_history;

  insert into public.relationship_interactions (
    tenant_id, organization_id, contact_id, interaction_type, occurred_at,
    summary, metadata, created_by_profile_id, updated_by_profile_id
  ) values (
    v_tenant_id, p_organization_id, p_contact_id, 'stage_transition',
    coalesce(p_changed_at, now()),
    format('Relationship stage changed from %s to %s.', v_from_stage, p_to_stage),
    jsonb_build_object('from_stage', v_from_stage, 'to_stage', p_to_stage, 'reason', nullif(btrim(p_reason), '')),
    v_actor, v_actor
  );

  return v_history;
end;
$$;

revoke all on function public.relationship_stage_transition_allowed(text, text) from public, anon, authenticated;
grant execute on function public.relationship_stage_transition_allowed(text, text) to service_role;
revoke all on function public.transition_relationship_stage(text, uuid, uuid, text, timestamptz) from public, anon;
grant execute on function public.transition_relationship_stage(text, uuid, uuid, text, timestamptz) to authenticated, service_role;

comment on column public.relationship_organizations.relationship_stage is 'Canonical business-development lifecycle stage. Independent from outreach_status.';
comment on column public.relationship_contacts.relationship_stage is 'Canonical business-development lifecycle stage. Independent from outreach_status.';
comment on table public.relationship_stage_history is 'Append-only lifecycle transition ledger for non-clinical relationship organizations and contacts.';
comment on table public.relationship_interactions is 'Tenant-scoped non-clinical relationship activity timeline. Clinical CRM activity remains in crm_activity_events.';
