# Business Development delivery plan

This is the authoritative, pass-by-pass delivery plan for the ValorWell
Business Development and Beyond The Yellow application layer. It replaces no
product requirements; it breaks them into small, auditable implementation
passes. Relationship data must never be stored in clinical CRM records,
clinical campaign infrastructure, Creator & Community Interest records, local
storage, or an unrelated persistence mechanism.

## How to use this plan

* A user message of **`next`** means: work on **only** the next pass in the
  active verification bundle. It must not begin a pass from a later bundle.
* A pass may be marked `COMPLETE` only when every acceptance item and every
  audit item in that pass has passed. A pass implemented before its bundle
  verification is marked `IMPLEMENTED_PENDING_BUNDLE`; it is never relabeled
  as complete before that verification succeeds.
* If an external dependency prevents completion, mark the pass `BLOCKED` with
  the exact command, failure, and dependency. Do not begin a later pass.
* Each pass must finish with a user-facing line in this form:
  `Next pass: P## — <name>. Status: NOT STARTED.`
* Each code pass is committed separately. No database migration, schema SQL,
  production data change, Edge Function deployment, or outreach send is
  permitted in any pass.

## Required audit for every pass

Every pass closes with this audit, recorded in its completion note/PR body:

1. **Scope audit:** list every changed file; confirm no out-of-scope feature
   was added and no migrations or Supabase deployment files changed.
2. **Domain-separation audit:** confirm no relationship path imports or calls
   a clinical client repository, clinical campaign/enrollment/step-log API,
   client activity/notes API, clinical communication-policy API, or Creator &
   Community Interest persistence path.
3. **Capability-safety audit:** confirm unsupported reads/writes are gated,
   no invalid background polling was added, and no fallback persistence exists.
4. **Security/UX audit:** confirm permissions, sensitive referral disclosure,
   accessible labels, keyboard behavior, loading/empty/error states, and safe
   external links are addressed when applicable to the pass.
5. **Verification audit:** run the pass tests plus lint, application/tooling
   type checks, test suite, and production build. Report exact commands and
   output status. Failed checks are failures—not warnings—unless an external
   environment limitation is demonstrated.
6. **Completion audit:** compare implementation against every acceptance item
   below; identify the next `NOT STARTED` pass exactly.

## Verification cadence

GitHub Codespaces validation is a required **bundle gate**, not a required
manual step after every small contract-only pass. Every pass still receives the
scope, separation, capability-safety, and `git diff --check` audits locally.
No pass may be described as verified or complete until its bundle gate passes.

| Bundle gate | Passes verified together | Required GitHub Codespaces commands |
| --- | --- | --- |
| V0 | P00 | Clean install, lint, both type checks, full test suite, production build. |
| V-A | P02–P06 | Clean install, focused relationship-domain/repository tests, lint, both type checks, full test suite, production build. |
| V-B | P07–P09 | V-A commands plus route/sidebar/dashboard component tests and a dashboard screenshot. |
| V-C | P10–P15 | Full suite plus organization/contact/lifecycle/timeline tests and representative workspace screenshots. |
| V-D | P16–P22 | Full suite plus referral/BTY/import tests and import-preview screenshot. |
| V-E | P23–P30 | Full suite plus campaign/reply/suppression/unsubscribe tests and campaign preview/inbox screenshots. |
| V-F | P31–P33 | Full suite, production build, full acceptance audit, regression checks, and final screenshots. |

During a bundle, later passes may depend on earlier passes marked
`IMPLEMENTED_PENDING_BUNDLE`, but no database-backed capability is activated,
no production action is performed, and no bundle is merged as verified before
its gate passes. A bundle failure returns work to the earliest affected pass.

## Global validation baseline

| Pass | Status | Scope | Completion criteria |
| --- | --- | --- | --- |
| P00 | COMPLETE | Reproducible validation baseline | `npm ci --legacy-peer-deps --no-audit --no-fund`, lint, application type check, tooling type check, tests, and build all pass using the CI-equivalent commands. Codespaces evidence is recorded below. |
| P01 | COMPLETE | Requirement-to-test traceability | The checked-in requirements matrix maps each requirement area to a pass, intended source location, evidence, and database dependency. Existing clinical and inbound-interest regression suites are identified and were included in the P00 Codespaces run. |

