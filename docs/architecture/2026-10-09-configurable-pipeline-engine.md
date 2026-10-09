# Configurable CRM pipeline foundation — October 9, 2026

## Implemented and deployed

- Repo: `LPredmore/valorwell-crm`, PR #105, squash merge `f229b563783c04126d3abf2f0f21f2d03d7ebade` to `main`.
- SQL: `supabase/migrations/20261009043000_crm_configurable_pipelines.sql`; Supabase Billing Hub migration `crm_configurable_pipelines_20261009` applied successfully.
- Five new tenant-scoped, RLS-enabled tables: `crm_pipelines`, `crm_pipeline_stages`, `crm_pipeline_fields`, `crm_pipeline_records`, `crm_pipeline_stage_events`.
- Admin-created pipelines can be Personal or Organization; user-configured name, stages, custom typed fields, card-visible fields, Sort by dropdown fields. Mandatory identity: person name for Personal; organization name plus **the organization's single global primary contact** for Organization.
- Manual pipelines: board by stage with stage movement, link records to existing CRM people/organizations (never copy those records), custom field editor, status/next-action display. Initial implementation uses basic stage columns and dropdown movement, not drag/drop, and currently loads up to 500 records per pipeline.
- SQL validates tenant-scoped membership, stage, field types, connected-source write boundaries, immutable identity, and requires exactly one existing canonical primary contact before enrolling an Organization record. New organization-primary assignments are guarded from competing primaries under a transaction-level organization lock; `crm_set_organization_primary_contact(uuid,uuid)` provides atomic replacement.
- Existing relationship, applicant, staff, donor, BTY, and client source statuses/tables were not changed or backfilled.
- Dedicated CI run 37884721219 **passed**: changed-file lint, TypeScript, 4 tests (3 pure configuration + 1 embedded PostgreSQL migration/tenant/primary test), and production build.
- Supabase security advisor found no warnings specific to newly added pipeline objects. Existing unrelated security findings remain.
- Original BTY opportunity page remains at `/crm/business-development/opportunities`; the new pipeline route is `/crm/pipelines` in the CRM sidebar.
- The frontend deployment/authenticated browser smoke test and signed-JWT two-tenant test are **not confirmed**. Never claim the live UI is usable before verifying deployment.
- Broad `Application CI` remains blocked by a **pre-existing unrelated** retired Supabase URL in `supabase/functions/video-r2-drive-migrator/index.ts`; the broad Validate workflow also fails on existing `prefer-const` in `src/integrations/supabase/previewAuthStorage.ts`. The dedicated pipeline checks passed.

## Still NOT configured/finished

**The initial catalog remains empty: 0 of 7 ValorWell workflows enrolled/configured.** This is intentional until source mappings are verified; no cosmetic empty pipeline is presented as completed. Users can now create fully configurable **manual** pipelines and use boards. Connected source adapters and seed configuration through this same generic engine will be the next work.

1. Prospective Clinicians — Personal. UI stages Identified → Contacted → Interested → Screening → Application → Approved. Source: provider_applicants plus recruiting prospects. Approval automatically provisions/invites via existing staff portal approved→invited workflow (staff PR #29). Never edit provider_applicants.status enum to match UI stages.
2. Hired Clinicians — Personal. Starts with existing onboarding invitation. Read existing staff.prov_status Invited/New/Active/Inactive and onboarding milestones; never conflate employment status with currently active capacity.
3. Clients — Personal. Existing authoritative client status/lifecycle only; PHI-safe access and stage adapters needed, no copying clinical details to pipeline records.
4. Donors — Personal, optional organization. Stages Identified, Research, Contacted, Interested, Asked, Pledged, Donated, Stewardship; connect actual donation and recurring metadata from existing donor payment systems.
5. Beyond The Yellow — Organization. Canonical organization-wide primary contact. Preserve existing BTY opportunity and episode source workflows and statuses.
6. Institutional Recruiting — Organization. Backed by `relationship_institutional_recruiting_targets` (80 targets/16 states at audit). Stages Identified, Contacted, Established, terminal Declined/Not Interested. Source contacts and primary need reconciliation.
7. VA Medical Centers — Organization. Existing facility/referral-contact sources, main regional facilities rather than individual clinic deals; primary contact and referral-development outcome.

## Explicit release follow-up

- Existing contact associations audit: one organization currently has **two** primaries, another affiliated organization **none**; reconcile through authoritative relationship-management review rather than selecting automatically. The guard prevents **new** multiple-primary assignments, but does not silently rewrite historical records.
- Source-connected pipeline initialization must operate via the same generic configuration service as any future customer-created pipeline, preserve multi-tenant boundaries and existing source statuses, and not manufacture records or emails.
- Next phases: source adapters + initial pipeline configs, stage transitions & audit verification, full Kanban drag/drop, list/saved views, field/card and sort performance, real authenticated browser QA, signed JWT multi-tenant tests, and phased rollout.
