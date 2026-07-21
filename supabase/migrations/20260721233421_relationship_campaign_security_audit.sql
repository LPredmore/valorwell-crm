create or replace function public.set_relationship_campaign_audit_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
    new.purpose := btrim(new.purpose);
    new.initiative := nullif(btrim(new.initiative), '');
    new.sender_name := regexp_replace(btrim(new.sender_name), '\s+', ' ', 'g');
    new.sender_email := lower(btrim(new.sender_email));
    new.default_timezone := btrim(new.default_timezone);
    new.source := lower(btrim(new.source));
    new.created_by_profile_id := coalesce(v_actor, new.created_by_profile_id);
    new.updated_by_profile_id := coalesce(v_actor, new.updated_by_profile_id, new.created_by_profile_id);
    new.version := 1;
  else
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'Campaign tenant cannot be changed.' using errcode = '22023';
    end if;
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by_profile_id := old.created_by_profile_id;
    new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
    new.purpose := btrim(new.purpose);
    new.initiative := nullif(btrim(new.initiative), '');
    new.sender_name := regexp_replace(btrim(new.sender_name), '\s+', ' ', 'g');
    new.sender_email := lower(btrim(new.sender_email));
    new.default_timezone := btrim(new.default_timezone);
    new.source := lower(btrim(new.source));
    new.updated_by_profile_id := coalesce(v_actor, new.updated_by_profile_id, old.updated_by_profile_id);
    new.updated_at := now();
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

create trigger set_relationship_campaigns_audit_fields
before insert or update on public.relationship_campaigns
for each row execute function public.set_relationship_campaign_audit_fields();

create or replace function public.set_relationship_campaign_step_audit_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  new.subject_template := btrim(new.subject_template);
  new.body_template := btrim(new.body_template);
  if tg_op = 'INSERT' then
    new.created_by_profile_id := coalesce(v_actor, new.created_by_profile_id);
    new.updated_by_profile_id := coalesce(v_actor, new.updated_by_profile_id, new.created_by_profile_id);
  else
    if new.tenant_id is distinct from old.tenant_id
       or new.campaign_id is distinct from old.campaign_id then
      raise exception 'Campaign step tenant and campaign cannot be changed.' using errcode = '22023';
    end if;
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by_profile_id := old.created_by_profile_id;
    new.updated_by_profile_id := coalesce(v_actor, new.updated_by_profile_id, old.updated_by_profile_id);
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger set_relationship_campaign_steps_audit_fields
before insert or update on public.relationship_campaign_steps
for each row execute function public.set_relationship_campaign_step_audit_fields();

alter table public.relationship_campaigns enable row level security;
alter table public.relationship_campaign_steps enable row level security;
alter table private.relationship_campaign_idempotency enable row level security;

create policy relationship_campaigns_crm_select
on public.relationship_campaigns
for select
to authenticated
using (
  exists (
    select 1
    from public.crm_user_capabilities capability
    where capability.profile_id = (select auth.uid())
      and capability.tenant_id = relationship_campaigns.tenant_id
      and capability.crm_role <> 'crm_none'::public.crm_capability_role
  )
);

create policy relationship_campaign_steps_crm_select
on public.relationship_campaign_steps
for select
to authenticated
using (
  exists (
    select 1
    from public.crm_user_capabilities capability
    where capability.profile_id = (select auth.uid())
      and capability.tenant_id = relationship_campaign_steps.tenant_id
      and capability.crm_role <> 'crm_none'::public.crm_capability_role
  )
);

revoke all on table public.relationship_campaigns from public, anon, authenticated;
grant select on table public.relationship_campaigns to authenticated;
grant all on table public.relationship_campaigns to service_role;

revoke all on table public.relationship_campaign_steps from public, anon, authenticated;
grant select on table public.relationship_campaign_steps to authenticated;
grant all on table public.relationship_campaign_steps to service_role;

revoke all on table private.relationship_campaign_idempotency from public, anon, authenticated;
grant all on table private.relationship_campaign_idempotency to service_role;

revoke all on function public.set_relationship_campaign_audit_fields() from public, anon, authenticated;
revoke all on function public.set_relationship_campaign_step_audit_fields() from public, anon, authenticated;