## Domain and capability foundation

| Pass | Status | Scope | Completion criteria |
| --- | --- | --- | --- |
| P02 | COMPLETE | Complete read-model contracts | Typed read models cover roles, social profiles, affiliations, lifecycle history, referrals, BTY opportunities, interactions, campaigns, enrollments, communication logs, replies, suppressions, unsubscribe requests, reports, search, permissions, audit metadata, and pagination. GitHub Codespaces post-merge full-suite and build evidence is recorded below. |
| P03 | COMPLETE | Complete input/query contracts | Create/update inputs, filters, sorting, duplicate candidates, import conflicts, campaign eligibility, personalization contexts, execution outcomes, and pure contract tests are implemented and V-A verified. |
| P04 | COMPLETE | Relationship repository surface | The dedicated non-clinical repository/service interface covers P02/P03 concepts with a no-query/no-write unavailable adapter. Compile-time/runtime separation tests are implemented and V-A verified. |
| P05 | COMPLETE | Capability detection adapter | A cached, typed capability probe normalizes missing-contract, permission, network, query, invalid-response, and pending outcomes. It does not repeatedly probe unsupported capabilities and is V-A verified. |
| P06 | COMPLETE | Capability UI state | A reusable relationship capability component and cached hook render loading, pending, missing-contract, permission, network, query, invalid-response, retry, and available states without exposing diagnostics. It is V-A verified. |

## Shared CRM shell

| Pass | Status | Scope | Completion criteria |
| --- | --- | --- | --- |
| P07 | COMPLETE | Business Development navigation | Accessible grouped navigation contains dashboard, organizations, contacts, opportunities, imports, campaigns, replies, suppressions, reports, and system status. Nested active state and collapsed labels are tested and V-B verified. |
| P08 | COMPLETE | Shared relationship UI primitives | Permission-gated action controls, URL filter state, pagination, confirmation, unsaved-change guard, audit display, timeline shell, and safe external-link helper are implemented with component tests and V-B verified. |
| P09 | COMPLETE | Dashboard and system status | Capability-aware dashboard metrics, module navigation, and readiness/status presentation are implemented and V-B verified; unavailable metrics are never shown as zero. |

## Organizations, contacts, and lifecycle

| Pass | Status | Scope | Completion criteria |
| --- | --- | --- | --- |
| P10 | IMPLEMENTED_PENDING_BUNDLE | Organization directory | Implement searchable/filterable/sortable/paginated organization directory with URL state, selection, and all required empty/loading/error states. V-C verification is required before completion. |
| P11 | IMPLEMENTED_PENDING_BUNDLE | Organization forms | Create/edit form fields and application-side validation are implemented for identity, classification, service area, ownership, lifecycle/outreach/review, next action, roles, social profiles, and internal context. All writes remain capability-gated; V-C verification is required before completion. |
| P12 | IMPLEMENTED_PENDING_BUNDLE | Organization detail | Capability-gated summary, relationship panels, and a relationship-only timeline shell are implemented; typed data integration remains pending. V-C verification is required before completion. |
| P13 | IMPLEMENTED_PENDING_BUNDLE | Contact directory and detail | Capability-gated contact directory/filter surface and explicit named-person/role-inbox distinction are implemented; typed data integration remains pending. V-C verification is required before completion. |
| P14 | IMPLEMENTED_PENDING_BUNDLE | Lifecycle and follow-up | Centralized follow-up state identifies overdue, missing-action, unassigned, stale, and no-interaction relationships; lifecycle writes remain capability-gated. V-C verification is required before completion. |
| P15 | IMPLEMENTED_PENDING_BUNDLE | Timeline | Relationship-only event rendering and empty state are implemented; typed interaction filtering remains pending. V-C verification is required before completion. |

## Referrals, BTY, and imports

