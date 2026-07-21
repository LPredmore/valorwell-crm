create table public.relationship_opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  organization_id uuid not null,
  primary_contact_id uuid,
  status text not null default 'identified',
  owner_profile_id uuid references public.profiles(id) on delete set null,
  cause_area text,
  veteran_priority boolean not null default false,
  qualification jsonb not null default '{}'::jsonb,
  review_status text not null default 'unreviewed',
  risk_flags text[] not null default '{}'::text[],
  next_action text,
  next_action_due_at timestamptz,
  status_changed_at timestamptz not null default now(),
  closed_at timestamptz,
  version bigint not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_opportunities_tenant_id_id_key unique (tenant_id, id),
  constraint relationship_opportunities_tenant_organization_fkey
    foreign key (tenant_id, organization_id)
    references public.relationship_organizations(tenant_id, id) on delete cascade,
  constraint relationship_opportunities_tenant_contact_fkey
    foreign key (tenant_id, primary_contact_id)
    references public.relationship_contacts(tenant_id, id) on delete set null,
  constraint relationship_opportunities_status_check check (
    status = any (array[
      'identified','researching','qualified','ready_for_campaign','contacted',
      'responded','interested','recording_planned','booked','declined',
      'nurture','disqualified','completed'
    ]::text[])
  ),
  constraint relationship_opportunities_review_status_check check (
    review_status = any (array['unreviewed','needs_review','approved','rejected']::text[])
  ),
  constraint relationship_opportunities_cause_area_check check (
    cause_area is null or length(btrim(cause_area)) > 0
  ),
  constraint relationship_opportunities_qualification_check check (
    jsonb_typeof(qualification) = 'object'
  ),
  constraint relationship_opportunities_next_action_check check (
    next_action is null or length(btrim(next_action)) > 0
  ),
  constraint relationship_opportunities_version_check check (version > 0),
  constraint relationship_opportunities_closed_check check (
    (status = any (array['declined','disqualified','completed']::text[]) and closed_at is not null)
    or
    (not (status = any (array['declined','disqualified','completed']::text[])) and closed_at is null)
  )
);

create table public.relationship_opportunity_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  opportunity_id uuid not null,
  from_status text,
  to_status text not null,
  changed_at timestamptz not null default now(),
  reason text,
  version bigint not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_opportunity_status_history_tenant_opportunity_fkey
    foreign key (tenant_id, opportunity_id)
    references public.relationship_opportunities(tenant_id, id) on delete cascade,
  constraint relationship_opportunity_status_history_from_check check (
    from_status is null or from_status = any (array[
      'identified','researching','qualified','ready_for_campaign','contacted',
      'responded','interested','recording_planned','booked','declined',
      'nurture','disqualified','completed'
    ]::text[])
  ),
  constraint relationship_opportunity_status_history_to_check check (
    to_status = any (array[
      'identified','researching','qualified','ready_for_campaign','contacted',
      'responded','interested','recording_planned','booked','declined',
      'nurture','disqualified','completed'
    ]::text[])
  ),
  constraint relationship_opportunity_status_history_reason_check check (
    reason is null or length(btrim(reason)) > 0
  ),
  constraint relationship_opportunity_status_history_version_check check (version > 0),
  constraint relationship_opportunity_status_history_version_key unique (tenant_id, opportunity_id, version)
);

create index relationship_opportunities_pipeline_idx
  on public.relationship_opportunities (tenant_id, status, owner_profile_id, next_action_due_at);
create index relationship_opportunities_organization_idx
  on public.relationship_opportunities (tenant_id, organization_id, status, updated_at desc);
create index relationship_opportunities_contact_idx
  on public.relationship_opportunities (tenant_id, primary_contact_id, status, updated_at desc)
  where primary_contact_id is not null;
create index relationship_opportunities_cause_idx
  on public.relationship_opportunities (tenant_id, cause_area, status)
  where cause_area is not null;
create index relationship_opportunities_review_idx
  on public.relationship_opportunities (tenant_id, review_status, veteran_priority, updated_at desc);
create index relationship_opportunities_risk_flags_idx
  on public.relationship_opportunities using gin (risk_flags);
create index relationship_opportunities_qualification_idx
  on public.relationship_opportunities using gin (qualification);
create index relationship_opportunity_history_changed_idx
  on public.relationship_opportunity_status_history (tenant_id, opportunity_id, changed_at desc);
