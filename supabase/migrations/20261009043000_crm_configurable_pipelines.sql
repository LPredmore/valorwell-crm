-- User-configurable pipelines. No existing clinician, client, donor or BTY source
-- table/status is altered or backfilled by this migration.
create table public.crm_pipelines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  subject_type text not null check (subject_type in ('person','organization')),
  source_mode text not null default 'manual' check (source_mode in ('manual','connected')),
  source_key text,
  card_field_keys text[] not null default array[]::text[],
  sort_field_keys text[] not null default array['updated_at']::text[],
  archived_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  constraint crm_pipelines_source_key_check check (
    (source_mode = 'manual' and source_key is null) or
    (source_mode = 'connected' and source_key is not null and source_key ~ '^[a-z][a-z0-9_]{1,63}$')
  )
);
create unique index crm_pipelines_tenant_name_unique on public.crm_pipelines
  (tenant_id,lower(name)) where archived_at is null;
create index crm_pipelines_tenant_active_idx on public.crm_pipelines(tenant_id,created_at)
  where archived_at is null;

create table public.crm_pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  pipeline_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 100),
  position integer not null check (position >= 0),
  is_terminal boolean not null default false,
  source_stage_key text,
  created_at timestamptz not null default now(),
  foreign key(tenant_id,pipeline_id) references public.crm_pipelines(tenant_id,id) on delete cascade,
  unique(tenant_id,pipeline_id,id),
  unique(pipeline_id,position),
  unique(pipeline_id,name)
);
create table public.crm_pipeline_fields (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  pipeline_id uuid not null,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  label text not null check (length(btrim(label)) between 1 and 100),
  field_type text not null check (field_type in ('text','number','date','datetime','boolean','currency','url','select','multiselect')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options)='array'),
  required boolean not null default false,
  show_on_card boolean not null default false,
  allow_sort boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key(tenant_id,pipeline_id) references public.crm_pipelines(tenant_id,id) on delete cascade,
  unique(pipeline_id,field_key)
);

create table public.crm_pipeline_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  pipeline_id uuid not null,
  stage_id uuid not null,
  contact_id uuid,
  organization_id uuid,
  owner_profile_id uuid references public.profiles(id),
  next_action text,
  next_action_due_at timestamptz,
  field_values jsonb not null default '{}'::jsonb check (jsonb_typeof(field_values)='object'),
  source_record_type text,
  source_record_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  check (num_nonnulls(contact_id,organization_id)=1),
  check ((source_record_type is null)=(source_record_id is null)),
  foreign key(tenant_id,pipeline_id) references public.crm_pipelines(tenant_id,id) on delete cascade,
  foreign key(tenant_id,pipeline_id,stage_id) references public.crm_pipeline_stages(tenant_id,pipeline_id,id),
  foreign key(tenant_id,contact_id) references public.relationship_contacts(tenant_id,id),
  foreign key(tenant_id,organization_id) references public.relationship_organizations(tenant_id,id),
  unique(tenant_id,pipeline_id,id)
);
create unique index crm_pipeline_record_person_unique on public.crm_pipeline_records(pipeline_id,contact_id)
  where contact_id is not null;
create unique index crm_pipeline_record_org_unique on public.crm_pipeline_records(pipeline_id,organization_id)
  where organization_id is not null;
create index crm_pipeline_records_board_idx on public.crm_pipeline_records(tenant_id,pipeline_id,stage_id,updated_at desc);

create table public.crm_pipeline_stage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  pipeline_id uuid not null,
  record_id uuid not null,
  from_stage_id uuid,
  to_stage_id uuid not null,
  actor_profile_id uuid,
  occurred_at timestamptz not null default now(),
  foreign key(tenant_id,pipeline_id,record_id) references public.crm_pipeline_records(tenant_id,pipeline_id,id) on delete cascade
);
create index crm_pipeline_events_record_idx on public.crm_pipeline_stage_events(tenant_id,record_id,occurred_at desc);

-- Pipeline identity is immutable after creation; configurations are data,
-- but cannot be used to turn personal records into organization records.
create function private.crm_validate_pipeline_config()
returns trigger language plpgsql security invoker set search_path=''
as $f$
declare v_key text;
begin
  if tg_op='UPDATE' then
    if new.tenant_id is distinct from old.tenant_id
      or new.subject_type is distinct from old.subject_type
      or new.source_mode is distinct from old.source_mode
      or new.source_key is distinct from old.source_key
      or new.created_by is distinct from old.created_by then
      raise exception 'PIPELINE_IDENTITY_IMMUTABLE' using errcode='23514';
    end if;
  end if;
  foreach v_key in array new.card_field_keys loop
    if not exists(select 1 from public.crm_pipeline_fields
      where tenant_id=new.tenant_id and pipeline_id=new.id
      and field_key=v_key and show_on_card) then
      raise exception 'CARD_FIELD_MUST_BE_ENABLED: %',v_key using errcode='23514';
    end if;
  end loop;
  foreach v_key in array new.sort_field_keys loop
    if v_key not in ('updated_at','created_at','next_action_due_at')
    and not exists(select 1 from public.crm_pipeline_fields
      where tenant_id=new.tenant_id and pipeline_id=new.id
      and field_key=v_key and allow_sort) then
      raise exception 'SORT_FIELD_MUST_BE_ENABLED: %',v_key using errcode='23514';
    end if;
  end loop;
  new.updated_at:=now();
  return new;