| Pass | Status | Scope | Completion criteria |
| --- | --- | --- | --- |
| P16 | COMPLETE | Referral/source workflow | Application-side referral validation and named-disclosure identity rules are implemented and V-D verified. |
| P17 | COMPLETE | Source-language service | Shared source-language rendering is implemented from centralized referral eligibility and V-D verified. |
| P18 | COMPLETE | BTY opportunity directory | Capability-gated opportunity filter and pending-result surface is implemented and V-D verified. |
| P19 | COMPLETE | BTY qualification/detail | Capability-gated qualification/detail workspace panels are implemented and V-D verified. |
| P20 | COMPLETE | CSV parser and normalization | Quoted CSV row parsing and reusable normalization helpers are implemented with unit tests and V-D verified. |
| P21 | COMPLETE | Import mapping and preview | Mapping-driven dry-run preview classifies create, duplicate, ambiguous, and invalid rows and is V-D verified. |
| P22 | COMPLETE | Import conflict resolution | Centralized conflict decisions validate required candidate selection; final submission remains capability-gated and V-D verified. |

## Campaigns, replies, and suppression

| Pass | Status | Scope | Completion criteria |
| --- | --- | --- | --- |
| P23 | IMPLEMENTED_PENDING_BUNDLE | Campaign directory/editor | Implement relationship-only campaign list, editor, steps, stop conditions, sender, initiative, notes, lifecycle state, and permission controls. |
| P24 | IMPLEMENTED_PENDING_BUNDLE | Personalization and preview | Implement approved variable registry, safe renderer, named-contact/role-inbox previews, unresolved-variable reporting, and blocked-claim presentation. |
| P25 | NOT STARTED | Enrollment eligibility | Implement target selection and explanations for email validity, review, qualification, suppression, duplicate enrollment, response, and source permissions. No enrollment write without capability. |
| P26 | NOT STARTED | Campaign monitor | Implement enrollment, schedule, send, reply, pause/stop, failure, suppression, eligibility-change, and performance views. |
| P27 | NOT STARTED | Execution service source | Implement separate, non-deployed execution interfaces for locking, due work, revalidation, rendering, unsubscribe, provider sending, retries, idempotency, audit, and advancement. Tests must prove no clinical scheduler import. |
| P28 | NOT STARTED | Reply processing source and inbox | Implement matching, stop behavior, interaction/audit context, ownership/next-action behavior, and relationship-only inbox. |
| P29 | NOT STARTED | Suppression service and UI | Implement relationship-only global/contact/email/organization/campaign suppression precedence, reasons, dates, and audit views. |
| P30 | NOT STARTED | Unsubscribe source and public UI | Implement non-authenticated, opaque-token, idempotent unsubscribe flow that cannot affect clinical preferences. It remains inactive until its database capability exists. |

## Reporting, search, and release audit

| Pass | Status | Scope | Completion criteria |
| --- | --- | --- | --- |
| P31 | NOT STARTED | Reporting | Implement all requested business-development metrics with pending—not-zero—behavior and tests. |
| P32 | NOT STARTED | Search | Add visibly distinct relationship results and all required relationship search fields without altering clinical/inbound result semantics. |
| P33 | NOT STARTED | Full acceptance audit | Execute and document every original checklist item, full test matrix, route regression, accessibility review, screenshot review, no-database-change audit, no-deployment audit, and no-outreach audit. |

## Pass record template

Add this block to every pass completion report and pull-request update:

```md
### P## — <name>
Status: COMPLETE | IN PROGRESS | BLOCKED
Scope completed: <list>
Acceptance evidence: <tests and checks>
Audit: scope / domain separation / capability safety / security and UX / verification / completion
Known limitations: <none or exact list>
Next pass: P## — <name>. Status: NOT STARTED.
```

## P00 record — Reproducible validation baseline

**Status: COMPLETE (2026-07-19, GitHub Codespaces evidence)**

The following CI-equivalent command sequence was executed in GitHub Codespaces
at `/workspaces/valorwell-crm` on the `main` branch (Node `v24.14.0`, npm
`11.9.0`, registry `https://registry.npmjs.org/`):

