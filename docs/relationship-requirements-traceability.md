# Business Development requirements traceability matrix

This matrix is the P01 control document. It maps the requested Business
Development / BTY application requirements to one primary delivery pass,
intended implementation locations, required automated evidence, and its
database dependency. A pass cannot be completed until its mapped evidence is
implemented and passing.

## Legend

* **DB gated** means the UI/service may be implemented but must remain disabled
  until the separate typed relationship database adapter reports support.
* **No DB** means pure application contracts, rendering, parsing, or tests.
* Source paths marked `planned` do not exist yet and must be introduced only by
  the mapped pass.

| Requirement area | Primary pass | Intended source location | Required evidence | Dependency |
| --- | --- | --- | --- | --- |
| Scope restrictions, no clinical/inbound/local-storage substitution | P04, P33 | `src/repositories/relationships.ts`, `src/repositories/relationships-unavailable.ts` | isolation contract tests; final static import audit | No DB |
| Routing, CRM conventions, staff access, test/CI baseline | P00, P01, P07, P33 | `.github/workflows/ci.yml`, `docs/` | CI command evidence; route and regression tests | No DB |
| Dedicated relationship application boundary | P04 | `src/repositories/relationships.ts`, `src/services/relationships/` (planned) | repository surface and clinical-separation tests | No DB |
| Stable application contracts | P02, P03 | `src/domain/relationships/contracts.ts` | contract unit/type tests | No DB |
| Capability detection and failure classes | P05, P06 | `src/domain/relationships/capabilities.ts`, `src/services/relationships/capability-adapter.ts` (planned) | pending/missing/permission/network/query/invalid tests | DB gated |
| Dashboard, readiness language, architecture status | P09 | `src/pages/crm/business-development/` | dashboard/status component tests | DB gated |
| Business Development navigation and active/collapsed behavior | P07 | `src/components/crm/layout/CrmSidebar.tsx`, `src/App.tsx` | route/sidebar accessibility tests | No DB |
| Organization directory, filtering, sorting, paging, URL state, selection | P10 | `src/pages/crm/business-development/organizations/` (planned) | directory filter/sort/paging tests | DB gated |
| Organization create/edit validation and safe writes | P11 | `src/pages/crm/business-development/organizations/` (planned) | form, validation, permission, capability tests | DB gated |
| Organization detail workspace | P12 | `src/pages/crm/business-development/organizations/` (planned) | detail/loading/error/pending tests | DB gated |
| Contact directory, named person vs role inbox, affiliations/detail | P13 | `src/pages/crm/business-development/contacts/` (planned) | rendering/filter/affiliation tests | DB gated |
| Relationship lifecycle, transitions, next actions, stale/overdue indicators | P14 | `src/domain/relationships/lifecycle.ts` (planned), `src/pages/crm/business-development/` | transition and follow-up tests | DB gated |
| Relationship interaction timeline | P15 | `src/components/crm/relationships/RelationshipTimeline.tsx` (planned) | timeline type/date/rendering tests | DB gated |
| Referral recording, source evidence, verification, disclosure permissions | P16 | `src/pages/crm/business-development/referrals/` (planned) | disclosure and sensitive-access tests | DB gated |
| Approved referral/source language shared by preview/enrollment/rendering | P17 | `src/services/relationships/source-language.ts` (planned) | verified/anonymous/named/revoked/internal tests | No DB |
| BTY opportunity directory | P18 | `src/pages/crm/business-development/opportunities/` (planned) | search/filter/status tests | DB gated |
| BTY qualification/detail and risk/fit/status workflow | P19 | `src/pages/crm/business-development/opportunities/` (planned) | qualification and transition tests | DB gated |
| CSV parsing, validation, size limits, normalization | P20 | `src/services/relationships/imports/` (planned) | malformed/quoted CSV and normalizer tests | No DB |
| Import mapping, dry run, duplicate detection | P21 | `src/pages/crm/business-development/imports/` (planned) | mapping/preview/duplicate tests | DB gated |
| Import conflict decisions and final capability-gated submission | P22 | `src/pages/crm/business-development/imports/` (planned) | conflict decision and disabled-submit tests | DB gated |
| Relationship campaign directory/editor | P23 | `src/pages/crm/business-development/campaigns/` (planned) | editor/state/permission tests | DB gated |
| Personalization variables and campaign preview | P24 | `src/services/relationships/personalization.ts` (planned) | named/role inbox/unknown/missing/blocked claim tests | No DB |
| Enrollment eligibility and target selection | P25 | `src/services/relationships/enrollment-eligibility.ts` (planned) | valid email/review/suppression/duplicate/source tests | DB gated |
| Campaign monitor | P26 | `src/pages/crm/business-development/campaigns/` (planned) | enrollment/send/reply/error state tests | DB gated |
| Separate campaign execution source | P27 | `src/services/relationships/execution/` (planned) | idempotency/retry/concurrency/suppression/no-clinical-import tests | DB gated; not deployed |
| Reply processing and relationship-only inbox | P28 | `src/services/relationships/replies/` and `src/pages/crm/business-development/replies/` (planned) | reply-match/stop/follow-up/inbox tests | DB gated; not deployed |
| Relationship suppressions | P29 | `src/services/relationships/suppression.ts` and `src/pages/crm/business-development/suppressions/` (planned) | precedence/reason/audit tests | DB gated |
| Standalone unsubscribe flow | P30 | `src/pages/relationship-unsubscribe/` and `src/services/relationships/unsubscribe.ts` (planned) | token/privacy/idempotency/clinical-isolation tests | DB gated; not deployed |
| Business Development reporting | P31 | `src/pages/crm/business-development/reports/` (planned) | metric/pending-not-zero tests | DB gated |
| Relationship search | P32 | `src/pages/crm/canonical/CanonicalSearch.tsx`, `src/services/relationships/search.ts` (planned) | result-domain and field-search tests | DB gated |
| Full release verification, screenshots, no-change audit | P33 | `docs/`, `.github/workflows/ci.yml` | full acceptance checklist and route regression evidence | No DB |

