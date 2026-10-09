-- Additive Phase 19/22/23: generic tenant-scoped pipeline transition controls
-- and per-user saved list/board views. The source of truth for connected
-- clinician, client and BTY statuses remains unchanged.
create table public.crm_pipeline_stage_rules (
  tenant_id uuid not null,
  pipeline_id uuid not null,
  from_stage_id uuid not null,
  to_stage_id uuid not null,
  is_allowed boolean not null,
  created_at timestamptz not null default now(),
  primary key (pipeline_id,from_stage_id,to_stage_id),
  foreign key(tenant_id,pipeline_id) references public.crm_pipelines(tenant_id,id) on delete cascade,
  foreign key(tenant_id,pipeline_id,from_stage_id)
    references public.crm_pipeline_stages(tenant_id,pipeline_id,id) on delete cascade,
  foreign key(tenant_id,pipeline_id,to_stage_id)
    references public.crm_pipeline_stages(tenant_id,pipeline_id,id) on delete cascade,
  check(from_stage_id<>to_stage_id)
);
create index crm_pipeline_stage_rules_tenant_idx
  on public.crm_pipeline_stage_rules(tenant_id,pipeline_id,from_stage_id);
alter table public.crm_pipeline_stage_rules enable row level security;
create policy crm_pipeline_stage_rules_read on public.crm_pipeline_stage_rules
  for select to authenticated
  using(private.crm_has_relationship_permission((select auth.uid()),tenant_id,'view_relationships'));
create policy crm_pipeline_stage_rules_manage on public.crm_pipeline_stage_rules
  for all to authenticated using(private.crm_is_pipeline_admin(tenant_id))
  with check(private.crm_is_pipeline_admin(tenant_id));
grant select,insert,update,delete on public.crm_pipeline_stage_rules to authenticated;

