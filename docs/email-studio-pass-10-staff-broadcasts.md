# Email Studio Pass 10 — Internal staff broadcasts

## Scope

Pass 10 replaces the creation and delivery path for new staff bulk email with staff-scoped Newsletter-mode Email Studio. Historical staff bulk jobs remain unchanged and auditable.

This is an internal operational communication surface. It is separate from client newsletters and relationship outreach.

## Live baseline

Before implementation, Billing Hub contained:

- 10 historical staff bulk jobs
- 31 historical staff recipient rows
- 22 successful historical deliveries
- 9 failed historical deliveries
- zero canonical staff broadcast jobs
- zero pending or in-progress staff jobs

All historical staff jobs used legacy HTML/text content.

## Recipient rules

The Staff page allows authorized CRM communicators to select staff members who:

- belong to the active tenant
- have a valid profile email address
- are not in the canonical `Inactive` clinician lifecycle status

`Invited`, `New`, and `Active` staff remain eligible because internal onboarding, training, and operational notices may legitimately apply before provider activation.

The transactional creation RPC repeats these checks. The delivery worker repeats them again immediately before provider delivery.

## Staff content scope

Pass 10 adds a staff-only authoring scope with these variables:

- `staff_first_name`
- `staff_last_name`
- `staff_display_name`
- `staff_role`
- `sender_name`

Client, relationship, unsubscribe, and postal-address variables are rejected in staff content.

Staff broadcasts use Newsletter mode for structured multi-recipient content, but they do not require a promotional compliance footer, unsubscribe URL, or mailing address. They remain internal transactional/account communications.

## Persistence

`crm_create_bulk_staff_broadcast` is the only supported creation boundary for new staff bulk jobs. It verifies:

- authenticated CRM administrator or operator capability
- 1–500 distinct staff recipients
- current tenant ownership
- current non-Inactive lifecycle state
- valid profile email
- verified Resend sender configuration
- canonical Newsletter-mode JSON, HTML, text, theme, schema version, and render hash

New legacy staff bulk jobs are rejected. Existing historical legacy jobs remain untouched.

## Delivery

The dedicated `crm-resend-staff-broadcast` Edge Function:

- verifies the user JWT and same-tenant CRM capability internally
- claims up to 25 staff recipient rows with `FOR UPDATE SKIP LOCKED`
- recovers stale claims after ten minutes
- revalidates each staff record and email immediately before delivery
- recomputes and verifies the canonical render hash
- renders only staff-scoped variables
- sends HTML and plain text through Resend
- uses deterministic provider idempotency keys
- creates the canonical CRM email ledger before provider delivery
- stores staff identity and lifecycle evidence in message metadata
- records progress and terminal job counts

The existing signed Resend webhook remains the authoritative provider-event and inbound-reply boundary.

## Operational boundaries

Pass 10 does not:

- send a validation or production staff broadcast
- add staff unsubscribe behavior
- require or infer a postal address
- change client newsletter eligibility
- change clinical or relationship campaigns
- convert historical staff jobs
- alter clinician lifecycle state
- change provider capacity, readiness, or matching logic

## Verification

Required acceptance evidence includes:

- exact-head repository policy and application CI
- browser/server deterministic render-hash parity
- staff variable scope isolation and HTML escaping
- rollback-only staff job creation and claim contract
- rejection of unauthenticated creation
- rejection of new legacy staff bulk jobs
- Edge Function authorization smoke tests
- Supabase security and performance advisor review
- zero validation emails sent

## Review hardening

Before merge, unresolved PR review feedback was re-evaluated against the live Billing Hub schema and production state.

Implemented hardening:

- stale client-side selections are filtered through current broadcast eligibility before job creation
- the subject field resets after a completed send
- a ledger row is marked failed if recipient linking fails after creation
- Resend requests have a 10-second abort timeout and explicit timeout failure code
- non-numeric `schemaVersion` values are rejected through the canonical validation error rather than a raw cast error
- `processing` recipients with a missing `claimed_at` value are reclaimable

Verified but intentionally unchanged:

- `staff.prov_status` is the canonical `clinician_status_enum`, whose only values are `Invited`, `New`, `Active`, and `Inactive`; exact comparison to the enum value is correct
- production preflight confirmed zero duplicate `(bulk_send_id, staff_id)` pairs and no out-of-contract recipient statuses before the original constraint/index migration was applied successfully
