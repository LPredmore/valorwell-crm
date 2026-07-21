alter table public.relationship_organizations
  add column if not exists relationship_stage text not null default 'identified',
  add column if not exists created_by_profile_id uuid,
  add column if not exists updated_by_profile_id uuid;

alter table public.relationship_contacts
  add column if not exists relationship_stage text not null default 'identified',
  add column if not exists created_by_profile_id uuid,
  add column if not exists updated_by_profile_id uuid;

update public.relationship_organizations
set relationship_stage = case outreach_status
  when 'new' then 'identified'
  when 'reviewing' then 'qualified_outreach'
  when 'contacted' then 'contacted'
  when 'engaged' then 'engaged'
  when 'waiting' then 'nurture'
  when 'closed' then 'closed_no_fit'
  when 'do_not_contact' then 'inactive'
  else 'identified'
end
where relationship_stage = 'identified';

update public.relationship_contacts
set relationship_stage = case outreach_status
  when 'new' then 'identified'
  when 'reviewing' then 'qualified_outreach'
  when 'contacted' then 'contacted'
  when 'engaged' then 'engaged'
  when 'waiting' then 'nurture'
  when 'closed' then 'closed_no_fit'
  when 'do_not_contact' then 'inactive'
  else 'identified'
end
where relationship_stage = 'identified';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'relationship_organizations_stage_check') then
    alter table public.relationship_organizations add constraint relationship_organizations_stage_check
    check (relationship_stage = any (array['identified','qualified_outreach','contacted','engaged','discovery','next_step_agreed','active','nurture','closed_no_fit','inactive']::text[]));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'relationship_contacts_stage_check') then
    alter table public.relationship_contacts add constraint relationship_contacts_stage_check
    check (relationship_stage = any (array['identified','qualified_outreach','contacted','engaged','discovery','next_step_agreed','active','nurture','closed_no_fit','inactive']::text[]));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'relationship_organizations_created_by_profile_id_fkey') then
    alter table public.relationship_organizations add constraint relationship_organizations_created_by_profile_id_fkey foreign key (created_by_profile_id) references public.profiles(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'relationship_organizations_updated_by_profile_id_fkey') then
    alter table public.relationship_organizations add constraint relationship_organizations_updated_by_profile_id_fkey foreign key (updated_by_profile_id) references public.profiles(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'relationship_contacts_created_by_profile_id_fkey') then
    alter table public.relationship_contacts add constraint relationship_contacts_created_by_profile_id_fkey foreign key (created_by_profile_id) references public.profiles(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'relationship_contacts_updated_by_profile_id_fkey') then
    alter table public.relationship_contacts add constraint relationship_contacts_updated_by_profile_id_fkey foreign key (updated_by_profile_id) references public.profiles(id) on delete set null;
  end if;
end $$;

create or replace function public.set_relationship_audit_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.created_by_profile_id := coalesce(v_actor, new.created_by_profile_id);
    new.updated_by_profile_id := coalesce(v_actor, new.updated_by_profile_id, new.created_by_profile_id);
  else
    new.created_by_profile_id := old.created_by_profile_id;
    new.updated_by_profile_id := coalesce(v_actor, new.updated_by_profile_id, old.updated_by_profile_id);
  end if;
  return new;
end;
$$;

drop trigger if exists set_relationship_organizations_audit_fields on public.relationship_organizations;
create trigger set_relationship_organizations_audit_fields before insert or update on public.relationship_organizations for each row execute function public.set_relationship_audit_fields();

drop trigger if exists set_relationship_contacts_audit_fields on public.relationship_contacts;
create trigger set_relationship_contacts_audit_fields before insert or update on public.relationship_contacts for each row execute function public.set_relationship_audit_fields();

create index if not exists relationship_organizations_stage_idx on public.relationship_organizations (tenant_id, relationship_stage, owner_profile_id, next_action_due_at);
create index if not exists relationship_contacts_stage_idx on public.relationship_contacts (tenant_id, relationship_stage, owner_profile_id, next_action_due_at);