create table public.crm_pipeline_saved_views (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  pipeline_id uuid not null,
  owner_profile_id uuid not null references public.profiles(id),
  name text not null check(length(btrim(name)) between 1 and 100),
  view_mode text not null default 'board' check(view_mode in ('board','list')),
  sort_key text not null default 'updated_at' check(sort_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  search_text text not null default '' check(length(search_text)<=200),
  stage_id uuid,
  attention text not null default 'all' check(attention in ('all','overdue','no_next_action')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(tenant_id,pipeline_id) references public.crm_pipelines(tenant_id,id) on delete cascade,
  foreign key(tenant_id,pipeline_id,stage_id)
    references public.crm_pipeline_stages(tenant_id,pipeline_id,id),
  unique(tenant_id,pipeline_id,owner_profile_id,name)
);
create index crm_pipeline_saved_views_user_idx
  on public.crm_pipeline_saved_views(tenant_id,pipeline_id,owner_profile_id,created_at);
alter table public.crm_pipeline_saved_views enable row level security;
create policy crm_pipeline_saved_views_read on public.crm_pipeline_saved_views for select to authenticated
  using(owner_profile_id=(select auth.uid())
    and private.crm_has_relationship_permission((select auth.uid()),tenant_id,'view_relationships'));
create policy crm_pipeline_saved_views_insert on public.crm_pipeline_saved_views for insert to authenticated
  with check(owner_profile_id=(select auth.uid())
    and private.crm_has_relationship_permission((select auth.uid()),tenant_id,'view_relationships'));
create policy crm_pipeline_saved_views_update on public.crm_pipeline_saved_views for update to authenticated
  using(owner_profile_id=(select auth.uid())
    and private.crm_has_relationship_permission((select auth.uid()),tenant_id,'view_relationships'))
  with check(owner_profile_id=(select auth.uid())
    and private.crm_has_relationship_permission((select auth.uid()),tenant_id,'view_relationships'));
create policy crm_pipeline_saved_views_delete on public.crm_pipeline_saved_views for delete to authenticated
  using(owner_profile_id=(select auth.uid())
    and private.crm_has_relationship_permission((select auth.uid()),tenant_id,'view_relationships'));
grant select,insert,update,delete on public.crm_pipeline_saved_views to authenticated;

create function private.crm_validate_saved_pipeline_view()
returns trigger language plpgsql security invoker set search_path=''
as $fn$
begin
  if not exists(
    select 1 from public.crm_pipelines p
      where p.id=new.pipeline_id and p.tenant_id=new.tenant_id and p.archived_at is null
       and (new.sort_key=any(p.sort_field_keys)
        or new.sort_key in ('updated_at','created_at','next_action_due_at'))
  ) then raise exception 'PIPELINE_SAVED_VIEW_SORT_NOT_ALLOWED' using errcode='23514'; end if;
  if tg_op='UPDATE' and
    (new.owner_profile_id is distinct from old.owner_profile_id or
     new.pipeline_id is distinct from old.pipeline_id or
     new.tenant_id is distinct from old.tenant_id)
  then raise exception 'PIPELINE_SAVED_VIEW_IDENTITY_IMMUTABLE' using errcode='23514'; end if;
  new.updated_at:=now();
  return new;
end;
$fn$;
revoke all on function private.crm_validate_saved_pipeline_view()
  from public,anon,authenticated;
create trigger crm_validate_saved_pipeline_view before insert or update
 on public.crm_pipeline_saved_views for each row
 execute function private.crm_validate_saved_pipeline_view();

-- Applies to ALL stage mutations, including direct Data API updates, so
-- a caller cannot bypass terminal-stage/rule restrictions by avoiding the RPC.
create function private.crm_enforce_manual_pipeline_transition()
returns trigger language plpgsql security invoker set search_path=''
as $fn$
declare v_terminal boolean; v_connected boolean; v_allowed boolean;
begin
  if new.stage_id is not distinct from old.stage_id then return new; end if;
  select source_mode='connected' into v_connected from public.crm_pipelines
    where id=old.pipeline_id and tenant_id=old.tenant_id;
  if coalesce(v_connected,false) then
    raise exception 'CONNECTED_PIPELINE_STAGE_READ_ONLY' using errcode='42501'; end if;
  select is_terminal into v_terminal from public.crm_pipeline_stages
    where id=old.stage_id and pipeline_id=old.pipeline_id and tenant_id=old.tenant_id;
  if not exists(select 1 from public.crm_pipeline_stages
     where id=new.stage_id and pipeline_id=old.pipeline_id and tenant_id=old.tenant_id)
  then raise exception 'PIPELINE_STAGE_OUTSIDE_WORKFLOW' using errcode='23514'; end if;
  select is_allowed into v_allowed from public.crm_pipeline_stage_rules
    where pipeline_id=old.pipeline_id and tenant_id=old.tenant_id
      and from_stage_id=old.stage_id and to_stage_id=new.stage_id;
  if v_allowed is false or (v_allowed is null and coalesce(v_terminal,false))
  then raise exception 'PIPELINE_STAGE_TRANSITION_BLOCKED' using errcode='23514'; end if;
  return new;
end;
$fn$;
revoke all on function private.crm_enforce_manual_pipeline_transition()
  from public,anon,authenticated;
create trigger crm_enforce_manual_pipeline_transition
  before update of stage_id on public.crm_pipeline_records for each row
  execute function private.crm_enforce_manual_pipeline_transition();

-- Invoker executes only with existing tenant-specific CRM UPDATE/SELECT RLS,
-- locks one record and verifies optimistic version before allowing transition.
-- Existing stage audit trigger records the mutation exactly once.
create function public.crm_move_manual_pipeline_record(
  p_record_id uuid,p_expected_version bigint,p_to_stage_id uuid
) returns bigint language plpgsql security invoker set search_path=''
as $fn$
declare v_record public.crm_pipeline_records%rowtype;
  v_mode text; v_version bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'CRM_AUTH_REQUIRED' using errcode='42501'; end if;
  select * into v_record from public.crm_pipeline_records
    where id=p_record_id for update;
  if not found or not private.crm_has_relationship_permission(
    (select auth.uid()),v_record.tenant_id,'edit_relationships')
  then raise exception 'PIPELINE_RECORD_NOT_AUTHORIZED' using errcode='42501'; end if;
  select source_mode into v_mode from public.crm_pipelines
    where id=v_record.pipeline_id and tenant_id=v_record.tenant_id and archived_at is null;
  if v_mode is distinct from 'manual' or v_record.source_record_id is not null then
    raise exception 'CONNECTED_PIPELINE_READ_ONLY' using errcode='42501'; end if;
  if v_record.version<>p_expected_version then
    raise exception 'PIPELINE_RECORD_VERSION_CONFLICT' using errcode='40001'; end if;
  if v_record.stage_id=p_to_stage_id then return v_record.version; end if;
  update public.crm_pipeline_records set stage_id=p_to_stage_id
    where id=v_record.id and tenant_id=v_record.tenant_id
    returning version into v_version;
  if v_version is null then
    raise exception 'PIPELINE_RECORD_MOVE_FAILED' using errcode='42501'; end if;
  return v_version;
end;
$fn$;
revoke all on function public.crm_move_manual_pipeline_record(uuid,bigint,uuid)
 from public,anon;
grant execute on function public.crm_move_manual_pipeline_record(uuid,bigint,uuid)
 to authenticated;
