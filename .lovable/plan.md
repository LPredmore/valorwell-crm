# ValorWell CRM — Pre-Supabase Application Implementation

**Approach:** Full frontend overhaul built against a mock data provider.
No Supabase reads/writes for new features. Legacy pat_status code paths
left untouched but no new work depends on them.

## Batch 1 — Foundation (COMPLETE)

Shipped:

- `src/domain/canonical.ts` — Canonical client model: Lifecycle, Engagement,
  Eligibility, ContactPolicy, ServicePolicy, CareCadence, Risk, Closure.
  Independent of Supabase types.
- `src/domain/operations.ts` — Task, Exception, Campaign, Enrollment,
  Communication, Staff, Audit, CommunicationPolicyResult.
- `src/repositories/types.ts` — `CrmDataProvider` interface. Every future
  Supabase adapter must satisfy this.
- `src/mocks/dataset.ts` — Realistic mock dataset: 120 clients across every
  lifecycle stage / engagement / eligibility / contact-policy / service-policy
  combination; 6 staff; 3 campaigns; 40 tasks; 24 exceptions; messages inc.
  a `STOP` inbound.
- `src/repositories/mock/index.ts` — In-memory mock provider implementing
  every method with subscribe-emit so mock mutations feel real. Includes
  end-to-end REMOVE-keyword handling and communication policy evaluator.
- `src/services/dataProvider.ts` — Single switch selecting mock provider.
- `src/hooks/canonical/useCanonicalClients.ts` — Query + mutation hooks for
  every canonical client state change.
- `src/hooks/canonical/useCrmData.ts` — Query hooks for tasks, exceptions,
  campaigns, enrollments, staff, audit, communications, reports.
- `docs/supabase-integration-contract.md` — Handoff contract for the future
  Supabase phase. Describes the required entities, queries, mutations,
  events, reports, policy evaluator, error shape, pagination, RLS,
  idempotency, and audit expectations.
- `src/test/mock-provider.test.ts` — 13 passing tests covering canonical
  client workflows, communication policy (DNC + critical override), REMOVE
  keyword, task lifecycle, exception resolution, campaign enrollment/cancel,
  and report rendering.

## Batch 2 — Pages & UI (COMPLETE)

Shipped canonical pages (all under `/crm/canonical/*`):
Dashboard, Clients (table + kanban + filters), ClientDetail (7 tabs incl.
mutations), Tasks (11 saved views + bulk), Exceptions, Campaigns list +
per-campaign detail with enrollments (pause/resume/cancel/restart) and step
inspector, Inbox with policy-aware composer, Staff, Reports, and global
Search. All bound to the mock provider — zero Supabase reads/writes.
Communications composer runs the policy evaluator on open and blocks/warns
based on suppression code before send.

## Explicit non-goals for this phase

- No Supabase reads/writes for new features.
- No ClickUp client/staff sync.
- No `supabase as any` shortcuts.
- No "backend unavailable" placeholder messaging.
- No mutation of existing `pat_status` code paths.

## Workstream 2 — Canonical Supabase surface (COMPLETE)

Live in Supabase (additive, no changes to existing shared columns):
- `crm_client_canonical_meta` — CRM-only per-client meta: concurrency token, risk_reason, at_risk_marked_at. RLS: tenant admin/staff read.
- `crm_client_state_audit` — append-only audit of every canonical state change (dimension enum, from→to, reason, disposition_reason, actor, correlation_id, source). RLS: tenant admin/staff read.
- `crm_idempotency_keys` — 24h de-dup for canonical writes. RLS: actor-scoped read.
- `v_client_canonical_state` — single canonical read model joining `clients` + meta, exposing concurrency_token.
- `crm_has_role(user, tenant)` helper — checks user_roles ∈ (admin,staff) AND tenant_memberships membership.
- RPCs (all admin/staff gated, concurrency-checked, audited, idempotent):
  `transition_client_lifecycle`, `set_client_engagement_state`,
  `set_client_contact_policy`, `set_client_service_policy`,
  `set_client_eligibility_state`, `set_client_care_cadence`,
  `set_client_disposition`.

Frontend still on mock provider. Next: implement the Supabase adapter for `ClientsRepository` reading from `v_client_canonical_state` and writing through these RPCs, then flip `useMock`.

## Workstream 3 — Supabase ClientsRepository adapter (COMPLETE)

- `src/repositories/supabase/clients.ts` — real adapter:
  - Reads directly from `public.clients` (identity, contact, canonical dims,
    tags, activity) with server-side filtering/sorting/pagination.
  - Concurrency tokens fetched from `v_client_canonical_state`.
  - Writes route through the 7 canonical RPCs (lifecycle, engagement,
    contact/service policy, eligibility, care cadence, disposition, reopen).
  - Uses the domain ↔ db mappers only — no `pat_status`.
- `src/repositories/supabase/index.ts` — hybrid provider (Supabase for
  clients, mock for the rest until their tables/RPCs ship).
- `src/services/dataProvider.ts` — default flipped to Supabase; opt out
  with `VITE_USE_MOCK_DATA=true`.

Assignment RPCs and manual risk override intentionally throw — pending
Workstream 4 (assignments) and Workstream 5 (risk RPCs).

## Workstream 4/5 — Assignment + Risk RPCs (COMPLETE)

- New Supabase RPCs: `assign_client_clinician`, `set_client_risk` — both
  admin/staff gated, concurrency-checked, idempotent, audited.
- `set_client_risk` also updates `crm_client_canonical_meta.risk_reason` and
  `at_risk_marked_at`.
- Adapter wired: `assignClinician` and `updateRisk` now hit the RPCs.
- `assignOperationsOwner` still throws — no operations-owner column exists
  on `clients` and adding one would be non-additive. Handled at UI level.

## Workstream 6 — Tasks & Exceptions on Supabase (COMPLETE)

Migration:
- New enums: `crm_task_status_enum`, `crm_task_priority_enum`,
  `crm_task_type_enum`, `crm_exception_type_enum`,
  `crm_exception_severity_enum`, `crm_exception_status_enum`.
- New tables: `crm_tasks`, `crm_exceptions` — tenant-scoped, RLS on with
  admin/staff read/write policies, updated_at triggers, useful indexes.

Adapters:
- `src/repositories/supabase/tasks.ts` — full TasksRepository against
  `crm_tasks` with domain ↔ db enum mappers, filter/sort/paged list, and
  bulk mutations.
- `src/repositories/supabase/exceptions.ts` — full ExceptionsRepository,
  including `createTaskFromException` which inserts a linked `crm_tasks`
  row inheriting client/campaign/owner and severity → priority mapping.
- `src/repositories/supabase/index.ts` — hybrid provider now serves
  clients, tasks, and exceptions from Supabase.
