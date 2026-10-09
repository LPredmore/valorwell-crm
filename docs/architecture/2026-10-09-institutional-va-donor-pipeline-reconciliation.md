# ValorWell CRM — Research reconciliation and donor enrichment
Date: October 9, 2026

## Source of truth and deployment

PR #108 https://github.com/LPredmore/valorwell-crm/pull/108 squash merged to `main` SHA `d018c0b77a47891e6d913a30efeb00d0abb3c2e1`. Dedicated CI run `37924881326` passed lint, TypeScript, all 8 domain pipeline tests including embedded PostgreSQL source/tenant/primary scenarios, and production build. Existing broader global CI has unrelated legacy failures and is not claimed fully green.

Applied Supabase Billing Hub project `ahqauomkgflopxgnlndd` migration `crm_research_pipeline_reconciliation_20261009` sourced from `supabase/migrations/20261009114500_crm_research_pipeline_reconciliation.sql`. Read-only verification: `crm_pipeline_source_bindings` RLS enabled and 3 bindings present: Donors→`donor_giving`, Institutional Recruiting→`institutional_recruiting`, VA Medical Centers→`va_facilities`; `public.crm_enroll_research_source(uuid,uuid,uuid)` and `public.crm_create_research_organization(uuid,uuid,text,text,boolean)` exist, granted execute to authenticated and denied to anon (checked enroll). Added nullable composite-tenant FK `crm_va_vaccn_referral_contacts.relationship_organization_id`; original Institutional Recruiting already had `relationship_organization_id`. Security advisors found no new findings specific to these objects; existing unrelated security findings remain.

## What is now functional in CRM → Pipelines

- The three workflows are configured in the same generic pipeline engine and now have configurable source bindings, not hardcoded pipeline names in the app.
- Institutional Recruiting and VA Medical Centers include searchable source-research review inboxes. The inbox lists original source organization and candidate named contact; the candidate is **not** automatically declared the organization primary.
- Operators can select an existing canonical CRM organization with exactly one global primary and atomically link the research source to it and enroll the organization at the first stage (repeat-safe; multiple VA contacts for one regional facility share one pipeline organization card).
- Or operators explicitly confirm a real person's name/email to create a new organization and assign that **ONE GLOBAL PRIMARY** and enroll it transactionally. Email/name collisions and preexisting organizations are blocked for manual reconciliation rather than overwritten. Regional VA confirmation is required before creating a distinct VA facility; subordinate clinic contacts should link to their main parent facility. No email is sent during linking.
- Donors stays a **Personal** manual relationship pipeline with optional associated organization. Its cards now read donor category (prospective/one-time/recurring/lapsed), lifetime amount and last gift from `crm_donors` when the authoritative donor has an explicit `relationship_contact_id`. These fields refresh from the source; relationship stages are not replaced. Temporary newsletter-E2E donors are excluded, and unlinked donor records are not guessed by email/name.

## Live data inventory and honest incompleteness

At deployment: 80 state-by-state Institutional Recruiting targets, **0 linked**; 82 VA referral contact records, **0 linked**; 0 manually enrolled pipeline records. One `crm_donors` row is a zero-gift **temporary newsletter E2E** record and is **not** a real giving record. There are no verified real donor gift transactions to test; donation ingestion/real recurring updates in the source system are not expanded by this PR. Clinician applicants=35, staff=20, clients=683, BTY opportunities=188, no source status rewrites. **Do not claim 162 organizations enrolled or donor-gift sync end-to-end tested.**

Needed next:
1. Authenticated browser acceptance/published frontend deployment confirmation for CRM→Pipelines; actual role-specific RLS behavior with signed real JWTs.
2. Manually review/canonicalize 80 Institutional and 82 VA records. Some VA contacts are named departmental inboxes, not humans. Choose the actual best-relationship contact and parent facility before linking. **After PR #109, an organization with exactly one linked contact assigns that contact Primary automatically.** Bob Woodruff Foundation still has duplicate primaries requiring review. Craig Newmark Philanthropies now has its sole contact set Primary, but the contact's email domain belongs to Bob Woodruff Foundation—verify that relationship association before relying on it.
3. True donor payment ingestion/recurring-event sync and matching approved donor identities into `crm_donors`, with no name-only merges; donor prospect workflow still manual.
4. Future stage movement and history, drag-drop Kanban, saved views, facility hierarchy modeling and auto-refresh of research metadata on linked cards.
