-- Approved current-tenant identity overlay. No source records are written.
-- Standalone live migration; also upgrades the known Oct 8 historical schema.
-- Do not apply the historical identity migration alone after this migration.
begin;

do $preflight$
declare
  v_shape text;
  v_table text;
begin
  if (to_regclass('public.crm_identity_reviews') is null) <>
     (to_regclass('public.crm_identity_review_events') is null) then
    raise exception 'Partial identity schema: manual dependency review required';
  end if;
  if to_regclass('public.crm_therapist_prospect_attributions') is not null then
    if exists(select 1 from public.crm_therapist_prospect_attributions) then
      raise exception 'Populated legacy prospect attribution requires reconciliation review';
    end if;
  end if;
  foreach v_table in array array['relationship_contacts','relationship_opportunities',
    'provider_applicants','therapist_outreach_prospects','clients'] loop
    if (select count(*) from information_schema.columns c
      where c.table_schema='public' and c.table_name=v_table
        and c.column_name in ('id','tenant_id') and c.data_type='uuid' and c.is_nullable='NO') <> 2 then
      raise exception 'Source tenant contract changed for %', v_table;
    end if;
  end loop;
  if to_regclass('public.crm_identity_reviews') is not null then
    select string_agg(a.attname || ':' || pg_catalog.format_type(a.atttypid,a.atttypmod), ',' order by a.attname)
      into v_shape from pg_catalog.pg_attribute a
      where a.attrelid='public.crm_identity_reviews'::regclass and a.attnum>0 and not a.attisdropped;
    if v_shape <> 'contact_id:uuid,created_at:timestamp with time zone,decision:text,id:uuid,linked_domain:text,linked_record_id:uuid,match_basis:text,review_note:text,reviewed_by:uuid,tenant_id:uuid,updated_at:timestamp with time zone' then
      raise exception 'Unknown identity review schema: dependency review required';
    end if;
    select string_agg(a.attname || ':' || pg_catalog.format_type(a.atttypid,a.atttypmod), ',' order by a.attname)
      into v_shape from pg_catalog.pg_attribute a
      where a.attrelid='public.crm_identity_review_events'::regclass and a.attnum>0 and not a.attisdropped;
    if v_shape <> 'actor_id:uuid,changed_at:timestamp with time zone,id:uuid,next_decision:text,previous_decision:text,review_id:uuid,tenant_id:uuid' then
      raise exception 'Unknown identity event schema: dependency review required';
    end if;
    if exists(select 1 from public.crm_identity_review_events e
      left join public.crm_identity_reviews r on r.id=e.review_id and r.tenant_id=e.tenant_id
      where r.id is null) then
      raise exception 'Legacy event tenant mismatch requires reconciliation review';
    end if;
  end if;
end;
$preflight$;

create table if not exists public.crm_identity_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  contact_id uuid not null,
  linked_domain text not null check (linked_domain in
    ('relationship_contact','bty_opportunity','provider_applicant','therapist_prospect','client')),
  linked_record_id uuid not null,
  decision text not null check (decision in ('linked','rejected')),
  match_basis text not null check (match_basis in ('email','phone','manual','name_and_email')),
  review_note text check (review_note is null or length(review_note)<=2000),
  reviewed_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,contact_id,linked_domain,linked_record_id)
);
-- Soft source references preserve audit history without obstructing source lifecycle.
alter table public.crm_identity_reviews drop constraint if exists crm_identity_reviews_contact_id_fkey;
alter table public.crm_identity_reviews add constraint crm_identity_reviews_tenant_id_id_key unique (tenant_id,id);
create index if not exists crm_identity_reviews_contact_idx on public.crm_identity_reviews(tenant_id,contact_id);
create index if not exists crm_identity_reviews_target_idx on public.crm_identity_reviews(tenant_id,linked_domain,linked_record_id);

create table if not exists public.crm_identity_review_events (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  previous_decision text,
  next_decision text not null,
  actor_id uuid not null,
  changed_at timestamptz not null default now()
);
alter table public.crm_identity_review_events drop constraint if exists crm_identity_review_events_review_id_fkey;
alter table public.crm_identity_review_events
  add constraint crm_identity_events_tenant_review_fkey foreign key (tenant_id,review_id)
    references public.crm_identity_reviews(tenant_id,id) on delete restrict,
  add column previous_match_basis text,
  add column next_match_basis text,
  add column previous_review_note text,
  add column next_review_note text;
