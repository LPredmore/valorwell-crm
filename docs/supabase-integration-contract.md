# ValorWell CRM — Supabase Integration Contract

**Status:** Handoff specification. The application currently runs entirely on
the mock provider (`src/repositories/mock`). This document describes what the
future Supabase-backed provider must satisfy. Nothing here was validated
against the live Supabase project.

**Contract owner:** CRM application. The database must adapt to this contract;
this document must not be adjusted to match an existing schema.

---

## 1. Data provider surface

The Supabase adapter must implement every method of `CrmDataProvider`
(`src/repositories/types.ts`) with identical signatures and semantics.

Any deviation is a breaking change and must be versioned.

## 2. Canonical domain entities

Source of truth: `src/domain/canonical.ts` and `src/domain/operations.ts`.

### 2.1 CanonicalClient
Every field listed on the `CanonicalClient` interface must be resolvable for
every client row. The following state dimensions are strictly independent —
none may be collapsed into a single generic status column:

- `lifecycle` (`LifecycleStage`)
- `engagement` (`EngagementState`)
- `eligibility` (`EligibilityState`)
- `contactPolicy` (`ContactPolicy`)
- `servicePolicy` (`ServicePolicy`)
- `careCadence` (`CareCadence`)
- `risk` (`RiskState`)
- `closure` (`ClosureInfo`, present only when lifecycle is `Closed`)

### 2.2 Tasks, Exceptions, Campaigns, Communications, Staff, Audit
See interface definitions. The database must expose enums or lookups for every
enumerated string in the domain types.

## 3. Required query operations

Each list operation must accept filtering, sorting, and pagination as
declared in the repository interface. The clients list must additionally
support server-side full-text search across name, preferred name, email,
phone, and identifier.

## 4. Required mutation operations

All mutating client operations must:

1. Be idempotent using a request-supplied idempotency key.
2. Emit an event to the audit log with previous value, new value, actor,
   source, correlation id, and reason (when applicable).
3. Refuse illegal transitions and return a structured error (see §9).

Communication sends must additionally run the send-time suppression guard
described in §7 before writing an outbound row.

## 5. Required event history

The audit log must persist every entry emitted by mutations, plus:

- Lifecycle transitions
- Engagement transitions
- Eligibility state changes
- Contact policy changes
- Service policy changes
- Cadence changes
- Risk marks and clears
- Closure and reopen events
- Assignment changes
- Communication sends, deliveries, failures, suppressions
- Inbound communications and opt-out keyword detections
- Campaign enrollment lifecycle events
- Task lifecycle events
- Exception lifecycle events

Records must include automated-vs-manual, actor label, source system, and a
correlation id linking related events across services.

## 6. Required reporting datasets

The reporting repository requires these canonical read models:

- Journey funnel by lifecycle stage (counts + median days in stage)
- At-risk metrics (totals, aging, by-reason, by-stage, overdue interventions)
- Engagement counts, transitions, reengagement rate
- Closure by reason
- Campaign performance (enrollments, sent, delivered, responded, completed,
  suppressed, failed, opted-out) per campaign
- Task performance (open, overdue, avg completion time, per-owner workload)
- Exception metrics (by-type, by-severity, open vs resolved, avg resolution)

## 7. Communication policy evaluation

The Supabase adapter must expose an evaluator with the same shape as
`CommunicationsRepository.evaluatePolicy`. It must consider:

- `contactPolicy = Do Not Contact` (blocks anything except
  `critical_operational`)
- `servicePolicy = Service Blocked` (blocks `ordinary_campaign_follow_up`)
- Lifecycle `Closed` (blocks `ordinary_campaign_follow_up`)
- Channel restrictions (missing phone / email)
- Quiet hours per client timezone
- Duplicate-send suppression window

Every outbound message must be evaluated at send-time. Failed evaluations
must persist a `suppressed` row with the reason so the UI can display it.

## 8. Campaign operations

- Suppressable message classes must respect the guard defined in §7.
- Enrollment mutations (enroll, pause, resume, cancel, restart) must be
  atomic and idempotent.
- Inbound opt-out keywords (`STOP`, `REMOVE`, `UNSUBSCRIBE`, `QUIT`, `END`,
  `CANCEL`, case-insensitive, whitespace-tolerant, exact-match line) must:
  1. Set contact policy to `Do Not Contact`.
  2. Cancel all active enrollments for that client with a canonical
     `exit_reason`.
  3. Emit audit events.
  4. Return the resulting canonical client state.

## 9. Error shape

All repository methods must reject with an `Error` whose `.message` is safe
to log and whose optional `.cause` carries a structured error object:

```ts
type CrmError = {
  code:
    | 'not_found'
    | 'forbidden'
    | 'illegal_transition'
    | 'validation_failed'
    | 'conflict'
    | 'suppressed'
    | 'rate_limited'
    | 'upstream_unavailable';
  message: string;
  field?: string;
  correlationId?: string;
};
```

## 10. Pagination

List operations must accept `page` and `pageSize`, defaulting to page 1 and
50. Responses must include `total`, `page`, and `pageSize` so the UI can
render pagination controls without a second query.

## 11. Authorization

Row Level Security must scope every read and write by `tenant_id`. Every
canonical write must additionally check the acting profile has the CRM role
`admin` or `staff` for that tenant. Reporting reads may be restricted to
`admin` at the discretion of the tenant configuration.

## 12. Idempotency

All mutating operations must accept a client-supplied `Idempotency-Key`
header (or equivalent JSON field). Repeated requests within a 24-hour window
must return the original result without re-applying side effects.

## 13. Audit requirements

Every mutation must be traceable to:

- Acting profile id
- Client id (when applicable)
- Actor label (human-friendly)
- Source system
- Correlation id
- Reason (required for lifecycle transitions, closures, contact policy
  changes, service policy changes, and manual overrides)

## 14. What the adapter must NOT do

- No `pat_status` reads. The legacy status column must be treated as
  deprecated and never surfaced through the canonical adapter.
- No inference of eligibility from lifecycle, or of risk from engagement.
- No silent fallback to legacy columns when a canonical view is missing —
  return a structured `upstream_unavailable` error instead.
- No client-side role gating. Roles must be evaluated server-side.

---

## Handoff checklist

The Supabase phase is complete when:

1. Every `CrmDataProvider` method has a Supabase implementation.
2. `src/services/dataProvider.ts` can flip to the Supabase provider via env
   flag with no other code changes.
3. All frontend tests continue to pass against the mock provider.
4. All frontend workflows pass an integration test against the Supabase
   provider.
5. Idempotency, RLS, and audit requirements are verified by backend tests.
