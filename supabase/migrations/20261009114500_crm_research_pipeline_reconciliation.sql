-- Link research inventories to the generic relationship pipeline without
-- changing any clinical/clinician statuses or assigning a primary automatically.
alter table public.crm_va_vaccn_referral_contacts
  add column if not exists relationship_organization_id uuid;
alter table public.crm_va_vaccn_referral_contacts
  add constraint crm_va_referral_org_tenant_fk
  foreign key(tenant_id,relationship_organization_id)
  references public.relationship_organizations(tenant_id,id);
create index crm_va_referral_linked_org_idx on public.crm_va_vaccn_referral_contacts
  (tenant_id,relationship_organization_id) where relationship_organization_id is not null;

create table public.crm_pipeline_source_bindings(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  pipeline_id uuid not null,
  source_kind text not null check(source_kind in ('institutional_recruiting','va_facilities','donor_giving')),
  created_at timestamptz not null default now(),
  foreign key(tenant_id,pipeline_id) references public.crm_pipelines(tenant_id,id) on delete cascade,
  unique(tenant_id,source_kind),
  unique(pipeline_id)
);
alter table public.crm_pipeline_source_bindings enable row level security;
create policy crm_pipeline_source_binding_read on public.crm_pipeline_source_bindings for select to authenticated
  using(private.crm_has_relationship_permission((select auth.uid()),tenant_id,'view_relationships'));
create policy crm_pipeline_source_binding_manage on public.crm_pipeline_source_bindings for all to authenticated
  using(private.crm_is_pipeline_admin(tenant_id))
  with check(private.crm_is_pipeline_admin(tenant_id));
grant select,insert,update,delete on public.crm_pipeline_source_bindings to authenticated;

-- These three initial bindings are configuration, not special-case frontend names.
insert into public.crm_pipeline_source_bindings(tenant_id,pipeline_id,source_kind)
select tenant_id,id,case name
  when 'Institutional Recruiting' then 'institutional_recruiting'
  when 'VA Medical Centers' then 'va_facilities'
  when 'Donors' then 'donor_giving'
end
from public.crm_pipelines
where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
 and name in ('Institutional Recruiting','VA Medical Centers','Donors')
on conflict(tenant_id,source_kind) do nothing;

-- All operations are invoker/RLS-authorized and source idempotent.
-- The chosen ORGANIZATION must already have ONE canonical organization-wide
-- primary; research contact names are never silently selected as a primary.
create function public.crm_enroll_research_source(
  p_pipeline_id uuid,p_source_id uuid,p_organization_id uuid
) returns uuid
language plpgsql security invoker set search_path=''
as $f$
declare
  v_tenant uuid;
  v_kind text;
  v_org uuid;
  v_stage uuid;
  v_record uuid;
  v_fields jsonb;
  v_primary_count integer;
  v_source_tenant uuid;
