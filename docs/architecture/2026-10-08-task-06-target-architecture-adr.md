# ADR: ValorWell CRM modernization — target architecture, sequencing and safe rollback

**ADR ID:** VWCRM-2026-10-08-001. **Date:** 2026-10-08. **Status:** **TECHNICAL DESIGN BASELINE** for implementation Tasks 07–37, subject to release gates stated below. This documents engineering decisions; it does **not** authorize live sending, schema changes that bypass testing, Flurra cutover, or removal of the existing Social Media Manager.

**Authoritative code:** `LPredmore/valorwell-crm`, `main`, `src/App.tsx`, `src/components/crm/layout/`, `src/repositories/supabase/`, `src/domain/relationships/`, `src/services/dataProvider.ts`.

**Authoritative DB:** Billing Hub Supabase project `ahqauomkgflopxgnlndd`. **Audit input docs:** 
- `docs/architecture/2026-10-08-task-01-route-inventory.md`
- `docs/architecture/2026-10-08-task-02-data-inventory.md`
- `docs/architecture/2026-10-08-task-03-security-audit.md`
- `docs/architecture/2026-10-08-task-04-communication-contracts.md`
- `docs/architecture/2026-10-08-task-05-social-freeze-baseline.md`

## Motivation and design principles
1. Turn existing CRM into a coherent Pipedrive-style relationship-management workspace with people, organizations, multi-activity profiles, distinct pipelines, tasks, outreach and reporting.
2. **Consolidate presentation and integration first, not storage by wholesale replacement.** Multiple sophisticated domain-specific engines already run in production, especially clinical communications, BTY, newsletters and social publishing.
3. **Social Media stays in the existing CRM and continues publishing.** Move only its sidebar presentation into a separate Social Media group. Flurra is independently developed and cannot replace production until parity, ownership and rollback are proven.
4. Enforce data ownership, multi-tenant RLS, least-privilege role access, idempotent writes and auditable transitions; clinic/PHI data stays in protected EHR systems.
5. Ship incremental, testable slices that preserve working client, clinician, BTY and social operations. A same-day due date is not a release deadline.

## Bounded contexts and target ownership
| Context | System of record | New CRM presentation/integration |
|---|---|---|
| Non-clinical people, orgs, affiliations | Existing `relationship_contacts`, `relationship_organizations`, affiliations/roles | Contact/Organization lists and profiles; search, ownership, timeline |
| Identity correlation only | Existing but empty `crm_people`, `crm_person_identities`, `crm_person_records` | Introduce reviewed tenant-scoped links between source record IDs; do not auto-coalesce PHI or overwrite source tables |
| BTY outreach opportunity | `relationship_opportunities`, status history and existing interview/scheduling workflows | BTY pipeline board via adapter mapping actual statuses |
| Therapist prospect and applicant | `therapist_outreach_prospects` (privileged staging); `provider_applicants` (actual application) | Source-specific mapping to a Therapist Recruitment pipeline; tenant assignment and eligibility reviewed before import |
| Client intake and clinical follow-up | Existing canonical clients, referrals, tasks, staff/EHR contracts | Operational intake status and link to protected EHR; do not duplicate notes/diagnoses in marketing records |
| Relationship outreach email | `relationship_campaigns`, enrollments, communications/replies/suppressions, Resend worker | Campaign management views and timeline links; backend stays independent |
| Client campaign email and newsletters | `crm_campaigns`, `crm_campaign_registry`, `crm_newsletters`, related processors and send safeguards | Unified management navigation, unchanged transport/queue semantics until separately proven |
| Tasks and operations | `crm_tasks` plus validated source-specific next actions | My Tasks, linked task in contact/pipeline card; map rather than duplicate |
| Social publishing | `ai_operations_social_*`, `social-media-manager`, YouTube dispatcher/cron and video sources | Separate Social Media sidebar and preserve `/crm/social-media`, existing tab functions |
| Flurra | Separate application/product and independent multi-tenant data architecture | Future optional integration via explicit permissioned API; not part of current CRM migration |

## Chosen interface structure
**Workspace**: Dashboard, My Tasks, Inbox.

**CRM**: Contacts, Organizations, Pipelines, Communications, Campaigns.

