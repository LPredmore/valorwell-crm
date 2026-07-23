# Email Studio Pass 6 — Manual client email integration

## Scope

Pass 6 replaces the manual client-email textarea with the shared Email Studio in Direct mode. It does not connect Email Studio to campaign authoring, bulk email, relationship outreach, scheduling, or enrollment workflows.

The integration is available through the existing policy-aware composer used by the canonical CRM inbox and client communication surfaces.

## Database impact

No schema migration was required.

Pass 3 already added the canonical delivery attribution columns needed by this pass to `crm_email_messages`:

- `body_html`
- `body_text`
- `preheader`
- `render_hash`
- `template_version_id`
- `metadata`
- `in_reply_to_message_id`

The existing tenant-aware template-version foreign key, reply foreign key, render-hash constraint, and message RLS remain authoritative.

## Composer behavior

### SMS

The SMS composer remains unchanged.

### Email

The manual Email channel now provides:

- Direct-mode Email Studio editing
- client-scoped variables only
- approved Direct-mode blocks only
- theme selection
- preheader editing
- validation and sandboxed preview
- a blank ad-hoc starting point
- optional selection of the current published version of a client/direct template

Draft templates, archived templates, relationship templates, campaign templates, newsletter templates, superseded versions, and noncanonical legacy templates are not selectable in the manual composer.

## Immutable template attribution

Selecting a published Direct template loads its immutable version into the editor and subject field.

The outgoing message retains `template_version_id` only while both conditions remain true:

1. the subject still equals the published version subject
2. the canonical editor snapshot still equals the immutable version snapshot

Changing the subject, body, blocks, variables, preheader, or theme clears attribution immediately. The message may still be sent as valid ad-hoc canonical content, but it is no longer represented as an exact use of that immutable version.

The Edge Function independently verifies every supplied template-version reference before delivery. A browser cannot attach a version ID to modified content.

## Fresh canonical export

The Send action never reuses a previous preview or export.

Immediately before delivery, the composer requests a fresh canonical snapshot containing:

- editor schema version
- Direct mode
- editor JSON
- rendered HTML
- rendered plain text
- preheader
- theme key
- deterministic render hash

Invalid content blocks the Send action.

## Server-authoritative delivery

The existing `crm-resend-email` Edge Function remains the sole email transport boundary. Pass 6 extends it to accept canonical Direct content while preserving legacy payload support for delivery paths that have not yet received their own migration pass.

For canonical manual email, the server:

1. authenticates the caller
2. resolves the active tenant and CRM capability
3. rejects mutation attempts from `crm_readonly` and `crm_none`
4. verifies the client belongs to the tenant
5. evaluates canonical communication policy
6. validates Direct-mode canonical content
7. recomputes and verifies the render hash
8. scans subject, HTML, text, and preheader as one variable set
9. rejects unknown or relationship-domain variables
10. requires every referenced value
11. validates URL variables
12. resolves client, therapist, and sender values from authoritative records
13. escapes values inserted into HTML
14. verifies immutable template-version equality when a version ID is supplied
15. inserts the exact rendered delivery into `crm_email_messages`
16. sends that exact HTML and text through Resend
17. records provider IDs, delivery status, audit metadata, and client last-contact state

## Personalization values

Manual client email resolves:

- `first_name` from `clients.pat_name_f`
- `preferred_name` from `clients.pat_name_preferred`, falling back to first name
- `last_name` from `clients.pat_name_l`
- `therapist_name` from the assigned staff member's client-facing name, falling back to their full name and then the care team label
- `sender_name` from the configured Resend sender name, falling back to the care team label

Relationship variables are rejected. System variables that do not have an authoritative value in the manual Direct workflow remain blocking rather than being replaced with guesses.

## Persisted delivery attribution

Canonical manual sends persist:

- personalized subject
- personalized HTML
- personalized plain text
- personalized preheader
- canonical render hash
- immutable template version ID when exact attribution is valid
- Direct content mode in message metadata
- editor schema version in message metadata
- theme key in message metadata
- source `manual_email_studio`

The render hash identifies the pre-personalization canonical snapshot. The message body fields preserve the exact personalized content handed to Resend.

## Preserved Resend behavior

Pass 6 preserves:

- Resend-only outbound delivery
- provider idempotency keys
- tagged reply-to addresses
- `In-Reply-To` and `References` headers
- inbound webhook signature verification
- outbound status webhooks
- request IDs and structured diagnostics
- queued, sent, delivered, delayed, bounced, complained, suppressed, and failed states
- email activity events
- client last-contact updates
- campaign-response handling for inbound email
- legacy single and bulk payload compatibility until their reviewed migration passes

Because the same Edge Function handles authenticated CRM requests and signed Resend webhooks, it remains deployed with platform JWT verification disabled and performs action-specific authentication internally.

## Validation

Repository tests cover:

- browser and server deterministic-hash parity
- HTML escaping
- hidden preheader rendering
- hash-tampering rejection
- relationship and unknown variable rejection
- aggregate missing-variable reporting
- unsafe URL rejection

No test email is sent during implementation or validation.

## Explicit boundaries

Pass 6 does not:

- change SMS authoring or delivery
- replace the client campaign editor
- replace the relationship campaign editor
- migrate bulk-send content
- attach templates to campaigns
- change campaign scheduling or enrollment
- activate relationship campaign delivery
- rewrite historical email messages
- alter Resend credentials, domains, or webhook secrets

Those integrations remain later passes.
