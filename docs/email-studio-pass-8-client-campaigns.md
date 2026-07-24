# Email Studio Pass 8 — Client campaign integration

## Scope

Pass 8 connects the shared Email Studio to the clinical client campaign editor and its existing campaign scheduler.

Client email steps can now be authored with client-scoped Campaign-mode Email Studio, loaded from published client Campaign templates, persisted as canonical snapshots, reopened without losing canonical content, reordered safely, and delivered through Resend as verified HTML with a plain-text fallback.

This pass does not change SMS authoring or delivery and does not relax any enrollment, suppression, scheduling, work-claim, retry, or completion controls.

## Production data posture

At the start of Pass 8, Billing Hub contained:

- 25 legacy client email campaign steps
- 12 SMS campaign steps
- zero canonical client campaign email steps
- zero template-attributed client campaign steps
- zero active campaign enrollments
- zero scheduled or processing campaign work items

The migration does not rewrite existing email or SMS steps. A legacy email becomes canonical only when an authorized operator opens it, reviews the reconstructed Email Studio document, and saves the campaign.

## Client Campaign template selection

The client campaign editor lists only templates that are:

- scoped to `client`
- authored in `campaign` mode
- published
- active
- linked to a current immutable published version

Relationship templates, Direct templates, Newsletter templates, drafts, archived templates, inactive templates, and templates without a current published version are excluded.

Selecting a published template stores both:

1. an editable canonical snapshot for the campaign step
2. the immutable template-version identity used as the source

Later template edits or publications cannot silently alter an existing campaign step.

## Campaign composer and save boundary

Every email step now uses client-scoped Campaign Email Studio with:

- client variables
- Campaign-mode blocks
- themes
- preheader editing
- validation
- preview
- fresh canonical export

The campaign save action exports every email step from its current editor state immediately before persistence. It does not trust an earlier browser snapshot.

Stable client-side step keys remain attached to the actual step during drag-and-drop reordering. Moved steps therefore cannot inherit another step's editor state or exporter.

SMS steps retain their existing textarea, delay, activation, reordering, scheduling, and RingCentral delivery paths.

## Canonical persistence

Canonical client campaign email steps persist:

- subject
- editor document JSON
- rendered HTML
- rendered plain text
- preheader
- `campaign` content mode
- theme key
- editor schema version
- render hash
- immutable template-version attribution when applicable
- optional email signature identity

The existing transactional `crm_save_campaign_steps` RPC remains the public campaign-step save boundary.

The hardened RPC now validates:

- authenticated CRM role for the requested tenant
- campaign ownership by that tenant
- payload and step-order shape
- existing step ownership
- signature ownership by the tenant
- client scope for template versions
- Campaign mode for template versions
- template and template-version identity consistency

The database trigger rejects:

- canonical content on SMS steps
- partial canonical fields on legacy email steps
- Direct or Newsletter canonical content in client campaign steps
- empty canonical subjects
- relationship-scoped or cross-tenant template versions

## Legacy compatibility

Existing text/HTML-only email campaign steps remain valid and continue to use the legacy payload shape.

When an operator opens a legacy email in the new editor, its existing HTML and text are reconstructed as editable Email Studio content with an explicit review warning. The original row remains unchanged until a valid canonical export is saved.

No bulk migration or automatic conversion was performed.

## Scheduler delivery

The production `campaign-scheduler` was deployed as version 54.

For canonical Email Studio steps, the scheduler now:

- validates Campaign mode and editor-document shape
- recomputes and verifies the canonical render hash
- validates required variables and rejects unknown variables
- safely escapes variable values inserted into HTML
- renders a hidden preheader when present
- sends HTML plus a plain-text fallback through Resend
- records body text, preheader, render hash, template-version attribution, schema version, and theme metadata in `crm_email_messages`
- revalidates any template version against the same tenant, client scope, and Campaign mode before delivery
- appends compatible HTML and plain-text signatures

Legacy email steps continue to send their existing HTML-only Resend payloads.

The scheduler retains its existing custom `X-Cron-Secret` authorization check. Its deployed `verify_jwt = false` configuration remains intentional because the function is invoked by the cron system rather than a user JWT.

## Unchanged orchestration and safety boundaries

Pass 8 does not bypass or weaken:

- campaign activation
- enrollment activation and status
- status-based auto-enrollment triggers
- send windows and client time zones
- weekdays-only scheduling
- suppression and unsubscribe policy evaluation
- final recipient/channel policy checks
- work-item claims and claim tokens
- claim release and rescheduling
- retry and provider idempotency behavior
- campaign-step result recording
- completion handling
- RingCentral SMS delivery
- reply and webhook processing

Authoring or selecting a template cannot independently enroll a client or execute a campaign.

## Live Billing Hub migration

Applied migration:

- `20260724154254_email_studio_client_campaign_integration`

Repository migration filename and live migration version match.

## Validation

Repository tests cover:

- canonical client campaign serialization
- immutable template/version attribution fields
- exact legacy payload compatibility
- SMS isolation from Email Studio fields
- canonical render-hash verification
- tamper detection
- HTML-safe variable rendering
- missing-variable failure
- canonical Resend HTML and text payloads
- legacy HTML-only payloads
- HTML and plain-text signatures

A rollback-only Billing Hub contract executed under an actual CRM-admin authorization identity and verified:

- canonical client Campaign step persistence
- immutable client Campaign template-version attribution
- legacy email compatibility
- SMS isolation
- rejection of Newsletter-mode content
- rejection of relationship template versions
- tenant and role authorization through the existing save RPC
- zero persisted test campaigns, templates, versions, or steps

After the contract rolled back, Billing Hub still had:

- zero canonical production client campaign steps
- zero active campaign enrollments
- zero scheduled or processing campaign work items

The checked-in contract is:

- `supabase/tests/email_studio_client_campaign_contract.sql`

## Advisor review

Supabase security and performance advisors were reviewed after the live migration. No Pass 8-specific security or performance issue was introduced. Existing unrelated project-wide advisor findings remain outside this pass.
