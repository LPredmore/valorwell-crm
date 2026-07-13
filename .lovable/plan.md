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

## Batch 2 — Pages & UI (in progress)

Next: canonical client list, canonical kanban, canonical detail page tabs
(Overview/Journey/Communications/Tasks/Campaigns/Eligibility/Audit),
Tasks page, Exceptions page, Campaign builder & scheduler dashboard,
communications SMS/Email + policy-aware composer, Reports page, Staff &
assignment workflows, dashboard, global search.

## Explicit non-goals for this phase

- No Supabase reads/writes for new features.
- No ClickUp client/staff sync.
- No `supabase as any` shortcuts.
- No "backend unavailable" placeholder messaging.
- No mutation of existing `pat_status` code paths.
