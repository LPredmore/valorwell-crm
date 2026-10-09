# ValorWell — Seven pipeline configurations deployed
Date: 2026-10-09

## Confirmed source and deployment

- Repository: `LPredmore/valorwell-crm`; configuration and adapters PR #106, squash merge `0daa043d316acb3cd7ab97254be3472ffddf5333` to `main`.
- Applicant workspace source-navigation fix PR #107, merge `421d0c87379cbbfccaf2bbe44f365449d35af592`.
- Billing Hub Supabase project `ahqauomkgflopxgnlndd`.
- Applied migrations successfully:
  - `seed_valorwell_pipeline_configuration_20261009` = `supabase/migrations/20261009062000_seed_valorwell_pipeline_configuration.sql`
  - `crm_personal_pipeline_optional_organization_20261009` = `supabase/migrations/20261009062500_crm_personal_pipeline_optional_organization.sql`
- Direct live read-only validation: **7** `crm_pipelines`, **49** stages, **20** field definitions, **0** manual `crm_pipeline_records`. No provider/client/BTY source status storage changed, no invitation sent, no source records invented.
- Focused CI run `37921245862` passed ESLint, TypeScript, PostgreSQL config/idempotence tests, and production build. Navigation source-link PR #107 focused CI run `37921603938` also passed. General Application CI and Validate still fail on pre-existing unrelated checks (retired backend URL and legacy lint error). Production frontend deployment and a logged-in real-user browser test **have not been confirmed**.

## Configured pipelines

| Pipeline | Type | Mode | Stages | Custom fields |
|--|--|--|--:|--:|
| Prospective Clinicians | Personal | connected provider_applicants | 6 | 3 |
| Hired Clinicians | Personal | connected staff | 4 | 2 |
| Clients | Personal | connected clients | 8 | 1 |
| Donors | Personal | manual | 8 | 4 |
| Beyond The Yellow | Organization | connected relationship_opportunities | 13 | 2 |
| Institutional Recruiting | Organization | manual | 4 | 4 |
| VA Medical Centers | Organization | manual | 6 | 4 |

All seven use the generic data-backed pipeline configuration table; none has a special hardcoded view/definition. Users can still create unlimited further manual pipelines and configure own stages/fields/card/sorting. Mandatory identity: person's name on Personal; org name and one canonical global primary on Organization. Added nullable `associated_organization_id` to generic Personal pipeline records for donors with optional organization connections. Other organizations' primary designations are not overridden or copied per pipeline.

### Connected source adapters (read-only, no source status rewrite)

- Prospective Clinicians: existing `staff_list_provider_applicants` RPC with staff role authorization; local display stage derives `provider_applicants.status`. Website-source `new` displays Interested, legacy `new` displays Identified; `credentialing` displays Application, `ready` displays Approved, `hired` exits prospective roster. Saving Approved is still done through the existing staff applicant workspace where the existing automatic Approved→onboarding-invited flow is implemented; new board links there.
- Hired Clinicians: staff with CLINICIAN role, sourced from `staff.prov_status` Invited / New / Active / Inactive, no new employment status.
- Clients: protected `clients.lifecycle_stage` stages; uses source table's existing staff/clinical RLS; no PHI copied into generic contact or pipeline-record tables. A CRM login without clinical access gets a permission error, not an authorization bypass.
- Beyond The Yellow: actual organization-linked opportunities and exact canonical opportunity stages, displaying single global organization primary. Currently some organizations' primary relationships require review.

Direct data-source inventory as of deployment: 34 open/approved clinician prospects, 20 clinician-role staff, 683 clients, 188 BTY opportunities. This inventory is NOT proof of a successful logged-in frontend render.

### Manual pipelines and source linkage still outstanding

- Donors: generic Personal manual stages and optional organization association are usable. Automatic donation transaction enrichment / one-time/recurring donor synchronization into board cards remains NOT BUILT. One `crm_donors` donor existed at audit but had no `relationship_contact_id`; never auto-merge by name alone.
- Institutional Recruiting: 80 separately researched targets in 16 states, **none currently linked to `relationship_organizations`**. User can manually enroll verified CRM organization + canonical global primary. Research target import/link and future state sync remain NOT DONE.
- VA Medical Centers: 82 existing referral contact entries, no verified organization pipeline enrollment linkage in source. VA facility hierarchy / regional parent organization, canonical primary, and referral outcome import remain NOT DONE.
- **October 9 follow-up (PR #109):** A sole linked contact now automatically becomes Primary across all pipelines, including on new association insert, after unlinking to one remaining contact, and when a user attempts to clear the only Primary. Historical one-contact organizations were backfilled: 344/344 now have exactly one Primary. Bob Woodruff Foundation still has two competing primaries and needs operator resolution; no arbitrary multi-contact primary was selected. Craig Newmark Philanthropies was backfilled as requested because it has one linked contact, **but that contact's email belongs to a Bob Woodruff Foundation domain**, so the affiliation itself should be reviewed for accuracy. Organizations with no affiliations still need a contact.

## Next engineering phases

1. Authenticated browser acceptance, verify frontend publish and source authorization for administrator, CRM operator, and clinical access paths, plus signed-JWT cross-tenant tests.
2. Dedicated import/link/reconcile workflow for Institutional Recruiting and VA facilities; primary contact explicitly chosen after evidence review, preserve every source ID.
3. Donor enrichment/sync from actual `crm_donors`, Givebutter ingestion / recurring and gift history into manual prospect pipeline, with transaction idempotency.
4. Generic source-status-to-stage bridge improvements, extensible source adapter registry, manual stage audit, editable field overlays on connected pipeline rows (without duplicating source statuses), server pagination.
5. Full drag/drop Kanban, saved filtering and sorting, bulk processing and metrics; organize clinician approval entry in CRM linking staff app.
