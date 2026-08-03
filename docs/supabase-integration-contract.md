# ValorWell CRM — Billing Hub Integration Contract

**Status:** Active production contract.

Billing Hub is the canonical Supabase backend for the ValorWell CRM. The production application uses the Supabase repositories under `src/repositories/supabase`; the mock provider is limited to tests and isolated development fixtures.

## 1. Connection contract

The frontend must create its Supabase client from:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Both values must identify Billing Hub. Hard-coded fallback URLs, a second Supabase client for a retired project, and compatibility routing are prohibited.

`supabase/config.toml` must identify Billing Hub. Edge Functions must use their project-provided `SUPABASE_URL` and service credentials rather than embedding another project URL.

## 2. Production repository behavior

`src/services/dataProvider.ts` selects the Supabase provider for production. Missing tables, functions, permissions, or network access must produce an explicit error. Production code must not replace unavailable Billing Hub data with mock records.

Every `CrmDataProvider` surface must retain its typed contract for clients, tasks, exceptions, campaigns, communications, staff, audit, reporting, and relationship operations.

## 3. Canonical client state

The following dimensions remain independent and must not be collapsed into a single generic status:

- lifecycle
- engagement
- eligibility
- contact policy
- service policy
- care cadence
- risk
- closure
- clinician assignment

Deprecated aggregate status fields may be read only where a controlled compatibility adapter explicitly requires them. They must not become the write authority.

## 4. Mutations and authorization

Protected mutations must:

1. Resolve the acting authenticated profile and tenant server-side.
2. Verify the required capability or role server-side.
3. Validate legal state transitions.
4. Accept an idempotency key.
5. emit an audit event containing actor, source, reason, correlation information, previous value, and resulting value where applicable.
6. Return a structured, staff-safe error on failure.

Client-side role checks may improve user experience but are never the sole authorization control.

## 5. Communications

- Resend is the canonical CRM email provider.
- RingCentral is the canonical CRM SMS provider.
- Every outbound send must evaluate the current communication policy and suppression state immediately before sending.
- Message persistence, provider delivery identifiers, failures, replies, opt-outs, and campaign transitions must remain auditable.
- New Help Scout sending paths are prohibited.

## 6. Clinical and relationship separation

Business Development organizations, contacts, referrals, opportunities, campaigns, replies, and suppressions must use their dedicated relationship contracts. They must not be stored in clinical client records or clinical campaign tables.

Inbound website-interest queues remain distinct from outbound relationship-development records. Conversion between lanes must be explicit and auditable.

## 7. Website intake

Public ValorWell website submissions enter Billing Hub through constrained RPCs or website-specific Edge Functions. Anonymous callers must not receive direct broad table access. Server-side validation, consent handling, deduplication, rate limiting or honeypot controls, and generic public errors must be retained.

The website repository does not own Billing Hub schema migrations.

## 8. RLS and exposed APIs

Every table in an exposed schema must have RLS enabled and appropriate grants. Policies must enforce tenant or ownership predicates rather than relying only on `TO authenticated`.

Privileged `SECURITY DEFINER` functions must revoke default `PUBLIC` execution, grant only intended roles, set a controlled `search_path`, and perform explicit authorization checks.

## 9. Migration and Edge Function delivery

Database changes belong in reviewed CRM/backend migrations and must be verified against live Billing Hub after deployment. Edge Function source must have one canonical repository owner; duplicate function names across repositories are prohibited unless a documented release process requires them.

Before production completion:

- run the Billing Hub repository-boundary guard;
- run lint, both TypeScript checks, tests, and build;
- verify changed RPCs/functions against live Billing Hub;
- run Supabase security and performance advisors for schema changes;
- record any remaining deployment drift.

## 10. Prohibited behavior

- Any Supabase project other than Billing Hub.
- Hard-coded retired project URLs or keys.
- Production fallback to mock data.
- Website-owned CRM database migrations.
- Direct writes that bypass canonical mutation contracts.
- Clinical/relationship data substitution.
- New Help Scout dependencies.
- Anonymous access to protected CRM or clinical records.
