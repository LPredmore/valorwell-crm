-- The primary relationship contact is GLOBAL to the organization, never
-- per pipeline/opportunity. When an organization has exactly ONE linked contact,
-- that contact automatically becomes Primary. Multiple contacts retain the
-- previously designated primary; no arbitrary tie-breaker is allowed.
--
-- Backfill is narrowly scoped to one-contact, no-primary organizations.
-- Existing ambiguous multiple-primary affiliations are not changed.

create or replace function private.crm_guard_global_primary_contact()
returns trigger
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_current_count integer;
  v_old_lock text;
  v_new_lock text;
begin
  if tg_op = 'DELETE' then
    perform pg_advisory_xact_lock(
      hashtextextended(old.tenant_id::text || ':' || old.organization_id::text, 0));
    return old;
  end if;

  -- Serialize association writes for the same organization, including
  -- explicit non-primary inserts. If an association moves, acquire both
  -- organization locks in a stable order to avoid lock inversion.
  v_new_lock := new.tenant_id::text || ':' || new.organization_id::text;
  if tg_op = 'UPDATE' then
    v_old_lock := old.tenant_id::text || ':' || old.organization_id::text;
    if v_old_lock <> v_new_lock then
      perform pg_advisory_xact_lock(hashtextextended(least(v_old_lock,v_new_lock),0));
      perform pg_advisory_xact_lock(hashtextextended(greatest(v_old_lock,v_new_lock),0));
    else
      perform pg_advisory_xact_lock(hashtextextended(v_new_lock,0));
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended(v_new_lock,0));
  end if;

  select count(*) into v_current_count
    from public.relationship_contact_organizations a
    where a.tenant_id = new.tenant_id
      and a.organization_id = new.organization_id
      and (tg_op = 'INSERT'
        or a.organization_id is distinct from old.organization_id
        or a.tenant_id is distinct from old.tenant_id
        or a.contact_id is distinct from old.contact_id);

  if v_current_count = 0 then
    -- First/only association: turn on Primary even if the caller explicitly
    -- passed false (or was clearing the only primary by mistake).
    new.is_primary := true;
  elsif coalesce(new.is_primary,false) then
    -- Preserve the previous protection against competing primaries.
    -- Updating an unrelated field on a legacy ambiguous organization
    -- should not unexpectedly fail; only NEW primary selections are checked.
    if tg_op = 'INSERT' or old.is_primary is distinct from true
      or old.organization_id is distinct from new.organization_id
      or old.tenant_id is distinct from new.tenant_id
      or old.contact_id is distinct from new.contact_id then
      if exists(
        select 1 from public.relationship_contact_organizations a
        where a.organization_id = new.organization_id
          and a.tenant_id = new.tenant_id
          and a.is_primary
          and (tg_op = 'INSERT'
            or a.organization_id is distinct from old.organization_id
            or a.tenant_id is distinct from old.tenant_id
            or a.contact_id is distinct from old.contact_id)
      ) then
        raise exception 'ORGANIZATION_ALREADY_HAS_PRIMARY_CONTACT'
          using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$fn$;

revoke all on function private.crm_guard_global_primary_contact()
  from public, anon, authenticated;

drop trigger if exists crm_guard_global_primary_contact
  on public.relationship_contact_organizations;
create trigger crm_guard_global_primary_contact
  before insert or update of is_primary,organization_id,contact_id,tenant_id
     or delete on public.relationship_contact_organizations
  for each row execute function private.crm_guard_global_primary_contact();

-- After a contact is unlinked or moved to another organization, automatically
-- designate the sole remaining contact. Never choose among two or more.
create function private.crm_promote_last_organization_contact()
returns trigger language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_remaining integer;
  v_only_contact uuid;
begin
  if tg_op = 'UPDATE' and old.organization_id = new.organization_id
     and old.tenant_id = new.tenant_id then
    return null;
  end if;

  select count(*), min(a.contact_id::text)::uuid
    into v_remaining, v_only_contact
    from public.relationship_contact_organizations a
    where a.tenant_id = old.tenant_id
      and a.organization_id = old.organization_id;

  if v_remaining = 1 then
    update public.relationship_contact_organizations a
       set is_primary = true
     where a.tenant_id = old.tenant_id
       and a.organization_id = old.organization_id
       and a.contact_id = v_only_contact
       and not a.is_primary;
  end if;
  return null;
end;
$fn$;
revoke all on function private.crm_promote_last_organization_contact()
  from public, anon, authenticated;

create trigger crm_promote_last_organization_contact
  after delete or update of tenant_id,organization_id
  on public.relationship_contact_organizations
  for each row execute function private.crm_promote_last_organization_contact();

-- Existing one-contact legacy organizations: backfill without touching any
-- organizations with 2+ contacts, 0 contacts, or an already valid primary.
with sole as (
  select tenant_id, organization_id
  from public.relationship_contact_organizations
  group by tenant_id, organization_id
  having count(*) = 1 and count(*) filter (where is_primary) = 0
)
update public.relationship_contact_organizations a
   set is_primary = true
  from sole
 where a.tenant_id = sole.tenant_id
   and a.organization_id = sole.organization_id
   and not a.is_primary;