create index relationship_opportunity_history_status_idx
  on public.relationship_opportunity_status_history (tenant_id, to_status, changed_at desc);

create or replace function public.set_relationship_opportunity_audit_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if new.owner_profile_id is not null and not exists (
    select 1
    from public.crm_user_capabilities capability
    where capability.profile_id = new.owner_profile_id
      and capability.tenant_id = new.tenant_id
      and capability.crm_role <> 'crm_none'::public.crm_capability_role
  ) then
    raise exception 'Opportunity owner must have CRM access to the same tenant.' using errcode = '23514';
  end if;

  new.cause_area := nullif(btrim(new.cause_area), '');
  new.next_action := nullif(btrim(new.next_action), '');
  new.risk_flags := array(
    select distinct btrim(flag)
    from unnest(coalesce(new.risk_flags, '{}'::text[])) as flag
    where nullif(btrim(flag), '') is not null
    order by btrim(flag)
  );

  if tg_op = 'INSERT' then
    new.created_by_profile_id := coalesce(v_actor, new.created_by_profile_id);
    new.updated_by_profile_id := coalesce(v_actor, new.updated_by_profile_id, new.created_by_profile_id);
    new.version := 1;
    new.status_changed_at := coalesce(new.status_changed_at, now());
    new.closed_at := case
      when new.status = any (array['declined','disqualified','completed']::text[])
        then coalesce(new.closed_at, new.status_changed_at, now())
      else null
    end;
  else
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'Opportunity tenant cannot be changed.' using errcode = '22023';
    end if;
    if new.organization_id is distinct from old.organization_id then
      raise exception 'Opportunity organization cannot be changed.' using errcode = '22023';
    end if;
    new.created_by_profile_id := old.created_by_profile_id;
    new.updated_by_profile_id := coalesce(v_actor, new.updated_by_profile_id, old.updated_by_profile_id);
    new.updated_at := now();
    if new.status is distinct from old.status then
      new.version := old.version + 1;
      new.status_changed_at := now();
      new.closed_at := case
        when new.status = any (array['declined','disqualified','completed']::text[]) then now()
        else null
      end;
    else
      new.version := old.version;
      new.status_changed_at := old.status_changed_at;
      new.closed_at := old.closed_at;
    end if;
  end if;
  return new;
end;
$$;

create trigger set_relationship_opportunities_audit_fields
before insert or update on public.relationship_opportunities
for each row execute function public.set_relationship_opportunity_audit_fields();

create schema if not exists private;

create or replace function private.record_relationship_opportunity_initial_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.relationship_opportunity_status_history (
    tenant_id, opportunity_id, from_status, to_status, changed_at,
    reason, version, metadata, created_by_profile_id, updated_by_profile_id
  ) values (
    new.tenant_id, new.id, null, new.status, new.status_changed_at,
    'Opportunity created.', new.version, jsonb_build_object('initial', true),
    new.created_by_profile_id, new.updated_by_profile_id
  );
  return new;
end;
$$;

create trigger record_relationship_opportunity_initial_status
after insert on public.relationship_opportunities
for each row execute function private.record_relationship_opportunity_initial_status();

