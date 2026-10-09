# CRM connected source stage actions — verified implementation scope
Date: October 9, 2026

## Code and production database state

- [PR #112](https://github.com/LPredmore/valorwell-crm/pull/112) squash merged to `main` at `c0cb97957577005edffb546a235d922be59f9a67`.
- Live Billing Hub project `ahqauomkgflopxgnlndd`: applied migration `crm_applicant_pipeline_staff_tenant_scope_20261009` from `supabase/migrations/20261009181500_crm_applicant_pipeline_staff_tenant_scope.sql`.
- Focused GitHub Actions run [37963983911](https://github.com/LPredmore/valorwell-crm/actions/runs/37963983911) passed ESLint, TypeScript, tenant/transition/PGlite regression tests and production Vite build.
- Direct SQL verified the function `public.crm_staff_tenant_for_applicant_pipeline()` exists, is `SECURITY DEFINER` with empty search_path, requires the private staff authorization contract, authenticated EXECUTE granted, anon EXECUTE denied. This intentionally authorized wrapper returns only the caller's authorized staff tenant UUID; it exposes no applicant data. Supabase security advisor warns in general on authenticated EXECUTE for SECURITY DEFINER functions, including this new scoped wrapper; explicit staff-contract checks justify the limited grant, but further live credential/role audit remains a release gate.
- Direct SQL confirmed original source record counts remain applicants 35, BTY opportunities 188, manual pipeline cards 0; this implementation does NOT change any source status during migration.

## Source-connected actions available in the CRM board

### Beyond The Yellow (Organization)
- CRM cards read **real** `relationship_opportunities.status`, `version` and `owner_profile_id` (not a copied pipeline-record stage). Both Kanban and List views offer a deliberate **Change BTY stage** control for CRM operators.
- The UI offers only approved transitions and requires an audit reason >=8 characters. On confirmation, it calls the **preexisting authoritative** `public.transition_relationship_opportunity_status` RPC. That native SQL flow validates CRM admin/operator role and organization tenant, checks expected version, validates current=>destination transition, writes original opportunity record, `relationship_opportunity_status_history`, and `relationship_interactions`. On success CRM invalidates and reloads source data.
- **Critical exclusion:** DO NOT expose `qualified -> ready_for_campaign` in the generic CRM board. Live audit found `capture_bty_ready_for_campaign` trigger which, for an approved opportunity, can create live BTY campaign enrollment and scheduled outreach. That stage must remain in the existing BTY review/campaign activation workflow. The UI and regression tests explicitly block it despite the general native transition graph allowing it.
- The stage-control UI does not itself send email or synthesize a sent activity record; other preexisting source behavior still applies to status changes. Operators must enter a truthful note when marking an opportunity Contacted.

### Prospective Clinicians (Personal)
- Before ANY applicant cards are fetched, the new `crm_staff_tenant_for_applicant_pipeline()` RPC checks the caller's authorized staff tenant against the CRM-selected tenant; mismatches fail closed rather than displaying records from another tenant.
- Existing `staff_list_provider_applicants` provides `status`, `version`, `ownerProfileId`, next action/due date, and clinic/prospect information after staff-contract authorization. The cards never write a second applicant status table.
- The ONLY general CRM inline applicant stage transition in this release is **Contacted → Screening**, using the preexisting version-checked, authorized and audited `staff_update_provider_applicant` RPC. It preserves owner, next action and due date and supplies a staff activity note and idempotent client action ID.
- All other applicant transitions, especially first contact (requires a real delivered contact event) and approval/Hired→Invited onboarding invitation, remain in the staff applicant portal. Applicants with missing owner/follow-up cannot use even the limited CRM transition.

### Hired Clinicians, Clients
- Remain **source-authoritative read-only** in the generic CRM board until their native credentialing, appointment/client care contracts can be safely mapped; no direct status updates from generic CRM.

## Remaining signed-off release gates

- Frontend publication and authenticated browser tests for real staff vs CRM roles, tenant switching, stale version, list/board refresh, campaign-safety UI and mobile keyboard interactions NOT completed. Unit/embedded Postgres role test is not a substitute for real signed-JWT API exercise.
- Establish controlled source-backed end-to-end tests of supported status actions with approved test records; do not mutate existing real opportunities/applicants just to prove the UI.
- Expand safe clinician native actions only when first-contact delivery and Approved→Invited handoff can be integrated atomically; do not bypass source side effects.
- Full team-owner selection, connected clinical/staff actions and unlimited cursor pagination remain on the original Phase 19/20/22/26/35/36 roadmap.
