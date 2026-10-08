-- Phases 15–17: attach non-clinical relationship subjects to the EXISTING
-- canonical crm_tasks table. Source tasks are not copied or backfilled.
-- The earlier proposed identity-review migration is NOT a prerequisite.
alter table public.crm_tasks
  add column if not exists relationship_contact_id uuid references public.relationship_contacts(id) on delete restrict,
  add column if not exists relationship_organization_id uuid references public.relationship_organizations(id) on delete restrict;

create index if not exists crm_tasks_relationship_contact_idx
  on public.crm_tasks (tenant_id, relationship_contact_id, due_at)
  where relationship_contact_id is not null;
create index if not exists crm_tasks_relationship_organization_idx
  on public.crm_tasks (tenant_id, relationship_organization_id, due_at)
  where relationship_organization_id is not null;

-- Clinical and non-clinical source subjects cannot coexist on the same task.
alter table public.crm_tasks
  add constraint crm_tasks_clinical_relationship_exclusion
  check ((relationship_contact_id is null and relationship_organization_id is null)
    or (client_id is null and staff_id is null and campaign_id is null and exception_id is null));

create or replace function private.crm_validate_relationship_task_subject()
returns trigger language plpgsql security definer set search_path = ''
as $func$
begin
  if new.relationship_contact_id is null and new.relationship_organization_id is null then
    if tg_op = 'UPDATE' and
      (old.relationship_contact_id is not null or old.relationship_organization_id is not null) then
      raise exception 'Relationship subject links cannot be removed with a task update' using errcode = '23514';
    end if;
    return new;
  end if;
  if (select auth.uid()) is null
    or not private.crm_has_relationship_permission((select auth.uid()), new.tenant_id, 'edit_relationships')
  then
    raise exception 'Relationship task mutation is not authorized' using errcode = '42501';
  end if;
  if new.client_id is not null or new.staff_id is not null
    or new.campaign_id is not null or new.exception_id is not null then
    raise exception 'Relationship tasks cannot contain clinical or campaign source links' using errcode = '23514';
  end if;
  if new.relationship_contact_id is not null and not exists (
    select 1 from public.relationship_contacts c
    where c.id = new.relationship_contact_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'Contact subject does not belong to this tenant' using errcode = '23514';
  end if;
  if new.relationship_organization_id is not null and not exists (
    select 1 from public.relationship_organizations o
    where o.id = new.relationship_organization_id and o.tenant_id = new.tenant_id
  ) then
    raise exception 'Organization subject does not belong to this tenant' using errcode = '23514';
  end if;
  if new.owner_id is not null and not exists (
    select 1 from public.tenant_memberships m
    where m.profile_id = new.owner_id and m.tenant_id = new.tenant_id
  ) then
    raise exception 'Task owner does not belong to the operating tenant' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.relationship_contact_id is null
    and old.relationship_organization_id is null then
    raise exception 'An existing unrelated task cannot be converted to a relationship task' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (
    new.tenant_id is distinct from old.tenant_id or
    new.client_id is distinct from old.client_id or
    new.staff_id is distinct from old.staff_id or
    new.campaign_id is distinct from old.campaign_id or
    new.exception_id is distinct from old.exception_id or
    new.created_by_profile_id is distinct from old.created_by_profile_id or
    new.relationship_contact_id is distinct from old.relationship_contact_id or
    new.relationship_organization_id is distinct from old.relationship_organization_id
  ) then
    raise exception 'Relationship task provenance is immutable' using errcode = '23514';
  end if;
  return new;
end;
$func$;
revoke all on function private.crm_validate_relationship_task_subject() from public, anon, authenticated;
drop trigger if exists crm_validate_relationship_task_subject on public.crm_tasks;
create trigger crm_validate_relationship_task_subject
  before insert or update on public.crm_tasks
  for each row execute function private.crm_validate_relationship_task_subject();

-- CRM operators can see/modify *only* non-clinical relationship-linked rows.
-- The existing admin/staff task policies are retained and NOT broadened.
create policy crm_relationship_tasks_select on public.crm_tasks
  for select to authenticated using (
    client_id is null
    and (relationship_contact_id is not null or relationship_organization_id is not null)
    and private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'view_relationships')
  );
create policy crm_relationship_tasks_insert on public.crm_tasks
  for insert to authenticated with check (
    client_id is null
    and (relationship_contact_id is not null or relationship_organization_id is not null)
    and created_by_profile_id = (select auth.uid())
    and private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships')
  );
create policy crm_relationship_tasks_update on public.crm_tasks
  for update to authenticated using (
    client_id is null
    and (relationship_contact_id is not null or relationship_organization_id is not null)
    and private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships')
  ) with check (
    client_id is null
    and (relationship_contact_id is not null or relationship_organization_id is not null)
    and private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships')
  );
