-- A Personal pipeline can optionally associate an organization while the
-- person remains the one required primary subject. This is generic to every
-- Personal pipeline, not a donor-specific field or independent primary contact.
alter table public.crm_pipeline_records
  add column if not exists associated_organization_id uuid;

alter table public.crm_pipeline_records
  add constraint crm_pipeline_associated_org_tenant_fk
    foreign key (tenant_id,associated_organization_id)
    references public.relationship_organizations(tenant_id,id);

create index crm_pipeline_associated_org_idx
  on public.crm_pipeline_records(tenant_id,associated_organization_id)
  where associated_organization_id is not null;

create function private.crm_validate_pipeline_associated_org()
returns trigger language plpgsql security invoker set search_path=''
as $f$
declare v_subject_type text;
begin
  if new.associated_organization_id is null then return new; end if;
  select subject_type into v_subject_type from public.crm_pipelines
    where id=new.pipeline_id and tenant_id=new.tenant_id;
  if v_subject_type is distinct from 'person' or new.contact_id is null then
    raise exception 'ASSOCIATED_ORGANIZATION_REQUIRES_PERSONAL_PIPELINE'
      using errcode='23514';
  end if;
  return new;
end;
$f$;
revoke all on function private.crm_validate_pipeline_associated_org()
  from public,anon,authenticated;
create trigger crm_validate_pipeline_associated_org
  before insert or update of associated_organization_id
  on public.crm_pipeline_records for each row
  execute function private.crm_validate_pipeline_associated_org();