begin
  select p.tenant_id,b.source_kind into v_tenant,v_kind
  from public.crm_pipelines p join public.crm_pipeline_source_bindings b
     on b.pipeline_id=p.id and b.tenant_id=p.tenant_id
  where p.id=p_pipeline_id and p.subject_type='organization'
    and p.source_mode='manual' and p.archived_at is null
    and b.source_kind in ('institutional_recruiting','va_facilities');
  if not found or not private.crm_has_relationship_permission((select auth.uid()),v_tenant,'edit_relationships') then
     raise exception 'PIPELINE_NOT_AUTHORIZED' using errcode='42501';
  end if;
  if not exists(select 1 from public.relationship_organizations o
     where o.id=p_organization_id and o.tenant_id=v_tenant) then
    raise exception 'ORGANIZATION_NOT_IN_TENANT' using errcode='42501';
  end if;
  select count(*) into v_primary_count from public.relationship_contact_organizations a
   where a.tenant_id=v_tenant and a.organization_id=p_organization_id and a.is_primary;
  if v_primary_count<>1 then
    raise exception 'ORGANIZATION_REQUIRES_EXACTLY_ONE_PRIMARY_CONTACT' using errcode='23514';
  end if;
  if v_kind='institutional_recruiting' then
    select tenant_id,relationship_organization_id into v_source_tenant,v_org
      from public.relationship_institutional_recruiting_targets
      where id=p_source_id for update;
    if not found or v_source_tenant<>v_tenant then
      raise exception 'RESEARCH_SOURCE_NOT_FOUND' using errcode='42501';
    end if;
    if v_org is not null and v_org<>p_organization_id then
      raise exception 'RESEARCH_SOURCE_ALREADY_LINKED_TO_ANOTHER_ORGANIZATION' using errcode='23505';
    end if;
    select jsonb_build_object('state_code',t.state_code,'organization_type',t.organization_type,
      'specific_office',t.specific_office,'website',t.website) into v_fields
    from public.relationship_institutional_recruiting_targets t where t.id=p_source_id;
    update public.relationship_institutional_recruiting_targets
      set relationship_organization_id=p_organization_id,updated_at=now()
      where id=p_source_id and relationship_organization_id is null;
  else
    select tenant_id,relationship_organization_id into v_source_tenant,v_org
    from public.crm_va_vaccn_referral_contacts where id=p_source_id for update;
    if not found or v_source_tenant<>v_tenant then
       raise exception 'RESEARCH_SOURCE_NOT_FOUND' using errcode='42501';
    end if;
    if v_org is not null and v_org<>p_organization_id then
       raise exception 'RESEARCH_SOURCE_ALREADY_LINKED_TO_ANOTHER_ORGANIZATION' using errcode='23505';
    end if;
    select jsonb_build_object('visn',v.visn,'station_number',v.station_number,
      'state',v.state,'contact_role',v.contact_role) into v_fields
      from public.crm_va_vaccn_referral_contacts v where v.id=p_source_id;
    update public.crm_va_vaccn_referral_contacts
      set relationship_organization_id=p_organization_id,updated_at=now()
      where id=p_source_id and relationship_organization_id is null;
  end if;
  select id into v_stage from public.crm_pipeline_stages
    where pipeline_id=p_pipeline_id and tenant_id=v_tenant
    order by position asc limit 1;
  if v_stage is null then raise exception 'PIPELINE_HAS_NO_INITIAL_STAGE' using errcode='23514'; end if;
  insert into public.crm_pipeline_records(tenant_id,pipeline_id,stage_id,organization_id,field_values)
    values(v_tenant,p_pipeline_id,v_stage,p_organization_id,coalesce(v_fields,'{}'::jsonb))
    on conflict do nothing returning id into v_record;
  if v_record is null then
    select id into v_record from public.crm_pipeline_records
       where pipeline_id=p_pipeline_id and tenant_id=v_tenant and organization_id=p_organization_id;
  end if;
  if v_record is null then raise exception 'PIPELINE_RECORD_NOT_CREATED' using errcode='23514'; end if;
  return v_record;
end;
$f$;
revoke all on function public.crm_enroll_research_source(uuid,uuid,uuid) from public,anon;
grant execute on function public.crm_enroll_research_source(uuid,uuid,uuid) to authenticated;

-- An explicit one-click approval is required before promoting researched
-- source contact information to the organization's global primary contact.
-- No bulk import, background primary selection or emails are triggered.
create function public.crm_create_research_organization(
  p_pipeline_id uuid,p_source_id uuid,p_primary_name text,p_primary_email text,
  p_confirm_regional_facility boolean default false
) returns uuid
language plpgsql security invoker set search_path=''
as $f$
declare
  v_tenant uuid;
  v_kind text;
  v_existing uuid;
  v_name text;
  v_website text;
  v_state text;
  v_org uuid;
  v_contact uuid;
  v_contact_count integer;
  v_first text;
  v_last text;
  v_source_id uuid;
  v_email text:=lower(btrim(p_primary_email));
  v_clean_name text:=btrim(p_primary_name);