create or replace function private.relationship_opportunity_status_transition_allowed(
  p_from_status text,
  p_to_status text
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select case p_from_status
    when 'identified' then p_to_status = any (array['researching','qualified','nurture','disqualified']::text[])
    when 'researching' then p_to_status = any (array['qualified','nurture','disqualified']::text[])
    when 'qualified' then p_to_status = any (array['ready_for_campaign','contacted','nurture','disqualified']::text[])
    when 'ready_for_campaign' then p_to_status = any (array['contacted','nurture','disqualified']::text[])
    when 'contacted' then p_to_status = any (array['responded','nurture','declined','disqualified']::text[])
    when 'responded' then p_to_status = any (array['interested','nurture','declined']::text[])
    when 'interested' then p_to_status = any (array['recording_planned','booked','nurture','declined']::text[])
    when 'recording_planned' then p_to_status = any (array['booked','nurture','declined']::text[])
    when 'booked' then p_to_status = any (array['completed','nurture','declined']::text[])
    when 'nurture' then p_to_status = any (array['researching','qualified','contacted','responded','interested','disqualified']::text[])
    when 'declined' then p_to_status = any (array['nurture','researching']::text[])
    when 'disqualified' then p_to_status = 'identified'
    when 'completed' then p_to_status = 'nurture'
    else false
  end;
$$;

create or replace function private.transition_relationship_opportunity_status(
  p_opportunity_id uuid,
  p_status text,
  p_reason text default null,
  p_expected_version bigint default null,
  p_changed_at timestamptz default now()
)
returns public.relationship_opportunities
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_opportunity public.relationship_opportunities%rowtype;
  v_from_status text;
  v_changed_at timestamptz := coalesce(p_changed_at, now());
begin
  if v_actor is null then
    raise exception 'Authenticated CRM access is required.' using errcode = '42501';
  end if;
  if p_status is null or not (p_status = any (array[
    'identified','researching','qualified','ready_for_campaign','contacted',
    'responded','interested','recording_planned','booked','declined',
    'nurture','disqualified','completed'
  ]::text[])) then
    raise exception 'Invalid opportunity status.' using errcode = '22023';
  end if;

  select * into v_opportunity
  from public.relationship_opportunities
  where id = p_opportunity_id
  for update;

  if not found then
    raise exception 'Relationship opportunity not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.crm_user_capabilities capability
    where capability.profile_id = v_actor
      and capability.tenant_id = v_opportunity.tenant_id
      and capability.crm_role = any (array['crm_admin','crm_operator']::public.crm_capability_role[])
  ) then
    raise exception 'You do not have permission to transition this opportunity.' using errcode = '42501';
  end if;

  if p_expected_version is not null and p_expected_version <> v_opportunity.version then
    raise exception 'Opportunity changed after it was loaded. Refresh and retry.' using errcode = '40001';
  end if;

  if v_opportunity.status = p_status then
    return v_opportunity;
  end if;

  if not private.relationship_opportunity_status_transition_allowed(v_opportunity.status, p_status) then
    raise exception 'Opportunity status transition from % to % is not allowed.', v_opportunity.status, p_status
      using errcode = '22023';
  end if;

  v_from_status := v_opportunity.status;

  update public.relationship_opportunities
  set status = p_status,
      updated_by_profile_id = v_actor
  where id = v_opportunity.id
  returning * into v_opportunity;

  update public.relationship_opportunities
  set status_changed_at = v_changed_at,
      closed_at = case
        when status = any (array['declined','disqualified','completed']::text[]) then v_changed_at
        else null
      end
  where id = v_opportunity.id
  returning * into v_opportunity;

  insert into public.relationship_opportunity_status_history (
    tenant_id, opportunity_id, from_status, to_status, changed_at,
    reason, version, metadata, created_by_profile_id, updated_by_profile_id
  ) values (
    v_opportunity.tenant_id, v_opportunity.id, v_from_status, v_opportunity.status,
    v_changed_at, nullif(btrim(p_reason), ''), v_opportunity.version,
    jsonb_build_object('organization_id', v_opportunity.organization_id, 'primary_contact_id', v_opportunity.primary_contact_id),
    v_actor, v_actor
  );

  insert into public.relationship_interactions (
    tenant_id, organization_id, contact_id, opportunity_id, interaction_type,
    occurred_at, summary, metadata, created_by_profile_id, updated_by_profile_id
  ) values (
    v_opportunity.tenant_id, v_opportunity.organization_id, v_opportunity.primary_contact_id,
    v_opportunity.id, 'opportunity_status_change', v_changed_at,
    format('Opportunity status changed from %s to %s.', v_from_status, v_opportunity.status),
    jsonb_build_object('from_status', v_from_status, 'to_status', v_opportunity.status, 'reason', nullif(btrim(p_reason), ''), 'version', v_opportunity.version),
    v_actor, v_actor
  );

  return v_opportunity;
end;
$$;

create or replace function public.transition_relationship_opportunity_status(
  p_opportunity_id uuid,
  p_status text,
  p_reason text default null,
  p_expected_version bigint default null,
  p_changed_at timestamptz default now()
)
returns public.relationship_opportunities
language sql
security invoker
set search_path = ''
as $$
  select private.transition_relationship_opportunity_status(
    p_opportunity_id, p_status, p_reason, p_expected_version, p_changed_at
  );
$$;

alter table public.relationship_opportunities enable row level security;
alter table public.relationship_opportunity_status_history enable row level security;

