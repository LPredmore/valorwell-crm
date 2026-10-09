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

## Updated initial configuration status (October 9)

**All seven ValorWell pipelines have now been seeded as generic tenant configuration:** 49 stages and 20 field definitions. Read-only source adapters display authoritative source stages for Prospective Clinicians, Hired Clinicians, Clients and Beyond The Yellow; remaining Donors, Institutional Recruiting and VA Medical Centers use manually enrollable CRM relationship boards while source-record linkage and gift/referral synchronization are outstanding. No source statuses were modified. See the current verification and backlog: [Seven-pipeline configuration status](2026-10-09-seven-pipeline-configuration-status.md).

Remaining work: authenticated browser acceptance, live frontend publish verification, signed-JWT cross-tenant tests, ambiguous global primary cleanup, Institutional/VA source linking, donor transactions, source field overlays, drag-and-drop Kanban, pagination, saved views and reporting.
