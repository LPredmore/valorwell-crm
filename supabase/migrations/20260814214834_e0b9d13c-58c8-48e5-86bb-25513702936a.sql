create table if not exists public.crm_campaign_registry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  campaign_domain text not null check (campaign_domain in ('client', 'relationship', 'staff', 'donor')),
  engine text not null check (engine in ('crm_campaigns', 'relationship_campaigns')),
  source_campaign_id uuid not null,
  name text not null,
  status text not null default 'unknown',
  is_active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, engine, source_campaign_id)
);

create index if not exists crm_campaign_registry_domain_idx on public.crm_campaign_registry (tenant_id, campaign_domain);

grant select on public.crm_campaign_registry to authenticated;
grant all on public.crm_campaign_registry to service_role;
alter table public.crm_campaign_registry enable row level security;

drop policy if exists "crm_campaign_registry_read" on public.crm_campaign_registry;
create policy "crm_campaign_registry_read" on public.crm_campaign_registry
for select to authenticated
using (public.is_tenant_member(auth.uid(), tenant_id));

drop trigger if exists crm_campaign_registry_touch on public.crm_campaign_registry;
create trigger crm_campaign_registry_touch before update on public.crm_campaign_registry
for each row execute function public.crm_touch_updated_at();

-- Registry synchronisation from the client campaign engine
create or replace function public.crm_sync_client_campaign_registry()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.crm_campaign_registry
    where engine = 'crm_campaigns' and source_campaign_id = old.id;
    return old;
  end if;

  insert into public.crm_campaign_registry (
    tenant_id, campaign_domain, engine, source_campaign_id, name, status, is_active
  )
  values (
    new.tenant_id, 'client', 'crm_campaigns', new.id, new.name,
    case when new.is_active then 'active' else 'inactive' end,
    coalesce(new.is_active, false)
  )
  on conflict (tenant_id, engine, source_campaign_id)
  do update set name = excluded.name,
                status = excluded.status,
                is_active = excluded.is_active,
                updated_at = now();
  return new;
end;
$$;

drop trigger if exists crm_campaigns_registry_sync on public.crm_campaigns;
create trigger crm_campaigns_registry_sync
after insert or update or delete on public.crm_campaigns
for each row execute function public.crm_sync_client_campaign_registry();

-- Registry synchronisation from the relationship campaign engine
create or replace function public.crm_sync_relationship_campaign_registry()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.crm_campaign_registry
    where engine = 'relationship_campaigns' and source_campaign_id = old.id;
    return old;
  end if;

  insert into public.crm_campaign_registry (
    tenant_id, campaign_domain, engine, source_campaign_id, name, status, is_active, metadata
  )
  values (
    new.tenant_id, 'relationship', 'relationship_campaigns', new.id, new.name,
    coalesce(new.status, 'unknown'),
    coalesce(new.execution_enabled, false) and coalesce(new.status, '') = 'active',
    jsonb_strip_nulls(jsonb_build_object('purpose', new.purpose, 'initiative', new.initiative))
  )
  on conflict (tenant_id, engine, source_campaign_id)
  do update set name = excluded.name,
                status = excluded.status,
                is_active = excluded.is_active,
                metadata = excluded.metadata,
                updated_at = now();
  return new;
end;
$$;

drop trigger if exists relationship_campaigns_registry_sync on public.relationship_campaigns;
create trigger relationship_campaigns_registry_sync
after insert or update or delete on public.relationship_campaigns
for each row execute function public.crm_sync_relationship_campaign_registry();

-- Backfill
insert into public.crm_campaign_registry (tenant_id, campaign_domain, engine, source_campaign_id, name, status, is_active)
select c.tenant_id, 'client', 'crm_campaigns', c.id, c.name,
       case when c.is_active then 'active' else 'inactive' end,
       coalesce(c.is_active, false)
from public.crm_campaigns c
on conflict (tenant_id, engine, source_campaign_id) do nothing;

insert into public.crm_campaign_registry (tenant_id, campaign_domain, engine, source_campaign_id, name, status, is_active, metadata)
select r.tenant_id, 'relationship', 'relationship_campaigns', r.id, r.name,
       coalesce(r.status, 'unknown'),
       coalesce(r.execution_enabled, false) and coalesce(r.status, '') = 'active',
       jsonb_strip_nulls(jsonb_build_object('purpose', r.purpose, 'initiative', r.initiative))
from public.relationship_campaigns r
on conflict (tenant_id, engine, source_campaign_id) do nothing;

-- Unified cross-domain participation projection
create or replace view public.crm_campaign_participation_v
with (security_invoker = on) as
select e.id as enrollment_id,
       e.tenant_id,
       'client'::text as campaign_domain,
       'crm_campaigns'::text as engine,
       e.campaign_id as source_campaign_id,
       reg.name as campaign_name,
       'client'::text as subject_domain,
       e.client_id as subject_record_id,
       pr.person_id,
       e.status,
       e.enrolled_at,
       e.completed_at,
       e.current_step as step_position,
       e.updated_at
from public.crm_campaign_enrollments e
left join public.crm_campaign_registry reg
  on reg.tenant_id = e.tenant_id and reg.engine = 'crm_campaigns' and reg.source_campaign_id = e.campaign_id
left join public.crm_person_records pr
  on pr.tenant_id = e.tenant_id and pr.record_domain = 'client' and pr.record_id = e.client_id
union all
select re.id,
       re.tenant_id,
       'relationship'::text,
       'relationship_campaigns'::text,
       re.campaign_id,
       reg.name,
       'relationship_contact'::text,
       re.contact_id,
       pr.person_id,
       re.status,
       re.created_at,
       null::timestamptz,
       re.current_step_position,
       re.updated_at
from public.relationship_campaign_enrollments re
left join public.crm_campaign_registry reg
  on reg.tenant_id = re.tenant_id and reg.engine = 'relationship_campaigns' and reg.source_campaign_id = re.campaign_id
left join public.crm_person_records pr
  on pr.tenant_id = re.tenant_id and pr.record_domain = 'relationship_contact' and pr.record_id = re.contact_id;

grant select on public.crm_campaign_participation_v to authenticated;
grant select on public.crm_campaign_participation_v to service_role;

create or replace function public.crm_campaign_participation(
  p_person_id uuid default null,
  p_campaign_domain text default null,
  p_source_campaign_id uuid default null,
  p_status text default null,
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(false);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_limit int := least(greatest(coalesce(p_limit, 200), 1), 1000);
begin
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.enrolled_at desc nulls last)
    from (
      select v.enrollment_id as "enrollmentId",
             v.campaign_domain as "campaignDomain",
             v.engine,
             v.source_campaign_id as "sourceCampaignId",
             v.campaign_name as "campaignName",
             v.subject_domain as "subjectDomain",
             v.subject_record_id as "subjectRecordId",
             v.person_id as "personId",
             v.status,
             v.enrolled_at as "enrolledAt",
             v.completed_at as "completedAt",
             v.step_position as "stepPosition"
      from public.crm_campaign_participation_v v
      where v.tenant_id = v_tenant
        and (p_person_id is null or v.person_id = p_person_id)
        and (p_campaign_domain is null or v.campaign_domain = p_campaign_domain)
        and (p_source_campaign_id is null or v.source_campaign_id = p_source_campaign_id)
        and (p_status is null or v.status = p_status)
      order by v.enrolled_at desc nulls last
      limit v_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.crm_campaign_participation(uuid, text, uuid, text, integer) from public;
grant execute on function public.crm_campaign_participation(uuid, text, uuid, text, integer) to authenticated;