end;
$f$;
revoke all on function private.crm_validate_pipeline_config() from public,anon,authenticated;
create trigger crm_validate_pipeline_config
  before insert or update on public.crm_pipelines
  for each row execute function private.crm_validate_pipeline_config();

-- Two safeguards: user cannot manufacture a clinician/client source stage,
-- nor create an organization pipeline card with ambiguous/absent primary.
create function private.crm_validate_pipeline_record()
returns trigger language plpgsql security invoker set search_path = ''
as $f$
declare v_subject_type text; v_source_mode text; v_count integer;
  v_field_key text; v_field public.crm_pipeline_fields%rowtype; v_value jsonb;
begin
  select subject_type,source_mode into v_subject_type,v_source_mode
    from public.crm_pipelines where tenant_id=new.tenant_id and id=new.pipeline_id and archived_at is null;
  if not found then raise exception 'PIPELINE_NOT_AVAILABLE' using errcode='23514'; end if;
  if (v_subject_type='person') <> (new.contact_id is not null) then
    raise exception 'PIPELINE_SUBJECT_MISMATCH' using errcode='23514';
  end if;
  if v_source_mode='connected' and current_user <> 'service_role' then
    raise exception 'CONNECTED_PIPELINE_READ_ONLY' using errcode='42501';
  end if;
  if v_source_mode='manual' and new.source_record_type is not null then
    raise exception 'SOURCE_LINK_REQUIRES_ADAPTER' using errcode='23514';
  end if;
  if new.organization_id is not null then
    select count(*) into v_count from public.relationship_contact_organizations
      where organization_id=new.organization_id and tenant_id=new.tenant_id and is_primary=true;
    if v_count<>1 then raise exception 'ORGANIZATION_REQUIRES_ONE_PRIMARY_CONTACT' using errcode='23514'; end if;
  end if;
  if new.owner_profile_id is not null and not exists (
    select 1 from public.tenant_memberships
    where profile_id=new.owner_profile_id and tenant_id=new.tenant_id
  ) then raise exception 'OWNER_CROSS_TENANT' using errcode='42501'; end if;
  for v_field_key in select jsonb_object_keys(new.field_values) loop
    select * into v_field from public.crm_pipeline_fields f where f.tenant_id=new.tenant_id
      and f.pipeline_id=new.pipeline_id and f.field_key=v_field_key;
    if not found then raise exception 'UNKNOWN_PIPELINE_FIELD: %',v_field_key using errcode='23514'; end if;
    v_value:=new.field_values->v_field_key;
    if v_value <> 'null'::jsonb then
      if v_field.field_type in ('text','date','datetime','url','select') and jsonb_typeof(v_value)<>'string'
      or v_field.field_type in ('number','currency') and jsonb_typeof(v_value)<>'number'
      or v_field.field_type='boolean' and jsonb_typeof(v_value)<>'boolean'
      or v_field.field_type='multiselect' and jsonb_typeof(v_value)<>'array' then
        raise exception 'PIPELINE_FIELD_TYPE_MISMATCH: %',v_field_key using errcode='23514';
      end if;
      if v_field.field_type='select' and jsonb_array_length(v_field.options)>0
        and not(v_field.options ? trim(both '"' from v_value::text)) then
        raise exception 'PIPELINE_SELECT_OPTION_NOT_ALLOWED: %',v_field_key using errcode='23514';
      end if;
    end if;
  end loop;
  if exists(select 1 from public.crm_pipeline_fields f
      where f.pipeline_id=new.pipeline_id and f.tenant_id=new.tenant_id
        and f.required and (not(new.field_values ? f.field_key)
        or new.field_values->f.field_key='null'::jsonb
        or new.field_values->>f.field_key='')) then
    raise exception 'PIPELINE_REQUIRED_FIELD_MISSING' using errcode='23514';
  end if;
  if tg_op='UPDATE' then
    if new.tenant_id is distinct from old.tenant_id
      or new.pipeline_id is distinct from old.pipeline_id
      or new.contact_id is distinct from old.contact_id
      or new.organization_id is distinct from old.organization_id
      or new.source_record_id is distinct from old.source_record_id
      or new.source_record_type is distinct from old.source_record_type then
      raise exception 'PIPELINE_RECORD_IDENTITY_IMMUTABLE' using errcode='23514';
    end if;
    new.version := old.version+1;
  end if;
  new.updated_at:=now();
  return new;
end;
$f$;
revoke all on function private.crm_validate_pipeline_record() from public,anon,authenticated;
create trigger crm_validate_pipeline_record
  before insert or update on public.crm_pipeline_records
  for each row execute function private.crm_validate_pipeline_record();

