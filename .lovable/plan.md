# ValorWell CRM — Current Operating Contract

## Canonical infrastructure

- **Billing Hub** is the only Supabase project used by this application.
- The Supabase-backed repositories under `src/repositories/supabase` are the production data path.
- Mock repositories exist for tests and isolated development only. Production code must never silently fall back to mock data when Billing Hub is unavailable.
- `supabase/config.toml`, frontend environment variables, Edge Functions, migrations, and generated types must remain aligned with Billing Hub.

## Repository ownership

This repository owns the CRM application, Billing Hub database migrations used by CRM workflows, and CRM-operated Edge Functions.

The public website repository may own narrowly scoped website support functions, but all of those functions must execute against Billing Hub. Website database migrations, duplicate CRM functions, and compatibility clients are prohibited.

## Communication architecture

- Resend is the canonical outbound email provider for CRM and relationship outreach.
- RingCentral is the canonical SMS provider.
- New Help Scout sending paths must not be introduced. Any remaining Help Scout deployment is legacy infrastructure and is not the source of truth for CRM communications.
- Every outbound communication must use the applicable policy, suppression, audit, and idempotency controls.

## Canonical data rules

- Use canonical lifecycle, engagement, eligibility, contact-policy, service-policy, cadence, risk, closure, assignment, task, exception, communication, and campaign contracts.
- Do not restore direct writes to deprecated aggregate status fields.
- Do not substitute clinical clients for Business Development organizations or contacts.
- Do not substitute inbound website-interest records for outbound relationship records.
- Protected mutations must remain tenant-scoped, authorized server-side, auditable, and idempotent.

## Website intake boundary

Public website submissions are written to Billing Hub through constrained RPCs or website-specific Edge Functions. CRM is responsible for review, ownership, outreach, and lifecycle management after ingestion.

## Required validation

Every pull request must pass:

1. Billing Hub repository-boundary guard.
2. ESLint.
3. Application and tooling TypeScript checks.
4. Full automated test suite.
5. Production build.

Changes touching migrations, RLS, privileged functions, Auth, or Edge Functions also require live Billing Hub verification and Supabase security-advisor review before they are considered production-complete.

## Prohibited regressions

- A second Supabase project URL or project reference.
- Legacy compatibility client constants.
- Production mock-provider fallback.
- Website-owned CRM schema migrations.
- Direct client-side authorization as the sole access control.
- New Help Scout communication dependencies.
- Reintroduction of retired creator/influencer application workflows.
