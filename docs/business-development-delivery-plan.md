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
| P03 | IMPLEMENTED_PENDING_BUNDLE | Complete input/query contracts | Create/update inputs, filters, sorting, duplicate candidates, import conflicts, campaign eligibility, personalization contexts, execution outcomes, and pure contract tests are implemented. V-A verification is required before completion. |
| P04 | IMPLEMENTED_PENDING_BUNDLE | Relationship repository surface | The dedicated non-clinical repository/service interface covers P02/P03 concepts with a no-query/no-write unavailable adapter. Compile-time/runtime separation tests are implemented; V-A verification is required before completion. |
| P05 | IMPLEMENTED_PENDING_BUNDLE | Capability detection adapter | A cached, typed capability probe normalizes missing-contract, permission, network, query, invalid-response, and pending outcomes. It does not repeatedly probe unsupported capabilities; V-A verification is required before completion. |
| P06 | NOT STARTED | Capability UI state | Replace generic pending behavior with reusable capability, loading, empty, error, and retry states. Test every backend-failure classification without exposing raw diagnostics to staff. |

## Shared CRM shell

| Pass | Status | Scope | Completion criteria |
| --- | --- | --- | --- |
| P07 | NOT STARTED | Business Development navigation | Create an accessible grouped navigation section with dashboard, organizations, contacts, opportunities, imports, campaigns, replies, suppressions, reports, and system status. Test nested active state and collapsed labels. |
| P08 | NOT STARTED | Shared relationship UI primitives | Implement permission-gated action controls, URL filter state, pagination, confirmation, unsaved-change guard, audit display, timeline shell, and safe external-link helper with component tests. |
| P09 | NOT STARTED | Dashboard and system status | Implement capability-aware dashboard metrics, module navigation, and readiness/status presentation. Test available, pending, permission, and failure states; never show unavailable metrics as zero. |

## Organizations, contacts, and lifecycle

| Pass | Status | Scope | Completion criteria |
| --- | --- | --- | --- |
| P10 | NOT STARTED | Organization directory | Implement searchable/filterable/sortable/paginated organization directory with URL state, selection, and all required empty/loading/error states. |
| P11 | NOT STARTED | Organization forms | Implement create/edit validation for identity, classification, service area, ownership, lifecycle/outreach/review, next action, sources, roles, and social profiles. All writes capability- and permission-gated. |
| P12 | NOT STARTED | Organization detail | Implement summary, contacts, roles, social profiles, referrals, opportunities, campaign history, suppression, notes/context, audit, duplicates, and timeline panels. |
| P13 | NOT STARTED | Contact directory and detail | Implement filters/sorting plus named-person and role-inbox rendering, affiliations, source history, permissions, opportunities, campaign history, suppression, ownership, and next action. |
| P14 | NOT STARTED | Lifecycle and follow-up | Implement stage definitions, valid transition controls/context/history, owner and next-action controls, and overdue/unassigned/stale/missing-action indicators. |
| P15 | NOT STARTED | Timeline | Implement relationship-only interaction timeline event rendering and type/date filters; verify it never uses client activity storage. |

## Referrals, BTY, and imports

| Pass | Status | Scope | Completion criteria |
| --- | --- | --- | --- |
| P16 | NOT STARTED | Referral/source workflow | Implement recording, evidence, verification, revocation, disclosure, audit, and sensitive-source permission controls. |
| P17 | NOT STARTED | Source-language service | Implement one shared source-language eligibility/rendering service used by preview, enrollment, and message rendering. Test all disclosure/revocation cases. |
| P18 | NOT STARTED | BTY opportunity directory | Implement required opportunity search/filter/sort/status views and capability states. |
| P19 | NOT STARTED | BTY qualification/detail | Implement qualification evidence, risk/fit evaluation, status transitions, outreach/reply history, owner/next action, and detail workspace. |
| P20 | NOT STARTED | CSV parser and normalization | Implement robust quoted CSV parsing, file limits, headers/row errors, and all requested normalization helpers with unit tests. |
| P21 | NOT STARTED | Import mapping and preview | Implement active-session mapping, dry-run preview, exact/ambiguous duplicate detection, and excluded/invalid-row presentation. |
| P22 | NOT STARTED | Import conflict resolution | Implement link/create/exclude/correct/defer decisions and a capability-gated final submission adapter. |

## Campaigns, replies, and suppression

| Pass | Status | Scope | Completion criteria |
| --- | --- | --- | --- |
| P23 | NOT STARTED | Campaign directory/editor | Implement relationship-only campaign list, editor, steps, stop conditions, sender, initiative, notes, lifecycle state, and permission controls. |
| P24 | NOT STARTED | Personalization and preview | Implement approved variable registry, safe renderer, named-contact/role-inbox previews, unresolved-variable reporting, and blocked-claim presentation. |
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