create function private.crm_audit_pipeline_stage()
returns trigger language plpgsql security invoker set search_path = ''
as $f$
begin
  if tg_op='INSERT' or new.stage_id is distinct from old.stage_id then
    insert into public.crm_pipeline_stage_events(tenant_id,pipeline_id,record_id,from_stage_id,to_stage_id,actor_profile_id)
      values(new.tenant_id,new.pipeline_id,new.id,
        case when tg_op='INSERT' then null else old.stage_id end,new.stage_id,(select auth.uid()));
  end if;
  return null;
end;
$f$;
revoke all on function private.crm_audit_pipeline_stage() from public,anon,authenticated;
create trigger crm_audit_pipeline_stage
  after insert or update of stage_id on public.crm_pipeline_records
  for each row execute function private.crm_audit_pipeline_stage();

-- New pipeline definitions are admin-managed; operators may modify MANUAL
-- workflow records. No clinical source tables or clinician statuses exposed.
alter table public.crm_pipelines enable row level security;
alter table public.crm_pipeline_stages enable row level security;
alter table public.crm_pipeline_fields enable row level security;
alter table public.crm_pipeline_records enable row level security;
alter table public.crm_pipeline_stage_events enable row level security;

create function private.crm_is_pipeline_admin(p_tenant uuid)
returns boolean language sql stable security invoker set search_path=''
as $f$
  select (select auth.uid()) is not null and exists (
    select 1 from public.crm_user_capabilities c where c.profile_id=(select auth.uid())
      and c.tenant_id=p_tenant and c.crm_role::text='crm_admin'
  )
$f$;
revoke all on function private.crm_is_pipeline_admin(uuid) from public,anon;
grant execute on function private.crm_is_pipeline_admin(uuid) to authenticated;

create policy crm_pipeline_list on public.crm_pipelines for select to authenticated
  using(private.crm_has_relationship_permission((select auth.uid()),tenant_id,'view_relationships'));
create policy crm_pipeline_create on public.crm_pipelines for insert to authenticated
  with check(private.crm_is_pipeline_admin(tenant_id) and created_by=(select auth.uid()));
create policy crm_pipeline_edit on public.crm_pipelines for update to authenticated
  using(private.crm_is_pipeline_admin(tenant_id))
  with check(private.crm_is_pipeline_admin(tenant_id));

create policy crm_pipeline_stages_list on public.crm_pipeline_stages for select to authenticated
  using(private.crm_has_relationship_permission((select auth.uid()),tenant_id,'view_relationships'));
create policy crm_pipeline_stages_create on public.crm_pipeline_stages for insert to authenticated
  with check(private.crm_is_pipeline_admin(tenant_id));
create policy crm_pipeline_stages_edit on public.crm_pipeline_stages for update to authenticated
  using(private.crm_is_pipeline_admin(tenant_id)) with check(private.crm_is_pipeline_admin(tenant_id));

create policy crm_pipeline_fields_list on public.crm_pipeline_fields for select to authenticated
  using(private.crm_has_relationship_permission((select auth.uid()),tenant_id,'view_relationships'));
create policy crm_pipeline_fields_create on public.crm_pipeline_fields for insert to authenticated
  with check(private.crm_is_pipeline_admin(tenant_id));
create policy crm_pipeline_fields_edit on public.crm_pipeline_fields for update to authenticated
  using(private.crm_is_pipeline_admin(tenant_id)) with check(private.crm_is_pipeline_admin(tenant_id));

create policy crm_pipeline_records_list on public.crm_pipeline_records for select to authenticated
  using(private.crm_has_relationship_permission((select auth.uid()),tenant_id,'view_relationships'));
create policy crm_pipeline_records_create on public.crm_pipeline_records for insert to authenticated
  with check(private.crm_has_relationship_permission((select auth.uid()),tenant_id,'edit_relationships'));
create policy crm_pipeline_records_edit on public.crm_pipeline_records for update to authenticated
  using(private.crm_has_relationship_permission((select auth.uid()),tenant_id,'edit_relationships'))
  with check(private.crm_has_relationship_permission((select auth.uid()),tenant_id,'edit_relationships'));

create policy crm_pipeline_events_list on public.crm_pipeline_stage_events for select to authenticated
  using(private.crm_has_relationship_permission((select auth.uid()),tenant_id,'view_relationships'));

grant select,insert,update on public.crm_pipelines,public.crm_pipeline_stages,public.crm_pipeline_fields,public.crm_pipeline_records to authenticated;
grant select on public.crm_pipeline_stage_events to authenticated;
-- Audit trigger inserts run as invoker, so grant audit insert exclusively via a
-- narrow insert policy requiring author + ownership of the referenced record.
create policy crm_pipeline_events_append on public.crm_pipeline_stage_events for insert to authenticated
  with check(actor_profile_id=(select auth.uid())
  and private.crm_has_relationship_permission((select auth.uid()),tenant_id,'edit_relationships'));
grant insert on public.crm_pipeline_stage_events to authenticated;