create policy relationship_opportunities_crm_select
on public.relationship_opportunities
for select
to authenticated
using (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = relationship_opportunities.tenant_id
      and capability.crm_role <> 'crm_none'::public.crm_capability_role
  )
);

create policy relationship_opportunities_crm_insert
on public.relationship_opportunities
for insert
to authenticated
with check (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = relationship_opportunities.tenant_id
      and capability.crm_role = any (array['crm_admin','crm_operator']::public.crm_capability_role[])
  )
  and created_by_profile_id = auth.uid()
  and updated_by_profile_id = auth.uid()
);

create policy relationship_opportunities_crm_update
on public.relationship_opportunities
for update
to authenticated
using (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = relationship_opportunities.tenant_id
      and capability.crm_role = any (array['crm_admin','crm_operator']::public.crm_capability_role[])
  )
)
with check (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = relationship_opportunities.tenant_id
      and capability.crm_role = any (array['crm_admin','crm_operator']::public.crm_capability_role[])
  )
  and updated_by_profile_id = auth.uid()
);

create policy relationship_opportunity_history_crm_select
on public.relationship_opportunity_status_history
for select
to authenticated
using (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = relationship_opportunity_status_history.tenant_id
      and capability.crm_role <> 'crm_none'::public.crm_capability_role
  )
);

alter table public.relationship_interactions
  add constraint relationship_interactions_tenant_opportunity_fkey
  foreign key (tenant_id, opportunity_id)
  references public.relationship_opportunities(tenant_id, id);

create index relationship_interactions_opportunity_occurred_idx
  on public.relationship_interactions (tenant_id, opportunity_id, occurred_at desc)
  where opportunity_id is not null;

drop policy if exists relationship_interactions_tenant_select on public.relationship_interactions;
create policy relationship_interactions_tenant_select
on public.relationship_interactions
for select
to authenticated
using (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = relationship_interactions.tenant_id
      and capability.crm_role <> 'crm_none'::public.crm_capability_role
  )
);

drop policy if exists relationship_interactions_tenant_insert on public.relationship_interactions;
create policy relationship_interactions_tenant_insert
on public.relationship_interactions
for insert
to authenticated
with check (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = relationship_interactions.tenant_id
      and capability.crm_role = any (array['crm_admin','crm_operator']::public.crm_capability_role[])
  )
  and created_by_profile_id = auth.uid()
  and updated_by_profile_id = auth.uid()
  and (organization_id is not null or contact_id is not null or opportunity_id is not null)
);

revoke all on table public.relationship_opportunities from public, anon;
grant select, insert on table public.relationship_opportunities to authenticated;
grant update (
  primary_contact_id, owner_profile_id, cause_area, veteran_priority,
  qualification, review_status, risk_flags, next_action, next_action_due_at,
  metadata, updated_by_profile_id
) on table public.relationship_opportunities to authenticated;
grant all on table public.relationship_opportunities to service_role;

revoke all on table public.relationship_opportunity_status_history from public, anon, authenticated;
grant select on table public.relationship_opportunity_status_history to authenticated;
grant all on table public.relationship_opportunity_status_history to service_role;

revoke all on function public.set_relationship_opportunity_audit_fields() from public, anon, authenticated;
revoke all on function private.record_relationship_opportunity_initial_status() from public, anon, authenticated;
revoke all on function private.relationship_opportunity_status_transition_allowed(text, text) from public, anon, authenticated;
revoke all on function private.transition_relationship_opportunity_status(uuid, text, text, bigint, timestamptz) from public, anon;
grant usage on schema private to authenticated, service_role;
grant execute on function private.transition_relationship_opportunity_status(uuid, text, text, bigint, timestamptz) to authenticated, service_role;
revoke all on function public.transition_relationship_opportunity_status(uuid, text, text, bigint, timestamptz) from public, anon;
grant execute on function public.transition_relationship_opportunity_status(uuid, text, text, bigint, timestamptz) to authenticated, service_role;

comment on table public.relationship_opportunities is 'Non-clinical Business Development opportunities linked to relationship organizations and contacts.';
comment on table public.relationship_opportunity_status_history is 'Append-only, versioned status history for non-clinical relationship opportunities.';
comment on function public.transition_relationship_opportunity_status(uuid, text, text, bigint, timestamptz) is 'Authorized, version-checked opportunity status transition endpoint.';