**Operations**: Therapist Recruitment, Beyond The Yellow, Client Intake, Clinician Network.

**Social Media**: Own visually separate collapsible group, with Social Dashboard/Library/Publishing Queue/Publishing Calendar/Social Settings and Schedule Series; all current underlying services remain in the CRM for now.

**Administration**: Reports, AI Operations/System Health, Settings.

Menu items are navigation surfaces. Don't prematurely merge unrelated clinical/relationship data access or remove deeper diagnostic pages.

## Pipeline model recommendation — subject to Task 18 data design
- Preferred approach: **additive configurable pipeline definitions and link records**, not new copies of source contacts, applications and BTY opportunities.
- Candidate tables: `crm_pipelines`, `crm_pipeline_stages`, `crm_pipeline_records`, `crm_pipeline_stage_events` — names/projections proposed only; use migrations after comparing existing contracts.
- `crm_pipeline_records` could contain `tenant_id`, `pipeline_id`, `stage_id`, `source_domain`, `source_record_id`, assigned `owner_profile_id`, version, lifecycle timestamps, due/next action, outcome and metadata. Unique keyed association prevents duplicate enrolments while allowing one person across multiple pipelines.
- Stage definitions can carry order, allowed transitions, mandatory fields and terminal flags; transition service enforces role and source rules transactionally with event history, idempotency and concurrency fencing.
- A BTY source opportunity's domain status remains authoritative. Adapters translate to board stages without dual-master writes. If two-way transition is supported, use a source-specific RPC with atomic history and lifecycle validation.
- Proposal favors tenant+pipeline+stage/owner/due indexes subject to workload/EXPLAIN; RLS on all exposed tables and `security_invoker` views. No direct browser `service_role`.
- Do not backfill before reviewing `crm_people` registered source mapping and resolved duplicate/provenance issues.

## Navigation compatibility migration
1. Introduce typed nav configuration with group labels, icons, permissions and canonical routes in `src/components/crm/layout/CrmSidebar.tsx` and appropriate layout components. **No route deletion in this first release.**
2. Move Social Media nav entry to **its own separate collapsible group**. Keep `/crm/social-media` mounting the existing `SocialMediaManagerPage.tsx` and same underlying tabs/functions. Add URL-tab deep links only with tests and backward compatibility.
3. Consolidate primary entries for dashboards, contacts, orgs, Campaigns, Communications, Reports; retain old `src/App.tsx` destinations and redirects for valid bookmarks and id-bearing links. Maintain correct domain labels.
4. Introduce pipeline UI as opt-in new route after stable services exist; preserve current BTY opportunity and clinical screens in parallel.
5. Only remove redundant nav entries after same-record parity, role/capability checks and operator review; if route aliases are retired, support redirects.

## Implementation order and dependencies
- **Gate A — Tasks 01–06:** audits + source-of-truth baseline, security negative-test plan, social freeze and ADR. Task 03 cross-tenant runtime tests are still required before any data exposure changes.
- **Gate B — Tasks 07–10:** navigation shell/social isolation + mobile/accessibility/deep-link regression. Zero DB migrations and zero social backend changes. Ship and verify separately.
- **Gate C — Tasks 11–17:** identity, contact/org linking, timelines and tasks. Reconcile existing `crm_people` before backfill; permission tests and clinical boundaries required.
- **Gate D — Tasks 18–24:** stage metadata, additive schema, typed repository, pipeline board and audited transitions. No adoption in source workflows until adapters validated.
- **Gate E — Tasks 25–29:** reconcile therapist staging, launch recruiter workspaces and test campaign integration with separate Todoist email campaign task `6hhmHVJ3MCMcFPQH`. Prospect rows: 1,279 total, only 240 have nonblank emails (239 marked contactable); no mass send permitted from raw staging.
- **Gate F — Tasks 30–34:** BTY and Client Intake adapters, clinician network, communications nav and verified reporting; preserve domain-specific state machines.
- **Gate G — Tasks 35–36:** security/performance/regression, release flags, parity and rollback evidence. **Gate H — Task 37:** future Social Media/Flurra cutover only after explicit later approval.

