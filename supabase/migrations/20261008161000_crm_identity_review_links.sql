-- Tasks 11–14: review-first, tenant-scoped identity *links*. No migrations of
-- source rows and no PHI copied to general CRM. Deploy only after staging
-- signed-JWT/RLS verification; two-tenant test remains a release gate.
-- Existing crm_people / crm_person_identities / crm_person_records remain unused
-- until their broader tenant-member SELECT policies receive separate review.

create table if not exists public.crm_therapist_prospect_attributions (
  prospect_id uuid primary key references public.therapist_outreach_prospects(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  attested_by uuid not null,
  reason text not null check (length(btrim(reason)) between 8 and 2000),
  attested_at timestamptz not null default now()
);
alter table public.crm_therapist_prospect_attributions enable row level security;
revoke all on public.crm_therapist_prospect_attributions from public, anon, authenticated;
grant select, insert on public.crm_therapist_prospect_attributions to authenticated;
grant all on public.crm_therapist_prospect_attributions to service_role;
create policy crm_prospect_attributions_admin_read on public.crm_therapist_prospect_attributions
  for select to authenticated using (
    private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'view_sensitive_evidence')
  );
create policy crm_prospect_attributions_admin_insert on public.crm_therapist_prospect_attributions
  for insert to authenticated with check (
    attested_by = (select auth.uid())
    and private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'view_sensitive_evidence')
  );

create table if not exists public.crm_identity_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  contact_id uuid not null references public.relationship_contacts(id) on delete restrict,
  linked_domain text not null check (
    linked_domain in ('relationship_contact', 'bty_opportunity', 'provider_applicant', 'therapist_prospect', 'client')
  ),
  linked_record_id uuid not null,
  decision text not null check (decision in ('linked', 'rejected')),
  match_basis text not null check (match_basis in ('email', 'phone', 'manual', 'name_and_email')),
  review_note text check (review_note is null or length(review_note) <= 2000),
  reviewed_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, contact_id, linked_domain, linked_record_id)
);
create index if not exists crm_identity_reviews_contact_idx on public.crm_identity_reviews(tenant_id, contact_id);
create index if not exists crm_identity_reviews_target_idx on public.crm_identity_reviews(tenant_id, linked_domain, linked_record_id);
alter table public.crm_identity_reviews enable row level security;
revoke all on public.crm_identity_reviews from public, anon, authenticated;
grant select, insert, update on public.crm_identity_reviews to authenticated;
grant all on public.crm_identity_reviews to service_role;

create policy crm_identity_reviews_read on public.crm_identity_reviews
  for select to authenticated using (
    private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'view_relationships')
    and (
      linked_domain in ('relationship_contact', 'bty_opportunity')
      or (
        private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'view_sensitive_evidence')
        and (linked_domain <> 'client' or public.crm_has_role((select auth.uid()), array['admin']::text[], tenant_id))
      )
    )
  );
create policy crm_identity_reviews_insert on public.crm_identity_reviews
  for insert to authenticated with check (
    reviewed_by = (select auth.uid())
    and private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships')
    and (
      linked_domain in ('relationship_contact', 'bty_opportunity')
      or (
        private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'view_sensitive_evidence')
        and (linked_domain <> 'client' or public.crm_has_role((select auth.uid()), array['admin']::text[], tenant_id))
      )
    )
  );
create policy crm_identity_reviews_update on public.crm_identity_reviews
  for update to authenticated
  using (
    private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships')
    and (
      linked_domain in ('relationship_contact', 'bty_opportunity')
      or (
        private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'view_sensitive_evidence')
        and (linked_domain <> 'client' or public.crm_has_role((select auth.uid()), array['admin']::text[], tenant_id))
      )
    )
  )
  with check (
    reviewed_by = (select auth.uid())
    and private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'edit_relationships')
    and (
      linked_domain in ('relationship_contact', 'bty_opportunity')
      or (
        private.crm_has_relationship_permission((select auth.uid()), tenant_id, 'view_sensitive_evidence')
        and (linked_domain <> 'client' or public.crm_has_role((select auth.uid()), array['admin']::text[], tenant_id))
      )
    )
  );

