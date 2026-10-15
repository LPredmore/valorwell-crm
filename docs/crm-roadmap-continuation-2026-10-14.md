# CRM roadmap continuation — October 14, 2026

Implementation prepared against main b6986b7 (PR #153). Branch: codex/crm-roadmap-continuation. Draft PR: https://github.com/LPredmore/valorwell-crm/pull/154.
No tests, lint, typecheck, build, browser checks, migrations, deployment, or live workflow executions were performed. Acceptance remains open. This is a continuation of Todoist master task 6hhmHVFjqc5rmjCq; verification belongs under its final checklist 6hm9jrrxrXXxpPwq.

## Changes

### Phases 07, 08, 10: compact navigation

Keep additional tools visible as labeled icon links when the sidebar is collapsed. Existing capability filtering and route destinations remain in place.

### Phases 13, 17: directory workflow

- Validate UUID, stage, outreach status, veteran affiliation, sort, contact-history and page URL parameters before constructing typed directory queries.
- Preserve directory filters and page in contact/org detail links, return links, organization edit and new-organization save flows. Return destinations remain fixed internal paths; only query strings are retained.
- Hide obsolete search results during the debounce interval and hide cached success results on query error.
- Disable pagination while a query is fetching.

### Phase 15: activity timeline

- Replace repeated retrieval of all earlier pages with independent incremental interaction/email queries.
- Scope caches and reset channel/display state by tenant, operator, CRM role and subject.
- Add stable ID ordering for equal-time email/interaction pagination.
- Add retry and pressed-state semantics to channel controls.

### Phase 16: follow-up tasks

- Paginate the same canonical task table in 50-row pages, with open/overdue filtering applied before pagination. No second task store.
- Reset task drafts when subject, tenant, operator or CRM role changes.
- Scope task caches by those identities and view; use named owner controls and labels.
- Correct relationship task writes to invalidate crm-tasks rather than the unrelated tasks key. Canonical task mutations also invalidate relationship-task queries.
- Preserve server permission checks, existing status/priority contracts and local-time date input behavior.

## Impact and remaining review

Changes affect navigation rendering, directory URL interpretation, source-history requests, task list queries and query-cache refreshes. No database contract or outbound communication worker changed. Invalid URL enum/UUID values now fall back/are ignored instead of reaching the database. Saved bookmarks with invalid values may show a broader default view; RLS remains authoritative. Incremental offset pagination can still shift under concurrent inserts/deletes; source IDs deduplicate displayed tasks. Timeline sources retain their existing deduplication semantics; full provider/reply reconciliation remains a separate roadmap requirement.

The task list is loaded incrementally, so its displayed loaded count is not a tenant-wide total. The timeline likewise labels loaded events and older-source availability. Full lifecycle, identity linking, donor synchronization, research identity decisions, security acceptance and deployment are not completed by these changes.

## Deferred checks

- Run existing lint, app/tooling typechecks, Vitest, production build, boundary/provenance checks and CI in the combined test pass.
- Timeline with >200 records per source: load successive pages without refetching earlier pages on each click; equal timestamps; source failures/retry; channel/display reset on record/operator/role/tenant changes.
- Directory URL validation with malformed/duplicate IDs, enum/sort values and invalid/large pages; valid multi-value bookmarks; rapid typing, back/forward and delayed/error responses.
- Contact/org detail round trips and organization create/edit/save preserve directory filters and page, including new-tab navigation; hostile return query strings cannot change the fixed route.
- Tasks >100, including overdue records beyond the first page: open/all/overdue filters, completion/reassignment, names, unknown/historical owners, task draft reset and failed-page retry.
- Record panel writes refresh My Tasks and canonical task writes refresh record panels. Confirm no duplicate creation and correct local-time due dates across DST.
- Compact/expanded/mobile navigation: every permitted additional tool remains reachable, all icon links have names, prohibited tools stay hidden.
- Signed-in two-tenant/role regression, normal release review and production deployment after acceptance. Rollback by reverting the batch commit; no database rollback.

## Publication blocker

Automatic approval review rejected the attempted GitHub push because it required explicit authorization to upload repository contents and create the remote branch. No alternate upload route was attempted. User explicitly authorized publication. GitHub publication then succeeded through the connected GitHub app (terminal credentials were unavailable). PR #154 remains a draft; no deployment or verified acceptance is claimed.


## Continuation after publication authorization

Additional implementation for Phases 13, 15, 16, 17, 23, 24, 27, 33, 38 and 39:

- Linked manual pipeline memberships on relationship contact/org profiles, including optional related-organization links, named owners, stage and next action. Pages contain 25 records; errors never imply a zero total. No connected clinical adapters are loaded.
- Exact pipeline-record bookmarks use a tenant/pipeline/record lookup independent of the board's loaded page or filters. Unavailable/archived pipeline links produce an explicit unavailable state instead of silently choosing another pipeline.
- Pipeline details show paged stage events, the existing relationship communication timeline and canonical follow-up tasks. The relationship workspace remains one click away.
- Pipeline and research review sessions reset draft state on tenant/operator/role changes. Source-specific queries keep the existing tenant filters and RLS.
- Institutional and VA research review now uses server-paged search, separate complete-source totals, Awaiting review/Linked/All views, and a link to the existing organization. Linking invalidates board metrics and profile memberships. No organization or source associations were changed during this implementation.
- Recruitment quick views reuse existing reviewed/uncontacted, replied, linked-applicant, blocked, review and overdue predicates, preserving name/state context. No campaigns are activated by these views.
- Canonical task editing converts ISO due dates to local wall-clock input instead of slicing UTC. Invalid date input is rejected before serialization. Clearing a due date in edit mode sends explicit null through the existing repository contract; creation keeps an omitted deadline optional.
- Contact/org detail navigation resets nested drafts for different tenant/user/role/record identities. Lifecycle/referral activity updates invalidate the aggregate timeline; their history queries are scoped to the operator context.
- Communications has a new navigation-only landing page with URL-backed categories for direct messages/replies, campaigns, newsletters and templates. Existing destinations remain available. Technical control-plane navigation moves into Administration; source-specific sending engines are untouched.

### Dependencies and risks

| Surface | Risk | Mitigation and deferred verification |
| --- | --- | --- |
| Manual memberships and record bookmarks | Medium: access, archived/foreign IDs, associated-org semantics | Existing public-client RLS plus explicit tenant/pipeline filters; defer signed role/tenant, >25 record and missing-record acceptance. |
| Research paging/search | Medium: filter behavior, matching totals, equal sort values | Exact count queries, stable ID tiebreaker, restricted literal search and server-side link filters; defer full-dataset and retry acceptance. |
| Stage history and panel reuse | Medium: incomplete source history or refresh mistakes | Paginate existing stage ledger; reuse existing relationship-only timeline/tasks; defer >50 events and cross-view refresh checks. |
| Operator-specific caches/drafts | Medium: stale data during role or tenant switches | Extend keys/reset boundaries; server authorization remains required; defer independent signed-user/role verification. |
| Date editing | Medium: accidental offset changes | Display existing instant in operator local time; defer UTC/Central/DST round-trip acceptance. |
| Communications navigation | Low: route discovery/bookmark regressions | Add one landing route, retain old destinations and control-plane URL; defer role and navigation matrix. |

### Work still requiring source evidence or separate operational decisions

- Shared-database contract changes require the existing migration dependency audit/review gate. This batch adds none.
- Do not close signed-JWT, authenticated UI, release, performance or security acceptance tasks until their evidence exists.
- CRM invitation issuance/shared Auth redirects require the actual administrative invitation mechanism and live multi-portal settings; no guessed global Site URL change was made.
- Research reconciliation and Primary contact conflicts require record-specific identity evidence and deliberate review. Paging is tooling for that work, not proof it is reconciled.
- Donor payment/webhook synchronization requires authoritative source event/ledger mappings and controlled fixtures before production changes.
- No additional tests, lint, typecheck, build, CI inspection, browser checks, migrations, production writes or worker activation were performed.


### Global Primary selection tooling (Phase 41)

Organization contact rows now expose an explicit confirmation action to choose the sole global Primary through the existing `crm_set_organization_primary_contact(p_organization_id,p_contact_id)` RPC. The function's source and generated signature were inspected; it retains permission checks, row locking and same-organization affiliation validation. No database function or production data was changed. Existing Primary flags can also be reconfirmed as sole Primary so a human can resolve legacy multiple-Primary cases. The affiliation form's label now matches organization-wide semantics. Deferred: deliberate choice on real conflicts, concurrent choice/foreign contact/readonly tests, card/Primary refresh and rollback acceptance.


### Canonical Tasks workspace (Phase 16)

The main Tasks page now exposes the existing create/edit dialog, named owner assignment, explicit due-date clearing, local date/time display and links back to a task's relationship contact or organization. Read-only operators do not see selection/mutation actions. Bulk completion has pending/error feedback; list failures cannot present old data as current success. Selection resets when tenant, operator, role or task view changes. Canonical task mapping now retains the relationship subject columns that were already selected from the database. Read-only schema inspection confirmed both subject columns exist in Billing Hub; this was implementation dependency discovery, not behavioral testing. No test task or source record was created.

Deferred Tasks acceptance also includes creating/editing/reassigning from the main queue, relationship source-link preservation, deadline clearing, readonly mutation hiding, bulk failures, empty/error states and independent operator/role transitions. The existing canonical list endpoint retains its original result-limit behavior; it is not a complete audit export.


### Live identity dependency blocker

Read-only catalog discovery on October 15 UTC returned null for `public.crm_identity_reviews`, `public.crm_therapist_prospect_attributions` and `public.crm_identity_review_events`. The earlier runbook already documented their migration as deliberately unapplied pending signed-JWT/source-access acceptance. The current source migration is `supabase/migrations/20261008161000_crm_identity_review_links.sql`. Therefore the review UI's missing-contract state remains appropriate; this batch does not activate identity approvals or attribute prospects. The existing schema migration gate and independent acceptance work remain on the roadmap. No complete new migration audit or migration approval is claimed here.


### Workspace dashboard (Phase 34)

Added a CRM dashboard at `/crm/workspace` and made it the sidebar/default `/crm` destination. It shows a bounded My Tasks preview, separate exact relationship-reply and recruitment-review counts, BTY scheduling/client-operations launchers, and exact existing-RPC attention/stage counts for a selected manual pipeline. It does not aggregate incompatible funnels. Unavailable sources show unavailable states instead of fabricated zeroes. The System Command Center is reachable from Administration and its old URL remains valid. Client dashboard and all existing detail links remain available. No new metrics/RPC/database contracts were added. Deferred: source total reconciliation, zero vs unavailable states, stage/pipeline selection, role/tenant/user transitions, navigation/bookmarks and realistic query performance.
