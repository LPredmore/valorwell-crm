# Email Studio Pass 9 — Client bulk newsletters

## Scope

Pass 9 connects Newsletter-mode Email Studio to controlled client bulk email. It adds canonical authoring, immutable published-template attribution, transactional job creation, current-state recipient eligibility, resumable delivery, per-recipient personalization, mailing-address and unsubscribe compliance, and capability-aligned bulk-table access.

This pass is client-only. It does not convert staff broadcasts to Newsletter mode and does not rewrite historical bulk-send records.

## Pre-implementation live posture

Billing Hub contained 13 historical bulk-send jobs:

- 3 client jobs
- 10 staff jobs
- 10 completed jobs
- 3 failed jobs
- zero canonical Newsletter-mode jobs
- zero template-attributed bulk jobs

The existing database already contained nullable Email Studio columns on `crm_bulk_send_logs`, but the UI and Resend runtime did not use or validate them.

## Client selection

The canonical Clients page now allows authorized CRM communicators to select clients for a newsletter. The interface excludes records that currently have:

- no email address
- Do Not Contact policy
- Service Blocked policy
- Closed lifecycle state

The transactional creation RPC repeats those checks against current canonical database state. The Resend worker then evaluates the canonical communication policy again immediately before every delivery. UI selection is never treated as final authorization.

## Newsletter authoring

The bulk composer uses client-scoped Newsletter-mode Email Studio with:

- Newsletter-only and shared blocks
- client and system variables
- themes
- preheader
- preview and canonical export
- published client Newsletter template selection
- immutable source-version attribution until the content or subject is edited

Newsletter export is blocked without a compliance-footer block.

## Mailing address

`crm_resend_email_settings.postal_address` stores the verified organization mailing address that appears in promotional newsletter footers. Pass 9 does not guess or seed an address. An operator must enter the correct address in CRM Settings.

Newsletter job creation and delivery remain disabled until:

- Resend sender settings are verified
- a sender address exists
- a mailing address exists

## Persistence and authorization

`crm_create_bulk_newsletter` is the transactional creation boundary. It verifies:

- authenticated CRM administrator or operator capability for the tenant
- 1–500 distinct clients
- current canonical eligibility of every selected client
- client-scoped Newsletter-mode canonical content
- compliance footer presence
- canonical content completeness
- verified sender and mailing-address settings
- exact immutable template-version equality when attribution is supplied

The RPC creates one canonical bulk-send log and one pending recipient row per selected client.

Bulk tables retain authenticated compatibility for authorized CRM operators, but legacy public/tenant-member policies and excessive grants are removed. Anonymous access is revoked. Current CRM capability rows control same-tenant access.

New client bulk jobs cannot use the legacy HTML/text-only path. Historical legacy jobs remain readable and deliverable for compatibility. Staff bulk records remain on their existing legacy path.

## Resumable delivery

Client recipient rows now support leased processing with:

- `processing` status
- claim token
- claim timestamp
- ten-minute stale-claim recovery
- `FOR UPDATE SKIP LOCKED` claims
- batches of 25 recipients

The frontend invokes controlled batches until the job is complete. Counts are recalculated from recipient records after every batch.

Each recipient receives a deterministic Resend idempotency key derived from the bulk job and recipient row. The canonical email ledger ID is written back to the recipient before provider delivery, allowing safe recovery when a prior attempt created the ledger row.

## Canonical delivery

For each Newsletter-mode recipient, the Resend function:

- rechecks ordinary promotional communication policy
- loads current client and assigned-clinician personalization
- issues a stable opaque unsubscribe token
- injects the recipient-specific unsubscribe URL
- injects the configured mailing address
- recomputes and verifies the canonical render hash
- validates all variables
- escapes HTML values
- renders the hidden preheader
- sends HTML and plain-text content
- writes canonical mode, schema, theme, hash, template version, and bulk-job attribution to `crm_email_messages`

## Unsubscribe handling

Pass 9 adds a private hash-only token ledger. Raw tokens are not stored.

The public Edge Function unsubscribe route:

- accepts only an opaque token
- resolves it through a service-only database RPC
- applies canonical `do_not_contact` state
- records a `contact_policy_changed` activity event
- is replay-safe
- returns no client identity or clinical information
- sends no email

Tokens expire after two years. Existing Do Not Contact state is preserved.

## Compatibility boundaries

Pass 9 does not:

- send a validation or test newsletter
- change client campaign scheduling or enrollment
- change relationship campaign execution gates
- change manual Direct email behavior
- convert staff bulk email to Email Studio
- rewrite historical bulk-send content
- invent a mailing address
- weaken Resend webhook verification or inbound reply handling

## Verification

Required verification includes:

- exact-head repository policy and application CI
- deterministic browser/server newsletter hash parity
- Newsletter-mode and variable validation
- rollback-only Billing Hub contract for creation, attribution, claims, and unsubscribe
- invalid unauthenticated and invalid unsubscribe requests without data mutation
- Supabase security and performance advisor review
- zero validation emails sent