## Explicit non-goals, freeze and prohibited changes
- Do not remove existing Social Media Manager from ValorWell CRM or switch its publishing backend to Flurra in any of Tasks 01–36.
- No modifications to `ai_operations_social_*` tables, YouTube publish jobs, worker leases/RPCs, R2 video media, cron or OAuth during **navigation** release.
- No direct browser access to `therapist_outreach_prospects` or `provider_applicants` just to populate pipeline UI.
- No mass cold therapist email until distinct audience eligibility, identity, suppression, sender settings and end-to-end tests are reviewed.
- No copying client diagnoses, therapy notes, assessments, private messages or other PHI into general relationship records.
- No deleting old production tables, merging the client and relationship send engines, or removing existing active pipeline/status histories to achieve UI consolidation.

## Migration / rollback blueprint
**Preparation:** pin source commit SHA; record representative baseline IDs/aggregate counts, critical route snapshots, active worker schedule and social queue states; test backout in an environment with proper permissions; ensure verified database recovery point/snapshot via Supabase or operational backup. A logical SQL migration cannot safely promise to undo outbound emails, external YouTube publishing or schema changes without backups.

**Schema, if needed (Tasks 18–19 only):** additive create tables/indexes/constraint checks; enable RLS/policies first; regenerate generated types; seed pipeline definitions idempotently; keep old source read paths. Prefer no destructive column/constraint changes. Review migrations, explain query plans and run schema/security advisers before deployment.

**Backfill:** dry-run identity/prospect mapping with counts for matched/ambiguous/unmatched, archived original keys, source provenance, tenant mapping, suppression conflicts; manual review ambiguous cases. Apply idempotently in small batches with per-row audit/mapping keys. Re-run counts and orphan/duplicate checks.

**Application rollout:** ship code behind feature flags/routed opt-ins, verify API response compatibility, old bookmarked routes and new menu; roll out first to authorized internal operators. Do not change live workers as part of UI release.

**Rollback trigger:** any cross-tenant read/write, missing clinical authorization, unexpected communication sends, duplicated recipient or publication job, failing existing BTY/client/ops workflow, unhandled migration data loss, or unexpectedly missing contacts/opportunities. Disable new feature routes/flags, redeploy last known good frontend, pause only **new** pipeline workers if introduced, restore from confirmed backup only with incident/recovery approval; preserve existing email/social workers. Perform reconciliation after rollback.

**Deployment evidence:** for each pass record commit SHA, changed files, migration ID (or none), exact CI commands/results, snapshot counts/time window, operator smoke test, permission tests, rollback procedure, unresolved blockers. No PASS without evidence.

## CI and test commands grounded in checked-in GitHub workflow
`.github/workflows/ci.yml` uses Node 22 and:
```bash
bash .github/scripts/check-billing-hub-boundary.sh
npm ci --legacy-peer-deps --no-audit --no-fund
node scripts/verify-clinical-recovery-provenance.mjs
npx eslint src --max-warnings=0
npx tsc --noEmit --project tsconfig.app.json
npx tsc --noEmit --project tsconfig.node.json
npm test
npm run build
```
Run focused cross-tenant RLS and migration verification in addition to normal CI when DB changes occur. No code/test suite executed by this documentation-only ADR; user-facing workflow tests remain required in the successor tasks.

## Decision readiness / unresolved gates
**Decision reached:** architecture is approved **as a technical baseline for designing navigation and adapters** (Tasks 07 onward) with the freeze boundaries and order above. This is **not** authorization for schema changes or Flurra cutover.

**Blocking security validation:** Task 03 still needs real low-privilege, cross-tenant negative tests; `crm_donor_transactions_v` lacks `security_invoker` and requires security review before unified reporting. Existing SECDEF function exposure requires least-privilege testing.

**Blocking campaign validation:** Task 25 must fix or exclude 1,039 missing-email prospects, resolve duplicates and tenant attribution, enforce suppression before Task 28/29 live email readiness.

**External-gated parity:** Task 37 requires Flurra independent authentication, media, queue, OAuth, schedule, thumbnail, provider/status and rollback tests before switch. No automatic transition.

**Exit criteria Task 06:** target owners, application/menu plan, schema direction, execution order, preservation freeze, test standards, risk gates and rollback strategy documented. Detailed pipeline DDL and approvals occur in Task 18–19, not this ADR.