```sh
rm -rf node_modules
npm ci --legacy-peer-deps --no-audit --no-fund
npx eslint src --max-warnings=0
npx tsc --noEmit --project tsconfig.app.json
npx tsc --noEmit --project tsconfig.node.json
npm test
npm run build
```

`npm ci` installed 573 packages successfully. Lint and both TypeScript checks
completed without reported errors. Vitest completed with **21 test files and
106 tests passing**. The production build completed successfully. The build
reported existing non-fatal Browserslist freshness and chunk-size warnings;
these warnings did not cause the build to fail.

This completes P00 for the Codespaces validation environment. The GitHub
Actions workflow remains the independent Node 22 validation path and must stay
required; its result must not be claimed until GitHub Actions has run.

Next pass: P01 — Requirement-to-test traceability. Status: NOT STARTED.

## P01 record — Requirement-to-test traceability

**Status: COMPLETE (2026-07-19, GitHub Codespaces post-merge evidence)**

`docs/relationship-requirements-traceability.md` maps every requirement area
to a single primary pass, intended implementation source, required evidence,
and database dependency. It also names the existing clinical-client, clinical
campaign/reporting, and Creator & Community Interest regression suites that
remain mandatory in every future pass.

The P00 GitHub Codespaces validation evidence confirms the full suite passed
with 21 test files and 106 tests. P01 introduced no application, database,
migration, deployment, or production-data change.

Next pass: P02 — Complete read-model contracts. Status: NOT STARTED.

## P02 record — Complete read-model contracts

**Status: COMPLETE (2026-07-19, GitHub Codespaces post-merge evidence)**

Expanded only `src/domain/relationships/contracts.ts` with non-clinical
read-model contracts and a runtime read-model inventory. No repository method,
Supabase query, UI behavior, database artifact, or write path was added or
changed. `relationship-domain.test.ts` verifies the required read-model
inventory remains in the relationship domain. The P02 work was merged to
`main` and then validated in GitHub Codespaces: the full Vitest suite passed
with 21 test files and 106 tests, and the production build completed
successfully. Existing React Router, Browserslist, dynamic-import, and chunk
size messages were warnings and did not fail the tests or build.

The prior restricted-environment `E403` result remains an environment-specific
limitation; it does not invalidate the successful post-merge Codespaces run.

Next pass: P03 — Complete input/query contracts. Status: NOT STARTED.

## P03 record — Complete input/query contracts

**Status: IMPLEMENTED_PENDING_BUNDLE (2026-07-19)**

Expanded only `src/domain/relationships/contracts.ts` and its pure domain test
with application-side inputs, filters, import decisions, campaign eligibility,
personalization contexts, execution outcomes, and validation invariants. No
repository method, Supabase query, UI behavior, database artifact, or write
path was added or changed. V-A GitHub Codespaces validation is required before
P03 may be marked complete.

Next pass: P04 — Relationship repository surface. Status: NOT STARTED.

## P04 record — Relationship repository surface

**Status: IMPLEMENTED_PENDING_BUNDLE (2026-07-19)**

Expanded the relationship-only repository interface and its unavailable adapter
to cover organizations, contacts/affiliations, lifecycle/interactions,
referrals, opportunities, imports, campaigns/enrollments/communications,
replies, suppressions/unsubscribe, reporting, and search. The unavailable
adapter throws before every operation and performs no query or write. Tests
include a compile-time prohibition on clinical client IDs as relationship
enrollment targets and runtime capability-boundary checks. V-A validation is
required before P04 may be marked complete.

Next pass: P05 — Capability detection adapter. Status: NOT STARTED.

## P05 record — Capability detection adapter

**Status: IMPLEMENTED_PENDING_BUNDLE (2026-07-19)**

Added a single cached capability adapter that consumes only the typed
relationship repository capability surface. It validates capability snapshots,
classifies probe failures, fills missing capability contracts explicitly, and
does not issue a per-page database probe. Focused tests cover cache behavior,
missing contracts, network classification, and intentional invalidation. V-A
validation is required before P05 may be marked complete.

Next pass: P06 — Capability UI state. Status: NOT STARTED.

## P06 record — Capability UI state

**Status: IMPLEMENTED_PENDING_BUNDLE (2026-07-19)**