create table if not exists public.crm_identity_review_events (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.crm_identity_reviews(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  previous_decision text,
  next_decision text not null,
  actor_id uuid not null,
  changed_at timestamptz not null default now()
);
create index if not exists crm_identity_events_review_idx on public.crm_identity_review_events(review_id, changed_at desc);
alter table public.crm_identity_review_events enable row level security;
revoke all on public.crm_identity_review_events from public, anon, authenticated;
grant select on public.crm_identity_review_events to authenticated;
grant all on public.crm_identity_review_events to service_role;
create policy crm_identity_events_read on public.crm_identity_review_events
  for select to authenticated using (
    exists (
      select 1 from public.crm_identity_reviews r
      where r.id = review_id and r.tenant_id = tenant_id
    )
  );

create or replace function private.crm_identity_review_validate()
returns trigger
language plpgsql security definer set search_path = ''
as $fn$
declare
  source_valid boolean := false;
  temp_id uuid;
begin
  -- Require a logged-in CRM actor, even for privileged call paths.
  if (select auth.uid()) is null or new.reviewed_by is distinct from (select auth.uid()) then
    raise exception 'Identity review is not authorized' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
      new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
      or new.contact_id is distinct from old.contact_id
      or new.linked_domain is distinct from old.linked_domain
      or new.linked_record_id is distinct from old.linked_record_id
      or new.created_at is distinct from old.created_at
    ) then
    raise exception 'Identity link identity is immutable' using errcode = '23514';
  end if;
  -- Canonical direction ensures a symmetric contact pair has one row.
  if tg_op = 'INSERT' and new.linked_domain = 'relationship_contact' then
    if new.contact_id::text > new.linked_record_id::text then
      temp_id := new.contact_id;
      new.contact_id := new.linked_record_id;
      new.linked_record_id := temp_id;
    end if;
  end if;
  if not exists (
    select 1 from public.relationship_contacts c
    where c.id = new.contact_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'Identity review source is not authorized or unavailable' using errcode = '42501';
  end if;
  if new.linked_domain = 'relationship_contact' then
    select exists(select 1 from public.relationship_contacts c
      where c.id = new.linked_record_id and c.tenant_id = new.tenant_id and c.id <> new.contact_id)
      into source_valid;
  elsif new.linked_domain = 'bty_opportunity' then
    select exists(select 1 from public.relationship_opportunities o
      where o.id = new.linked_record_id and o.tenant_id = new.tenant_id
        and o.primary_contact_id = new.contact_id)
      into source_valid;
  elsif new.linked_domain = 'provider_applicant' then
    select exists(select 1 from public.provider_applicants a
      where a.id = new.linked_record_id and a.tenant_id = new.tenant_id)
      into source_valid;
  elsif new.linked_domain = 'client' then
    select exists(select 1 from public.clients c
      where c.id = new.linked_record_id and c.tenant_id = new.tenant_id)
      into source_valid;
  elsif new.linked_domain = 'therapist_prospect' then
    select exists(select 1 from public.crm_therapist_prospect_attributions a
      where a.prospect_id = new.linked_record_id and a.tenant_id = new.tenant_id)
      into source_valid;
  end if;
  if not source_valid then
    raise exception 'Identity review target is not authorized or unavailable' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;
revoke all on function private.crm_identity_review_validate() from public, anon, authenticated;
create trigger crm_identity_review_validate
  before insert or update on public.crm_identity_reviews
  for each row execute function private.crm_identity_review_validate();

create or replace function private.crm_identity_review_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $fn$
begin
  insert into public.crm_identity_review_events (
    review_id, tenant_id, previous_decision, next_decision, actor_id
  ) values (
    new.id, new.tenant_id,
    case when tg_op = 'UPDATE' then old.decision else null end,
    new.decision, new.reviewed_by
  );
  return null;
end;
$fn$;
revoke all on function private.crm_identity_review_audit() from public, anon, authenticated;
create trigger crm_identity_review_audit
  after insert or update on public.crm_identity_reviews
  for each row execute function private.crm_identity_review_audit();

-- A single authenticated reviewer can never issue a DELETE; correction is a
-- reviewed decision change and remains in append-only crm_identity_review_events.
-- Clinical data is neither denormalized nor selected into the CRM identity tables.
