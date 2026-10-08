# CRM modernization Tasks 11–14 — decision, implementation and rollout gates

**Date:** 2026-10-08  
**Existing project:** `LPredmore/valorwell-crm`; Supabase Billing Hub `ahqauomkgflopxgnlndd`.  
**Branch:** `feat/crm-identity-phases-11-14`, stacked on navigation PR #101.  
**Status:** Code and additive SQL migration proposed, **NOT deployed**. No actual CRM person backfill or unreviewed identity merge has occurred.

## Task 11 — architecture decision (ADR)
**Decision: source-of-truth records remain independent, with a reviewed link overlay.** Existing `public.crm_people`, `crm_person_identities`, and `crm_person_records` are **all empty** (validated live October 8). Their existing SELECT policies authorize any `is_tenant_member`, including tenant members without CRM capability. The `crm_person_identities` schema also enforces a **unique (tenant_id, identity_kind, identity_value)** constraint, making it unsuitable as an authoritative email identity resolver when unrelated humans share an email or phone. Therefore **do not populate or expose these tables now**. The new `crm_identity_reviews` is an explicitly reviewed reference overlay, not another canonical source table. Future Phase 12+ clinical identity design can tighten underlying `crm_people` RLS and backfill after separate approval and the deferred two-tenant JWT test.

Canonical display facts stay in `relationship_contacts`, `relationship_organizations`, and `relationship_contact_organizations`; BTY stages stay in `relationship_opportunities`, applicant lifecycle in `provider_applicants`, therapist prospect eligibility in `therapist_outreach_prospects`, and protected care in `clients`. A source identifier does not convey authorization to retrieve source data.

**Conservative matching:**
- Lowercase/trim email for exact comparison only; do NOT strip plus-alias suffixes or Gmail dots.
- Match US telephone numbers only if an unambiguous 10-digit domestic number or +1 11-digit equivalent; do not infer international dialing plans or strip extensions into false identity equivalences.
- Name alone is never enough; exact name with email is a stronger *candidate* only.
- Same email for different names, same home phone, absent names, and role inboxes are not automatic merges. Suspected matches are shown for manual review, with explicit **Confirm link** / **Not the same person** decisions.
- Match candidate collection uses tenant-filtered relationship repository with at most 100 matching rows per search. A match not surfaced by the limited search is **not** evidence of absence.
- Cross-tenant IDs never yield links; all writes have server-side tenant checks.

## Task 12 — review workflow, invariants, audit
`src/domain/identity/review.ts` provides deterministic matching, candidate classifications and safe URL mapping. `src/repositories/identity-reviews.ts` obtains the authoritative operating tenant from `get_crm_operating_context`, does not use an untrusted tenant passed by the caller, queries only relationship contact candidate data, and persists reviewed decisions when the SQL rollout has been validated.

SQL migration `supabase/migrations/20261008161000_crm_identity_review_links.sql` adds **three additive tables**:
1. `crm_identity_reviews`: explicit relationship_contact anchor, domain/source UUID, link/reject decision, match basis, reviewer, optional evidence (no PHI), unique tenant/contact/domain/record identity. A trigger canonicalizes contact-pair order, guards source existence and tenant, prevents changing the anchored IDs, and validates source-domain ownership. Row-level policies gate by existing CRM capability helper. Admin-only visibility for applicant/prospect and admin + clinical-admin role for client links.
2. `crm_identity_review_events`: append-only server-triggered change ledger recording old and new decisions, reviewer and time. Browser users have SELECT only, and only when the parent review is visible. No direct write/delete grants.
3. `crm_therapist_prospect_attributions`: **explicit immutable verified tenant assignment** for legacy prospect IDs that currently lack tenant_id. No bulk inference, no automatic attribution; admin-only insert/read with reviewed attribution reason. Each prospect can be assigned to at most one tenant until a separately audited correction path is designed.

**Migrations only; no data migration/backfill.** Never update source contact/client/applicant rows, rewrite primary keys, move bookings, or alter message linkage. Existing contact organization affiliation identity remains `tenant_id + contact_id + organization_id` (actual DB primary key is contact_id + organization_id with a separate tenant column; tenant-validation work needs continued attention).

**Rollback:** Before real usage, revert proposed schema migration / drop the new empty tables in reverse dependency order; after use, preserve audit data and use an explicit archival procedure rather than destructive rollback. Frontend features can be reverted via PR. User-approved 2-tenant, real signed JWT tests remain postponed until application/database integration and are a release gate before production link writes.

## Task 13 — existing contact and organization workspaces
- `ContactDetailPage` integrates **ContactProfileEditor** using existing `dataProvider.relationships.updateContact` (authorized server/RLS), preserving affiliations, outreach state, metadata and linked opportunity records. Edits to name/preferred name/email/phone/state/DNC respect `capabilities.mutate`.
- `OrganizationDetailPage` integrates **OrganizationAffiliationEditor**: search existing tenant contacts, select matching person, optional role title and primary organization, then `createAffiliation` using existing repository. The existing relationship table and all records remain authoritative. No invented affiliation UUIDs or new association tables. Existing org editor and opportunity panels remain.
- Contact directory and organization directory retain existing URL filters, pagination, search, relationship lifecycles, import status and data-provider error handling. Improved total views/advanced filters remain future Phase 17.

## Task 14 — explicit cross-domain record references
Manual source link review supports:
- `relationship_contact` ↔ same-tenant relationship contact: confirmed/not-same-person, symmetric canonical pair.
- `bty_opportunity`: source opportunity must be in same tenant **and its primary_contact_id must equal the anchor contact**. BTY opportunity stages/booking stay in source.
- `provider_applicant`: admin-reviewed link to same-tenant applicant UUID; no applicant data copied to contact or shown through link.
- `therapist_prospect`: admin must first verify immutable tenant attribution; no guess based on CSV name/email.
- `client`: only CRM admin **and** clinically authorized role may review/see a link, with same-tenant client UUID. The source link goes to the existing protected `/crm/clients/:id`, where clinical RLS still decides actual access. **No diagnosis, appointments, assessments, therapy notes, risk flags or clinical free text are copied into general CRM.**

A contact may have multiple source roles concurrently (prospect, guest, applicant, client as independently authorized). Read-only users can see only records their policies allow and cannot change review decisions. Missing migration shows an explicit unavailable status rather than claiming a save succeeded.

## Test and deployment gate
- Read-only live audit verified identity registries empty; 442 existing contacts, 358 organizations, 188 BTY opportunities, 35 provider applicants, 1,279 therapist prospects lacking tenant_id, 1 tenant. No PII was exported.
- New unit tests cover name-only rejection, tenant isolation, role inbox exclusion, shared email ambiguity, name+email evidence, US phone normalization, plus-alias non-collapse, canonical pair ordering and source link URL restrictions.
- Automated CI must pass changed-source ESLint, application TypeScript, tests and build. SQL migration has **NOT** had a database-only staging execution because the user declined an additional paid Supabase branch. This limitation is explicitly **not** a pass.
- To accept rollout: apply the reviewed SQL migration in an approved environment, check security advisor and schema grants, run seeded two-tenant signed-JWT CRUD/negative source link tests, run client/recruiter least-privilege checks, test trigger audit before/after reversals and idempotent decisions, reconcile source row counts, perform logged-in contact/org workflow smoke test. Do NOT mark live linking complete until those gates pass.
- Tasks 7–10 PR #101 is prerequisite for visual unified sidebar, but this PR does not replace or modify that prior navigation work.
