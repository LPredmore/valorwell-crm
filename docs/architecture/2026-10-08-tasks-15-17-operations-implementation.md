# CRM Phases 15–17 — implementation and release verification

**Target:** existing ValorWell CRM (`LPredmore/valorwell-crm`) and the existing Billing Hub database. **No new app, tenant, cloud project, publishing jobs or data migration.**

## Live schema assessment (read-only, Oct 8 2026)
- `relationship_interactions`: 1,053 rows, `relationship_communications`: 595 rows, `crm_tasks`: 89 rows, `crm_activity_events`: 692 rows.
- Read-only source matching showed **595 of 595 relationship email communications also have an exact-time and same-direction relationship interaction audit**, making provider-email/audit de-duplication necessary.
- Relationship timeline must use `relationship_interactions` and `relationship_communications`; **do not select `crm_email_messages` or `crm_activity_events`** because those include clinical client records.
- Current relationship message provider and reply status are owned by existing source tables/RPCs; never infer a reply from an audit note or assume scheduled means sent.
- The previous `crm_identity_reviews` migration from PR #102 is **not present** in live Billing Hub; these 15–17 operations must not depend on it.
- `crm_tasks` has tenant/staff RLS but no relationship contact or organization columns. We extend that existing task table rather than creating another unsynchronized task product.

## Phase 15 — timeline
- New pure `buildActivityTimeline` maps actual non-clinical relationship communications, including sender, recipient, provider-status, campaign and event timestamp, alongside recorded relationship interactions (meeting, phone, notes, system activity).
- Suppress only matched **exact timestamp + direction** email-interaction audit entries when an authoritative communication exists. Unmatched audits remain unverified; never fabricate send/received/delivered status.
- `RelationshipTimelinePanel` is embedded in both contact and organization details; source annotations, channel filters, chronological sort, 30-at-a-time display pagination and fetch of older interaction pages (100/page). The existing communications RPC is capped at **250 items**; use `listRelationshipEmails` to paginate RLS-filtered relationship email records from the source table (100/page) instead, ensuring older messages remain retrievable.
- No bulk import, sending-engine changes, new provider query, or clinical message exposure.

## Phase 16 — one canonical task store
- Proposed migration `supabase/migrations/20261008220000_crm_relationship_task_subjects.sql` adds nullable `relationship_contact_id` and `relationship_organization_id` directly to **existing `crm_tasks`**, same-tenant FK + trigger verification and indexes. Every task remains in the existing My Tasks list.
- Protect against clinical source collisions (`client_id`, `staff_id`, `campaign_id`, `exception_id` must be null), immutable task provenance and unauthorized cross-tenant/CRM role linking. Existing clinical task RLS not relaxed; new CRM policies select/modify only nonclinical linked rows.
- `relationshipTasksRepository.create` inserts canonical task and subject fields in the **same database INSERT** so a failed link never creates an orphan task.
- Contact/organization panel supports creation, owner, due date/timezone input, priority, status, reassignment, rescheduling, completion, open/overdue/all views. Updates and completion use existing `dataProvider.tasks` methods. Existing staff profiles are used to select an owner.
- New task relationship columns are not yet in generated Supabase types: a narrow typed API wrapper avoids edits to generated files.
- **Database migration is in source control, NOT deployed.** Panel shows an explicit schema-unavailable state until approved deployment and authentication checks.

## Phase 17 — unified directory experience
- Existing central Contacts and Organizations pages retained (including old deep links).
- New filters on persisted `relationship_stage`, source, last-contact recency; contacts add affiliated organization role-title + overdue next action; organizations add has-next-action. All filters execute in the existing tenant-scoped repository queries **before** pagination, so server totals remain valid.
- 300ms debounce of free-text search (including contact role-title), existing URL-state pagination/reset/sort, and existing empty/error/loading states remain.
- Pipeline association filters are intentionally deferred until pipeline records exist in Phases 18–24; no fake pipeline joins were invented.

## Rollback, security and acceptance
- Read-only counts measured against live source tables; **no row backfill, updates, or table mutation to production** during this PR.
- CI: lint changed files, TypeScript, timeline unit tests, embedded-PGlite SQL migration tenant-isolation/clinical-exclusion test, Vite build. Run records linked in PR after completion.
- Prior to a real deployment: review both outstanding migrations (#102 identity, #103 canonical task links), run advisors, actual logged-in CRM smoke test, signed-JWT cross-tenant & field-level negative tests (deferred by user's earlier explicit decision, **not silently marked as passed**), verify no clinical data in general timeline, verify task create/reassign/complete, measure directory counts and latency, and check social publishing health.
- If UI must be rolled back, revert its GitHub merge. If schema is already used, do not blindly drop columns or audit/source references; preserve tasks and use a separately reviewed downgrade.
- **Merge to `main` after checks**, as user expressly requires. Github merge is distinct from cloud deployment and SQL application; report these separately.