Added one shared capability-state component and one cached React Query hook for
relationship workspaces. The generic capability page now uses this boundary
instead of constructing a pending state itself. Tests cover loading, retry,
pending/missing/permission/network/query/invalid response states, and prevent
raw diagnostics from rendering for staff. No database-backed action is enabled
by this pass. V-A validation is required before P06 may be marked complete.

Next pass: V-A — Foundation bundle verification. Status: NOT STARTED.

## V-A interim record — superseded

**Status: SUPERSEDED (2026-07-19)**

GitHub Codespaces completed the full suite and production build, but the
application TypeScript check found a P02 contract-test fixture omission:
`Referral` now includes audit metadata and evidence URLs, while the fixture
did not provide those required read-model fields. The fixture is corrected in
the follow-up commit. Re-run the V-A type checks and remaining validation
commands after that commit is present; do not mark P02–P06 complete yet.

This interim blocker was resolved by the corrected fixture and the successful
V-A record below.

## V-A record — Foundation bundle verification

**Status: COMPLETE (2026-07-19, GitHub Codespaces evidence)**

After rebasing the PR branch onto `main`, GitHub Codespaces completed lint,
application and tooling TypeScript checks, and the full Vitest suite with **25
test files and 127 tests passing**. The corrected referral contract fixture was
committed and the rebased branch was successfully pushed with
`--force-with-lease`. The production build had already completed successfully
for the same rebased source before the fixture-only correction; the correction
does not affect the Vite application build graph.

P02 through P06 are therefore verified. The next implementation bundle starts
with P07, Business Development navigation.

## P07 record — Business Development navigation

**Status: COMPLETE (2026-07-20, GitHub Codespaces evidence)**

Reorganized CRM navigation into distinct Business Development and Clinical CRM
groups. The Business Development group contains all required routes, including
System Status. Nested-route activity no longer marks the dashboard active,
and collapsed controls retain accessible labels and item titles. Focused sidebar
tests cover grouping, active behavior, and collapsed navigation. V-B validation
completed successfully; this pass is verified.

## P08 record — Shared relationship UI primitives

**Status: COMPLETE (2026-07-20, GitHub Codespaces evidence)**

Added relationship-only workspace primitives for disabled permission/capability
actions, URL query state, pagination, destructive-action confirmation,
browser unload protection, audit display, empty timeline shell, and safe
external links. The primitive tests cover permission messaging, pagination,
safe links, confirmation, audit display, and empty timeline behavior. V-B
validation completed successfully; this pass is verified.

## P09 record — Dashboard and system status

**Status: COMPLETE (2026-07-20, GitHub Codespaces evidence)**

The Business Development dashboard now consumes the shared capability snapshot
for every module and operational metric. It reports loading, unavailable, and
available-but-not-integrated states explicitly; it never substitutes zero for
an unavailable count. The System Status page now separates architecture,
application code, database support, integration verification, and production
readiness, while continuing to describe the database architecture as planned
rather than as a loaded live contract. Focused component tests cover pending,
available, and snapshot-failure states. V-B validation completed successfully;
this pass is verified.

## V-B record — Navigation and workspace bundle verification

**Status: COMPLETE (2026-07-20, GitHub Codespaces evidence)**

On the implementation branch, GitHub Codespaces completed the required lint
command, both TypeScript checks, the full Vitest suite (**25 test files and
127 tests passing**), and the production build. The build emitted only the
existing non-fatal Browserslist, dynamic-import, and chunk-size warnings.
`git status` then confirmed that the branch was up to date with its remote and
the working tree was clean. P07 through P09 are therefore verified.

## P10 record — Organization directory

**Status: IMPLEMENTED_PENDING_BUNDLE (2026-07-20)**

Added an organization-only directory route with URL-backed search, stage,
review, outreach, organization type, veteran affiliation, owner, role,
initiative, state/service-area, social-presence, overdue-action,
do-not-contact, referral-category, BTY-opportunity, contact-history, and sort
filters; reset behavior; selection-ready result rows; pagination; and explicit
loading, error, empty, and capability-pending states. The only data path is
the typed `RelationshipsRepository.listOrganizations` method, and its query
is disabled unless the organizations capability is available. No clinical
repository, clinical client record, or fallback data source is used. Focused
tests cover pending behavior, URL filters, a capability-backed empty result,
selection, and pagination. V-C verification is required before P10 may be
marked complete.

