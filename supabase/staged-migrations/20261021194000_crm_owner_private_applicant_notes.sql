-- STAGED SOURCE ONLY. NOT APPLIED. Requires five-app review, isolated signed-JWT
-- acceptance and explicit human release approval before being moved into
-- supabase/migrations. Additive and forward-only: does not touch
-- provider_applicants, crm_notes, website_submissions or any activity table.
-- @no-data-api private.crm_owner_note_allowlist
-- @no-data-api private.crm_owner_applicant_notes
-- @no-data-api private.crm_owner_applicant_note_audit

create table private.crm_owner_note_allowlist (
  tenant_id uuid not null references public.tenants(id),
  profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, profile_id)
);
alter table private.crm_owner_note_allowlist enable row level security;
revoke all on table private.crm_owner_note_allowlist from public, anon, authenticated, service_role;

-- Exactly one approved identity. Not derived from tenant_role or crm_admin.
insert into private.crm_owner_note_allowlist (tenant_id, profile_id)
values ('00000000-0000-0000-0000-000000000001', 'd2dc0624-1e71-49d6-8b04-76cf1e822074');

create table private.crm_owner_applicant_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  website_submission_id uuid not null references public.website_submissions(id),
  author_profile_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 20000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, website_submission_id)
);
alter table private.crm_owner_applicant_notes enable row level security;
revoke all on table private.crm_owner_applicant_notes from public, anon, authenticated, service_role;
-- RLS enabled with zero policies: every direct read/write is rejected.

create table private.crm_owner_applicant_note_audit (
  id bigint generated always as identity primary key,
  note_id uuid not null,
  actor_profile_id uuid not null,
  action text not null check (action in ('upsert','delete')),
  occurred_at timestamptz not null default now()
);
alter table private.crm_owner_applicant_note_audit enable row level security;
revoke all on table private.crm_owner_applicant_note_audit from public, anon, authenticated, service_role;

-- Internal gate: auth.uid() must equal the allowlisted profile in the same
-- tenant, and the submission must belong to that tenant.
create function private.crm_owner_note_authorized(p_tenant uuid, p_submission uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (select 1 from private.crm_owner_note_allowlist a
                where a.tenant_id = p_tenant and a.profile_id = auth.uid())
    and exists (select 1 from public.tenant_memberships m
                where m.tenant_id = p_tenant and m.profile_id = auth.uid())
    and exists (select 1 from public.website_submissions s
                where s.id = p_submission and s.tenant_id = p_tenant);
$$;
revoke all on function private.crm_owner_note_authorized(uuid, uuid) from public, anon, authenticated, service_role;

-- Non-authorized callers get an empty set: identical to "no note".
create function public.crm_owner_note_get(p_tenant uuid, p_submission uuid)
returns table (id uuid, body text, version integer, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select n.id, n.body, n.version, n.updated_at
    from private.crm_owner_applicant_notes n
   where private.crm_owner_note_authorized(p_tenant, p_submission)
     and n.tenant_id = p_tenant and n.website_submission_id = p_submission;
$$;

create function public.crm_owner_note_upsert(p_tenant uuid, p_submission uuid, p_body text, p_expected_version integer)
returns table (id uuid, version integer)
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_version integer;
begin
  if not private.crm_owner_note_authorized(p_tenant, p_submission) then
    raise exception 'not available' using errcode = '42501';
  end if;
  if p_expected_version is null then
    insert into private.crm_owner_applicant_notes (tenant_id, website_submission_id, author_profile_id, body)
    values (p_tenant, p_submission, auth.uid(), p_body)
    returning crm_owner_applicant_notes.id, crm_owner_applicant_notes.version into v_id, v_version;
  else
    update private.crm_owner_applicant_notes n
       set body = p_body, version = n.version + 1, updated_at = now()
     where n.tenant_id = p_tenant and n.website_submission_id = p_submission
       and n.version = p_expected_version
    returning n.id, n.version into v_id, v_version;
    if v_id is null then raise exception 'version conflict' using errcode = '40001'; end if;
  end if;
  insert into private.crm_owner_applicant_note_audit (note_id, actor_profile_id, action)
  values (v_id, auth.uid(), 'upsert');
  return query select v_id, v_version;
end $$;

create function public.crm_owner_note_delete(p_tenant uuid, p_submission uuid, p_expected_version integer)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.crm_owner_note_authorized(p_tenant, p_submission) then
    raise exception 'not available' using errcode = '42501';
  end if;
  delete from private.crm_owner_applicant_notes n
   where n.tenant_id = p_tenant and n.website_submission_id = p_submission
     and n.version = p_expected_version
  returning n.id into v_id;
  if v_id is null then raise exception 'version conflict' using errcode = '40001'; end if;
  insert into private.crm_owner_applicant_note_audit (note_id, actor_profile_id, action)
  values (v_id, auth.uid(), 'delete');
end $$;

revoke all on function public.crm_owner_note_get(uuid, uuid) from public, anon, service_role;
revoke all on function public.crm_owner_note_upsert(uuid, uuid, text, integer) from public, anon, service_role;
revoke all on function public.crm_owner_note_delete(uuid, uuid, integer) from public, anon, service_role;
grant execute on function public.crm_owner_note_get(uuid, uuid) to authenticated;
grant execute on function public.crm_owner_note_upsert(uuid, uuid, text, integer) to authenticated;
grant execute on function public.crm_owner_note_delete(uuid, uuid, integer) to authenticated;