-- Old audit events keep NULL evidence snapshots: do not invent historical evidence.
create index if not exists crm_identity_events_review_idx on public.crm_identity_review_events(review_id,changed_at desc);
create index crm_identity_events_tenant_time_idx on public.crm_identity_review_events(tenant_id,changed_at desc,id);

create or replace function private.crm_identity_source_access(
  p_tenant uuid, p_contact uuid, p_domain text, p_target uuid, p_mode text
) returns boolean language plpgsql stable security definer set search_path=''
as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or p_mode is null or p_mode not in ('read','write')
    or p_domain is null or p_domain not in
      ('relationship_contact','bty_opportunity','provider_applicant','therapist_prospect','client') then
    return false;
  end if;
  if not private.crm_has_relationship_permission(v_uid,p_tenant,'view_relationships') then return false; end if;
  if p_mode='write' and not private.crm_has_relationship_permission(v_uid,p_tenant,'edit_relationships') then return false; end if;
  if p_domain in ('provider_applicant','therapist_prospect','client')
    and not private.crm_has_relationship_permission(v_uid,p_tenant,'view_sensitive_evidence') then return false; end if;
  if p_domain='client' and not public.crm_has_role(v_uid,array['admin']::text[],p_tenant) then return false; end if;
  -- Match the relationship repository's derived person/role-inbox distinction.
  if not exists(select 1 from public.relationship_contacts c where c.id=p_contact and c.tenant_id=p_tenant
    and (coalesce(c.preferred_name,'')<>'' or coalesce(c.first_name,'')<>'' or coalesce(c.last_name,'')<>'')) then return false; end if;
  case p_domain
    when 'relationship_contact' then
      return p_contact<>p_target and exists(select 1 from public.relationship_contacts c
        where c.id=p_target and c.tenant_id=p_tenant
        and (coalesce(c.preferred_name,'')<>'' or coalesce(c.first_name,'')<>'' or coalesce(c.last_name,'')<>''));
    when 'bty_opportunity' then
      return exists(select 1 from public.relationship_opportunities o
        where o.id=p_target and o.tenant_id=p_tenant and o.primary_contact_id=p_contact);
    when 'provider_applicant' then
      return exists(select 1 from public.provider_applicants a where a.id=p_target and a.tenant_id=p_tenant);
    when 'therapist_prospect' then
      return exists(select 1 from public.therapist_outreach_prospects p where p.id=p_target and p.tenant_id=p_tenant);
    when 'client' then
      return exists(select 1 from public.clients c where c.id=p_target and c.tenant_id=p_tenant);
    else return false;
  end case;
end;
$fn$;
revoke all on function private.crm_identity_source_access(uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.crm_identity_source_access(uuid,uuid,text,uuid,text) to authenticated;

create or replace function private.crm_identity_review_validate()
returns trigger language plpgsql security definer set search_path=''
as $fn$
declare v_temp uuid;
begin
  if auth.uid() is null or new.reviewed_by is distinct from auth.uid() then
    raise exception 'Identity review is not authorized' using errcode='42501';
  end if;
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
    or new.contact_id is distinct from old.contact_id or new.linked_domain is distinct from old.linked_domain
    or new.linked_record_id is distinct from old.linked_record_id or new.created_at is distinct from old.created_at) then
    raise exception 'Identity link identity is immutable' using errcode='23514';
  end if;
  if tg_op='INSERT' and new.linked_domain='relationship_contact' and new.contact_id>new.linked_record_id then
    v_temp:=new.contact_id; new.contact_id:=new.linked_record_id; new.linked_record_id:=v_temp;
  end if;
  if not private.crm_identity_source_access(new.tenant_id,new.contact_id,new.linked_domain,new.linked_record_id,'write') then
    raise exception 'Identity source is not authorized or unavailable' using errcode='42501';
  end if;
  new.review_note:=nullif(btrim(new.review_note),'');
  if tg_op='INSERT' then
    new.created_at:=now(); new.updated_at:=now();
  elsif row(new.decision,new.match_basis,new.review_note,new.reviewed_by)
    is distinct from row(old.decision,old.match_basis,old.review_note,old.reviewed_by) then
    new.updated_at:=now();
  else new.updated_at:=old.updated_at;
  end if;
  return new;
