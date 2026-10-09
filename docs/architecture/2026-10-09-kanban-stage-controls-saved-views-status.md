# CRM Kanban, stage controls and saved views — deployment status
Date: October 9, 2026

## Implemented and merged

- CRM [PR #110](https://github.com/LPredmore/valorwell-crm/pull/110), main merge SHA `beb3b723d11612016ec7601b037036f70d209fd6`.
- CRM [PR #111](https://github.com/LPredmore/valorwell-crm/pull/111), main merge SHA `010de9b4547ceb2095b698cf52947db86f823708`.
- Billing Hub project `ahqauomkgflopxgnlndd`: **APPLIED** migration `pipeline_stage_rules_and_saved_views_20261009` from `supabase/migrations/20261009190000_pipeline_stage_rules_and_saved_views.sql`.

### Phase 19 / 22: stage data and permissions

- New `crm_pipeline_stage_rules` with tenant+pipeline+from/to composite foreign keys; admin-only writes with tenant RLS. Each explicit allow/deny rule overrides the default: moves from NON-terminal manual stages are allowed except explicit denies; exiting TERMINAL stage is blocked unless explicitly allowed.
- `private.crm_enforce_manual_pipeline_transition` BEFORE UPDATE trigger applies to manual stage changes even through direct Data API updates. Existing `private.crm_validate_pipeline_record` enforces source-mode, identity, type, ownership and version; existing AFTER stage audit trigger writes immutable stage-event rows for successful updates only.
- `public.crm_move_manual_pipeline_record(uuid,bigint,uuid)` SECURITY INVOKER RPC checks authorization and expected record version under row lock. Anonymous EXECUTE denied; authenticated EXECUTE available (actual row UPDATE limited by RLS), connected-source status edits rejected.
- Manual card now supports owner self-assign/unassign and next action/due datetime updates with optimistic version checking. Assigning another team member requires additional roster UI; don't claim completed full owner delegation or task system integration.

### Phase 21 / 23: Kanban and views

- `@dnd-kit/core` (existing dependency) draggable handles and stage drop targets for **manual pipelines**; stage dropdown retained as keyboard/accessibility fallback. No drag/drop on clinical/staff/BTY source-connected boards.
- Kanban/list switch; text search, stage, overdue/no-next-action, and manual owner mine/unassigned filters; column counts reflect filtered records.
- New `crm_pipeline_saved_views` RLS: views are private to their authenticated profile; save, restore, edit and delete list/board filters and sort key. Sort validated against available pipeline sort keys; stage ID foreign-keyed to the selected pipeline.
- Bulk move up to **20** selected **manual** records, sequential version-safe moves; no bulk source-system status actions.
- Manual records load in **200-row bounded PostgREST range chunks** with deterministic `updated_at,id` ordering, user-triggered incrementally up to a clearly stated **2,000-row ceiling**. This is NOT unlimited server cursor pagination; results and client-filter/sort are accurate only within the displayed loaded set. Connected adapters have separate bounded source limits.

## Tests and live verification

- Dedicated focused [CI run 37952949403](https://github.com/LPredmore/valorwell-crm/actions/runs/37952949403) PASS lint, TypeScript, PGlite PostgreSQL migration/audit/move conflict/terminal rule/saved view tests, and Vite production build for PR #110.
- Dedicated focused [CI run 37953567813](https://github.com/LPredmore/valorwell-crm/actions/runs/37953567813) PASS lint, TypeScript, PGlite tests including cross-tenant owner-rejection and follow-up change with no spurious stage events, and production build for PR #111.
- Live Billing Hub SQL confirmed exactly seven pipeline definitions, 49 stages, 20 fields, `crm_pipeline_stage_rules` and `crm_pipeline_saved_views` both RLS-enabled with 2 and 4 policies respectively, movement RPC exists and authenticated=EXECUTE/anon=DENIED, AFTER audit and BEFORE transition/validation triggers installed.
- New tables currently **0 rows**; existing `crm_pipeline_records` **0 rows**: live authenticated card drag/drop/saved filter/owner assignment cannot be claimed tested against a real operating record; browser deployment not verified.
- Existing source counts remain unchanged: applicants 35, staff 20, clients 683, BTY opportunities 188. 0/80 institutional targets and 0/82 VA research contacts linked; those are separate source reconciliation workstreams.
- Supabase security advisors report existing project-wide `security_definer_view`, privileged RPC and other warnings; **none specific to the new stage/view objects**. Broad unrelated Application CI and Validate still fail preexisting checks; full repo release sign-off not achieved.

## Remaining acceptance items / tracked Todoist work

- Phase 19: signed real-JWT HTTP tests for separate authorized tenants, role matrix and concurrency; generator type integration and official release gate.
- Phase 21: authenticated browser/mobile/keyboard DnD verification; connected source actions remain intentionally read-only pending owner-system integration.
- Phase 22: full owner selection/assignment, next-action task integration, source-native stage transitions and robust multi-user audit.
- Phase 23: true unlimited server cursor pagination, richer filters, saved-view sharing if approved, bulk error reporting/compensation, performance with large real datasets.
- Phase 24: record details and verified cross-pipeline KPI reporting.
- Phase 35/36: production frontend release confirmation, signed-in end-to-end tests, cross-app regressions, rollback drills.

## Rollback/compatibility

Existing source statuses, clinical PHI tables, newsletter engines and social publisher were **not modified**. If frontend regression appears, revert PR #111 then #110; leave new additive DB objects unused until records/saved views are inspected. Do NOT drop tables holding user-created views/rules without exporting/migrating their data. Source-record changes require no rollback because none were made.
