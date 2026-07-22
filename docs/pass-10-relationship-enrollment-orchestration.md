# Pass 10 — Relationship campaign enrollment and orchestration foundation

## Scope

Pass 10 establishes the non-clinical Business Development campaign enrollment and dormant orchestration layer in Billing Hub and `valorwell-crm`.

It includes:

- Preliminary recipient eligibility evaluation and deterministic contact resolution.
- Required contact-backed enrollments for contact, organization, and BTY opportunity targets.
- Immutable recipient, personalization, source-language, and eligibility snapshots.
- Verified source-language modes bound to matching verified, non-revoked referral evidence.
- Enrollment lifecycle states and append-only event evidence.
- Campaign-defined timezone, weekday, send-window, and per-step delay planning.
- Service-only due-work storage, `SKIP LOCKED` claiming, leases, retry ceilings, idempotent results, and ordered step advancement.
- Operator workflows for evaluation, pending enrollment creation, filtering, pause, resume, stop, and event review.
- Relationship timeline entries for enrollment and stop actions.

## Hard execution boundary

Pass 10 preserves three independent database gates:

1. `relationship_campaigns.execution_enabled = false`
2. `relationship_campaign_enrollments.delivery_enabled = false`
3. `relationship_campaign_enrollments.safety_status = 'pending_pass_11'`

The service claim function requires all three gates to be enabled or ready. Therefore Pass 10 cannot claim due work in production.

Pass 10 does not:

- send email or call a delivery provider;
- create canonical communication records;
- process inbound replies;
- create unsubscribe tokens or requests;
- evaluate the final suppression precedence model;
- use clinical CRM campaigns, enrollments, communications, notes, activities, or schedulers.

## Eligibility boundary

Preliminary enrollment eligibility can reject:

- inactive or missing campaigns;
- unresolved, ambiguous, missing, or cross-context contacts;
- missing email addresses;
- contact or organization do-not-contact state;
- unqualified or unapproved BTY opportunities;
- duplicate active enrollments or previous responses;
- unsupported source language;
- verified source language without matching verified referral evidence.

A preliminarily eligible target remains safety-ineligible until Pass 11 implements and verifies suppression and unsubscribe controls.

## Orchestration safety

- Due work is unique by enrollment and campaign step.
- Claims use row locking with `SKIP LOCKED` and expiring leases.
- Attempt counts cannot exceed configured retry ceilings.
- Exhausted expired leases fail the work item and enrollment.
- Retry timing is explicit and caller supplied.
- Result idempotency is bound to one exact work item.
- Advancement plans only the next active ordered step.
- No provider or communication side effect exists in the orchestration functions.

## Verification

Authenticated rollback testing covers preliminary eligibility, atomic enrollment, idempotent enrollment replay, pause and resume, locked zero-work claims, retry scheduling, ordered two-step advancement, terminal completion, idempotent result replay, event evidence, and cleanup.

Static verification covers tenant-scoped RLS, direct-write denial, anonymous RPC denial, service-only worker functions, foreign-key indexes, and restoration of every execution, safety, and delivery lock after rollback testing.