begin
  select p.tenant_id,b.source_kind into v_tenant,v_kind
  from public.crm_pipelines p join public.crm_pipeline_source_bindings b
    on b.pipeline_id=p.id and b.tenant_id=p.tenant_id
  where p.id=p_pipeline_id and p.source_mode='manual'
    and p.subject_type='organization' and p.archived_at is null
    and b.source_kind in ('institutional_recruiting','va_facilities');
  if not found or not private.crm_has_relationship_permission((select auth.uid()),v_tenant,'edit_relationships')
    then raise exception 'PIPELINE_NOT_AUTHORIZED' using errcode='42501'; end if;
  if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
     raise exception 'PRIMARY_CONTACT_REQUIRES_REAL_EMAIL' using errcode='23514'; end if;
  if length(v_clean_name)<3 or strpos(v_clean_name,' ')=0 then
     raise exception 'PRIMARY_CONTACT_REQUIRES_REAL_PERSON_NAME' using errcode='23514'; end if;
  v_first:=split_part(v_clean_name,' ',1);
  v_last:=btrim(substr(v_clean_name,length(v_first)+2));
  if v_kind='institutional_recruiting' then
     select organization_name,website,state_code,relationship_organization_id
       into v_name,v_website,v_state,v_existing
     from public.relationship_institutional_recruiting_targets where id=p_source_id and tenant_id=v_tenant for update;
  else
     select facility_name,null,state,relationship_organization_id
       into v_name,v_website,v_state,v_existing
     from public.crm_va_vaccn_referral_contacts where id=p_source_id and tenant_id=v_tenant for update;
  end if;
  if not found then raise exception 'SOURCE_NOT_FOUND' using errcode='42501'; end if;
  if v_kind='va_facilities' and not p_confirm_regional_facility then
    raise exception 'VA_PRIMARY_REGIONAL_FACILITY_CONFIRMATION_REQUIRED' using errcode='23514';
  end if;
  if v_existing is not null then
    -- A previously accepted source cannot create duplicates on retries.
    perform public.crm_enroll_research_source(p_pipeline_id,p_source_id,v_existing);
    return v_existing;
  end if;
  if exists(select 1 from public.relationship_organizations o
     where o.tenant_id=v_tenant and lower(btrim(o.name))=lower(btrim(v_name))) then
     raise exception 'MATCHING_ORGANIZATION_REQUIRES_EXISTING_RECORD_LINK' using errcode='23505';
  end if;
  -- A known contact identity must be uniquely resolved, never duplicated
  -- or silently merged with a different person.
  select count(*),min(id::text)::uuid into v_contact_count,v_contact from public.relationship_contacts
    where tenant_id=v_tenant and email is not null and lower(btrim(email))=v_email;
  if v_contact_count>1 then
    raise exception 'AMBIGUOUS_PRIMARY_CONTACT_EMAIL' using errcode='23505';
  end if;
  if v_contact_count=0 then
     insert into public.relationship_contacts(tenant_id,first_name,last_name,email,
       source,source_record_key,created_by_profile_id,updated_by_profile_id)
     values(v_tenant,v_first,v_last,v_email,
       'crm_research_primary',v_kind||':'||p_source_id::text,(select auth.uid()),(select auth.uid()))
     returning id into v_contact;
  end if;
  insert into public.relationship_organizations(tenant_id,name,website,
    headquarters_state,organization_kind,source,source_record_key,
    created_by_profile_id,updated_by_profile_id)
   values(v_tenant,v_name,v_website,
    case when v_state~'^[A-Z]{2}$' then v_state else null end,
    case when v_kind='va_facilities' then 'va_medical_center' else 'institutional_recruiting' end,
    v_kind,v_kind||':'||p_source_id::text,(select auth.uid()),(select auth.uid()))
   returning id into v_org;
  insert into public.relationship_contact_organizations(
      tenant_id,contact_id,organization_id,role_title,is_primary)
    values(v_tenant,v_contact,v_org,'Primary relationship contact',true);
  perform public.crm_enroll_research_source(p_pipeline_id,p_source_id,v_org);
  return v_org;
end;
$f$;
revoke all on function public.crm_create_research_organization(uuid,uuid,text,text,boolean)
  from public,anon;
grant execute on function public.crm_create_research_organization(uuid,uuid,text,text,boolean) to authenticated;