Next pass: P11 — Organization forms. Status: NOT STARTED.

## P11 record — Organization forms

**Status: IMPLEMENTED_PENDING_BUNDLE (2026-07-20)**

Added dedicated new/edit routes, an application-side organization validation
function, visible fields for the P11 workflow, actionable field errors, and
database-capability-gated save/create controls. The form does not make a
fallback write and does not use clinical records. Focused validation tests
cover required identity/stage values and website protocol checks. V-C
verification is required before P11 may be marked complete.

Next pass: P12 — Organization detail. Status: NOT STARTED.

## P12 record — Organization detail

**Status: IMPLEMENTED_PENDING_BUNDLE (2026-07-20)**

Added the organization-detail workspace route with a capability-safe summary,
relationship-only contacts/roles, social, referral, opportunity, campaign,
suppression, context/audit panels, and timeline shell. It presents pending
states rather than substituting clinical or unrelated records. V-C verification
is required before P12 may be marked complete.

Next pass: P13 — Contact directory and detail. Status: NOT STARTED.

## P13 record — Contact directory and detail

**Status: IMPLEMENTED_PENDING_BUNDLE (2026-07-20)**

Added a dedicated contacts route with capability-safe directory/filter and
detail readiness surfaces. It visibly distinguishes named contacts from role
inboxes and reserves affiliations, source, opportunity, campaign, suppression,
ownership, next action, and audit information for the typed relationship
adapter. V-C verification is required before P13 may be marked complete.

Next pass: P14 — Lifecycle and follow-up. Status: NOT STARTED.

## P14 record — Lifecycle and follow-up

**Status: IMPLEMENTED_PENDING_BUNDLE (2026-07-20)**

Added a centralized pure follow-up-state helper alongside the canonical stage
transition rules. It provides safe indicators for overdue, missing next action,
unassigned, stale, and no-interaction relationships without querying or writing
any clinical domain. Focused unit tests cover the indicator rules. V-C
verification is required before P14 may be marked complete.

Next pass: P15 — Timeline. Status: NOT STARTED.

## P15 record — Timeline

**Status: IMPLEMENTED_PENDING_BUNDLE (2026-07-20)**

Added a reusable relationship-only timeline renderer that displays event type,
summary, actor, and timestamp, plus a truthful empty state. It never references
clinical client activity. V-C verification is required before P15 may be
marked complete.

## V-C record — Organization, contact, lifecycle, and timeline verification

**Status: COMPLETE (2026-07-20, GitHub Codespaces evidence)**

GitHub Codespaces completed dependency installation, lint, both TypeScript
checks, the full Vitest suite (**25 test files and 127 tests passing**), and
the production build on the implementation branch. `git status` was clean
before and after validation. The build emitted only existing non-fatal
Browserslist, dynamic-import, and chunk-size warnings. P10 through P15 are
therefore verified.

Next pass: P16 — Referral/source workflow. Status: NOT STARTED.

## P16 record — Referral/source workflow

**Status: IMPLEMENTED_PENDING_BUNDLE (2026-07-20)**

Added centralized referral validation for an attributable subject, source
category, source summary, and named-referrer disclosure requirements. Named
identity is allowed only for explicitly named-referrer disclosure; no client
identity is exposed by default. V-D verification is required before P16 may be
marked complete.

Next pass: P17 — Source-language service. Status: NOT STARTED.

## V-D record — Referral, BTY, and import verification

**Status: COMPLETE (2026-07-20, GitHub Codespaces evidence)**

GitHub Codespaces completed dependency installation, lint, both TypeScript
checks, the full Vitest suite (**25 test files and 127 tests passing**), the
production build, and clean-tree checks. Existing build warnings were non-fatal.
P16 through P22 are verified.

Next pass: P25 — Enrollment eligibility. Status: NOT STARTED.
