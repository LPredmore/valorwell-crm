alter table public.relationship_organizations
  add column if not exists search_document tsvector
  generated always as (
    setweight(to_tsvector('simple'::regconfig, coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(website, '')), 'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(organization_kind, '')), 'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(outreach_status, '') || ' ' || coalesce(relationship_stage, '')), 'C')
  ) stored;

alter table public.relationship_contacts
  add column if not exists search_document tsvector
  generated always as (
    setweight(to_tsvector('simple'::regconfig,
      coalesce(preferred_name, '') || ' ' || coalesce(first_name, '') || ' ' || coalesce(last_name, '')
    ), 'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(email, '') || ' ' || coalesce(phone, '')), 'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(state, '') || ' ' || coalesce(veteran_affiliation, '')), 'C') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(outreach_status, '') || ' ' || coalesce(relationship_stage, '')), 'D')
  ) stored;

alter table public.relationship_opportunities
  add column if not exists search_document tsvector
  generated always as (
    setweight(to_tsvector('simple'::regconfig, coalesce(cause_area, '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(status, '') || ' ' || coalesce(review_status, '')), 'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(next_action, '')), 'C')
  ) stored;

alter table public.relationship_campaigns
  add column if not exists search_document tsvector
  generated always as (
    setweight(to_tsvector('simple'::regconfig, coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(purpose, '') || ' ' || coalesce(initiative, '')), 'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(sender_name, '') || ' ' || coalesce(sender_email, '')), 'C') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(status, '') || ' ' || coalesce(marketing_lifecycle_stage, '')), 'D')
  ) stored;

create index if not exists relationship_organizations_search_document_gin
  on public.relationship_organizations using gin (search_document);
create index if not exists relationship_contacts_search_document_gin
  on public.relationship_contacts using gin (search_document);
create index if not exists relationship_opportunities_search_document_gin
  on public.relationship_opportunities using gin (search_document);
create index if not exists relationship_campaigns_search_document_gin
  on public.relationship_campaigns using gin (search_document);
