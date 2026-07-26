# Email Studio Pass 11 — Staff template lifecycle and immutable attribution

## Scope

Pass 11 extends the shared Email Studio template lifecycle to internal staff broadcasts. It does not add a new delivery transport or alter staff eligibility.

The controlling staff/provider lifecycle remains the existing Provider Network OS model: `Invited`, `New`, `Active`, and `Inactive`. This pass does not create a second lifecycle or readiness system.

## Template boundary

Email Studio now supports a third content scope: `staff`.

Staff-scoped templates:

- must use Newsletter mode
- use only approved staff variables
- do not require promotional unsubscribe or postal-address content
- may be drafted, published into immutable versions, reopened, copied, and archived through the existing template lifecycle
- cannot change scope after a version has been published

The template library and filters display staff templates separately from client and relationship content.

## Broadcast use

The staff broadcast dialog may start blank or load the current active published version of a staff Newsletter template.

Loading a template records its template and immutable version identity. Editing the subject, body, preheader, theme, or editor document clears that attribution. The broadcast remains sendable as canonical ad-hoc content, but it is no longer represented as an unchanged template send.

## Database enforcement

`crm_create_bulk_staff_broadcast` accepts optional template and version IDs and verifies:

- the version belongs to the active tenant
- the template is active and published
- the version is the template's current published version
- scope is `staff`
- mode is `newsletter`
- template and version IDs match
- subject, editor JSON, HTML, text, preheader, theme, schema version, and render hash exactly match the immutable version

The bulk-send validation trigger independently enforces scope, mode, identity, and exact content equality for attributed client and staff newsletters.

## Message ledger

A database trigger copies the authoritative staff broadcast template version into each canonical `crm_email_messages` row and records template and version IDs in message metadata. The delivery worker does not decide or reconstruct attribution.

Historical staff bulk jobs remain unchanged with null template attribution.

## Preserved boundaries

Pass 11 does not:

- send a validation or production email
- alter staff selection or eligibility rules
- alter the Resend provider boundary
- alter claim leases, retries, idempotency, or timeouts
- add staff unsubscribe behavior
- require a mailing address for internal staff communication
- rewrite historical templates, jobs, recipients, or messages
- change client or relationship template behavior except for shared bulk-attribution validation hardening

## Acceptance evidence

Required acceptance evidence:

- exact-head repository policy and application CI
- rollback-only staff template draft and publication
- immutable template-version attribution on the staff bulk job
- automatic template-version propagation to the canonical message ledger
- rejection after subject or canonical content modification
- rejection of staff Direct or Campaign templates
- no production staff broadcast job or email message created by validation
- Supabase security and performance advisor review
