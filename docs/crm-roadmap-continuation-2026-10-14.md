# CRM roadmap continuation — October 14, 2026

Implementation prepared against main b6986b7 (PR #153). Branch: codex/crm-roadmap-continuation.
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

Automatic approval review rejected the attempted GitHub push because it required explicit authorization to upload repository contents and create the remote branch. No alternate upload route was attempted. Local implementation remains pending GitHub publication and is not claimed deployed or verified.