end;
$fn$;
revoke all on function private.crm_identity_review_validate() from public,anon,authenticated,service_role;
drop trigger if exists crm_identity_review_validate on public.crm_identity_reviews;
create trigger crm_identity_review_validate before insert or update on public.crm_identity_reviews
  for each row execute function private.crm_identity_review_validate();

create or replace function private.crm_identity_review_audit()
returns trigger language plpgsql security definer set search_path=''
as $fn$
begin
  if tg_op='UPDATE' and row(new.decision,new.match_basis,new.review_note,new.reviewed_by)
    is not distinct from row(old.decision,old.match_basis,old.review_note,old.reviewed_by) then return null; end if;
  insert into public.crm_identity_review_events(review_id,tenant_id,previous_decision,next_decision,actor_id,
    previous_match_basis,next_match_basis,previous_review_note,next_review_note)
  values(new.id,new.tenant_id,case when tg_op='UPDATE' then old.decision end,new.decision,new.reviewed_by,
    case when tg_op='UPDATE' then old.match_basis end,new.match_basis,
    case when tg_op='UPDATE' then old.review_note end,new.review_note);
  return null;
end;
$fn$;
revoke all on function private.crm_identity_review_audit() from public,anon,authenticated,service_role;
drop trigger if exists crm_identity_review_audit on public.crm_identity_reviews;
create trigger crm_identity_review_audit after insert or update on public.crm_identity_reviews
  for each row execute function private.crm_identity_review_audit();

alter table public.crm_identity_reviews enable row level security;
alter table public.crm_identity_review_events enable row level security;
-- Reject unknown policies rather than silently keeping a permissive extra policy.
do $policies$
begin
  if exists(select 1 from pg_catalog.pg_policies p where p.schemaname='public'
    and ((p.tablename='crm_identity_reviews' and p.policyname not in
      ('crm_identity_reviews_read','crm_identity_reviews_insert','crm_identity_reviews_update'))
    or (p.tablename='crm_identity_review_events' and p.policyname<>'crm_identity_events_read'))) then
    raise exception 'Unknown identity policies: dependency review required';
  end if;
end;
$policies$;
drop policy if exists crm_identity_reviews_read on public.crm_identity_reviews;
drop policy if exists crm_identity_reviews_insert on public.crm_identity_reviews;
drop policy if exists crm_identity_reviews_update on public.crm_identity_reviews;
drop policy if exists crm_identity_events_read on public.crm_identity_review_events;
revoke all on public.crm_identity_reviews,public.crm_identity_review_events from public,anon,authenticated,service_role;
grant select,insert,update on public.crm_identity_reviews to authenticated;
grant select on public.crm_identity_review_events to authenticated;
grant select on public.crm_identity_reviews,public.crm_identity_review_events to service_role;
create policy crm_identity_reviews_read on public.crm_identity_reviews for select to authenticated using (
  private.crm_identity_source_access(tenant_id,contact_id,linked_domain,linked_record_id,'read'));
create policy crm_identity_reviews_insert on public.crm_identity_reviews for insert to authenticated with check (
  reviewed_by=(select auth.uid()) and private.crm_identity_source_access(tenant_id,contact_id,linked_domain,linked_record_id,'write'));
create policy crm_identity_reviews_update on public.crm_identity_reviews for update to authenticated using (
  private.crm_identity_source_access(tenant_id,contact_id,linked_domain,linked_record_id,'write')) with check (
  reviewed_by=(select auth.uid()) and private.crm_identity_source_access(tenant_id,contact_id,linked_domain,linked_record_id,'write'));
create policy crm_identity_events_read on public.crm_identity_review_events for select to authenticated using (
  exists(select 1 from public.crm_identity_reviews r
    where r.id=crm_identity_review_events.review_id and r.tenant_id=crm_identity_review_events.tenant_id));

-- Preserve an empty historical artifact without keeping an attribution API.
do $legacy$
begin
  if to_regclass('public.crm_therapist_prospect_attributions') is not null then
    revoke all on public.crm_therapist_prospect_attributions from public,anon,authenticated,service_role;
    drop policy if exists crm_prospect_attributions_admin_read on public.crm_therapist_prospect_attributions;
    drop policy if exists crm_prospect_attributions_admin_insert on public.crm_therapist_prospect_attributions;
  end if;
end;
$legacy$;
notify pgrst,'reload schema';
commit;