## Required existing-regression suites

These tests protect the systems that must remain separate and working while
Business Development is introduced. They are required in every future pass in
addition to that pass's focused tests:

| Protected area | Existing test files | What they protect |
| --- | --- | --- |
| Canonical clinical client state and mutations | `canonical-client-state-adapter.test.ts`, `canonical-rpc-transport.test.ts`, `canonical-mutation-retry.test.tsx`, `client-mutations-actual-path.test.tsx`, `client-list-composition.test.ts`, `supabase-clients-list-repository.test.ts`, `clinician-assignment.test.ts` | Clinical canonical reads, RPC writes, list behavior, and clinician assignment remain unchanged. |
| Clinical campaigns, communications, and reporting | `mock-provider.test.ts`, `canonical-reports-page.test.tsx`, `supabase-reports-repository.test.ts`, `report-source-contract.test.ts`, `use-reports-tenant.test.tsx` | Client campaign enrollment/policy behavior and clinical reporting sources remain separate. |
| Creator & Community Interest inbound workflow | `creator-community-interest-helpers.test.ts`, `creator-community-interest-query.test.tsx`, `creator-community-interest-mutations.test.tsx`, `creator-community-interest-queue.test.tsx`, `creator-community-interest-detail.test.tsx`, `crm-interest-route-authorization.test.tsx` | Inbound interest remains a distinct queue, query/mutation path, and authorized route. |

## P01 verification record

The P00 GitHub Codespaces run completed the entire suite with 21 test files and
106 tests passing. That run includes the existing regression suites listed
above. P01 adds this traceability control and does not alter application code,
database configuration, migrations, or production records.

Next pass: P02 — Complete read-model contracts. Status: NOT STARTED.
