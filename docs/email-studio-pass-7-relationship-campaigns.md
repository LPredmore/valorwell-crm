# Email Studio Pass 7 — Relationship campaign integration

## Scope

Pass 7 connects the shared Email Studio to the non-clinical Business Development relationship campaign domain.

Relationship campaign steps can now be authored with Campaign-mode Email Studio, loaded from published relationship-scoped Campaign templates, persisted as canonical snapshots, reopened without losing canonical content, and prepared for Resend delivery as HTML with a plain-text fallback.

This pass does not relax any campaign execution or recipient-safety controls.

## Live Billing Hub migrations

The following migrations were applied to Billing Hub:

- `20260724135319_email_studio_relationship_campaign_integration`
- `20260724135737_email_studio_relationship_variable_renderer_alignment`

The repository migration filenames match the live migration versions.

## Relationship template selection

The campaign editor lists only templates that are:

- scoped to `relationship`
- authored in `campaign` mode
- published
- active
- linked to a current immutable published version

Client templates, Direct templates, Newsletter templates, drafts, archived templates, and inactive templates are excluded.

Selecting a published template stores both:

1. an editable canonical snapshot for the campaign step
2. the immutable template-version identity used as the source

Later edits or publications to the template cannot silently change an existing campaign step.

## Campaign-mode composer

Each ordered relationship campaign step now uses the shared Email Studio architecture with:

- relationship-scoped variables
- Campaign-mode blocks
- theme selection
- preheader editing
- validation
- preview
- fresh canonical export

The campaign save action exports every step from its current editor state before persistence. It does not trust an earlier browser snapshot.

## Canonical step persistence

Canonical relationship campaign steps persist:

- editor document JSON
- rendered HTML
- rendered plain text
- preheader
- theme key
- editor schema version
- render hash
- immutable template-version attribution when applicable

The existing transactional `save_relationship_campaign` RPC remains the public save boundary. Pass 7 wraps the existing campaign save operation and persists canonical step fields in the same database transaction.

The database rejects:

- malformed editor documents
- incomplete canonical snapshots
- Direct or Newsletter content in a relationship campaign step
- client-scoped template versions
- relationship template versions that are not Campaign mode
- mismatched template and version identities

## Round-trip and legacy compatibility

Canonical fields survive the full cycle:

`load → edit → reorder → save → reload`

Editor identity is tied to the actual step content rather than only the list position, preventing moved steps from inheriting another step's editor state.

Existing text-only relationship campaign steps remain supported. When opened in the new editor, their body text is imported paragraph-by-paragraph into a reviewable Email Studio document with an explicit legacy-conversion warning. Existing database rows are not mass-rewritten by the migration.

The repository serializer preserves the legacy step payload shape when no canonical content exists, so existing tests and integrations do not receive additional null fields.

## Delivery compatibility

Canonical Email Studio steps are prepared into `relationship_communications` with:

- rendered HTML
- rendered text
- rendered preheader
- render hash
- immutable template-version attribution

The relationship campaign worker was deployed as version 4. It now sends:

- HTML plus a plain-text fallback for canonical Email Studio communications
- the existing text-only payload for legacy communications

The worker's service-role authorization, work claiming, leases, retry behavior, provider idempotency, and delivery-result recording remain unchanged. Its existing custom service-role bearer check remains authoritative, so the deployed function preserves `verify_jwt = false`.

## Variable rendering and safety

The runtime renderer now recognizes the canonical relationship variable registry, including:

- `contact_first_name`
- `contact_display_name`
- `organization_name`
- `organization_type`
- `real_action_summary`
- `cause_area`
- `opportunity_context`
- `approved_source_sentence`
- `sender_name`
- `unsubscribe_url`
- `postal_address`

Legacy aliases such as `first_name` and `recipient_name` remain supported.

HTML variable values are escaped before insertion. Evidence-backed variables fail closed when their required personalization context is unavailable; the system does not silently send a blank or partially substituted message.

## Unchanged execution boundaries

Pass 7 does not bypass or weaken:

- `relationship_campaigns.execution_enabled`
- enrollment delivery enablement
- final pre-delivery safety revalidation
- suppression and unsubscribe controls
- work-item claim and lease validation
- verified sender/provider readiness
- Resend idempotency
- delivery result recording
- reply and webhook processing

Authoring and template integration alone cannot cause a campaign to execute.

## Validation

Repository tests cover:

- canonical relationship campaign serialization
- immutable template/version attribution
- canonical load/edit/save round trips
- legacy payload compatibility
- canonical HTML/text worker payloads
- legacy text-only worker payloads

A rollback-only Billing Hub contract verified:

- relationship/campaign template draft creation and publication
- canonical step persistence
- immutable version attribution
- execution remaining disabled
- legacy step compatibility
- rejection of non-Campaign canonical content
- HTML escaping
- fail-closed evidence-backed variables
- zero persisted test templates and campaigns

The checked-in contract is:

- `supabase/tests/email_studio_relationship_campaign_contract.sql`

The live migration was also compiled inside a rollback-only transaction before application.

## Advisor review

Supabase security and performance advisors were reviewed after the live changes. No Pass 7-specific security issue was introduced. Existing unrelated project-wide advisor findings remain outside this pass.
