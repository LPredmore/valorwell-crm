# Email Studio Pass 5 — Template and asset library

## Scope

Pass 5 makes the shared Pass 4 composer persistable without connecting it to any live delivery path.

The CRM workspace at `/crm/email-studio` now provides:

- a tenant-scoped template directory
- canonical draft creation and editing
- immutable publication history
- copy, reopen, and archive controls
- a tenant-scoped public email image library
- a separate non-persistent playground at `/crm/email-studio/playground`
- the original low-level compatibility spike at `/crm/email-studio-spike`

## Live Billing Hub migrations

The following migrations were applied to Billing Hub during implementation:

- `20260723183415_email_studio_template_lifecycle`
- `20260723184105_email_studio_template_lifecycle_role_order_fix`
- `20260723184929_email_studio_template_lifecycle_capability_authority`

The first two versions capture corrections discovered by rollback-only contract testing. The repository keeps marker files for those live migration versions and consolidates the final accepted function definitions in the third file. A fresh database therefore reproduces the final state without temporarily installing rejected authorization assumptions.

## Authorization finding

The existing `crm_has_role(uuid, text[], uuid)` helper is a legacy authorization surface based on the older `user_roles` vocabulary. It is not the authority used by the Email Studio template RLS policies.

Email Studio lifecycle RPCs therefore authorize directly through `crm_user_capabilities`:

- `crm_admin` and `crm_operator` may manage drafts, versions, copies, archives, and assets
- `crm_readonly` may inspect tenant templates, versions, and assets
- all other authenticated identities are rejected
- tenant identity is resolved through `private.valorwell_current_staff_tenant_id()`

This keeps RPC authorization aligned with the RLS model installed in Pass 3.

## Transactional lifecycle API

### `crm_email_studio_context()`

Returns the signed-in profile, active staff tenant, read permission, and management permission.

### `crm_email_template_save_draft(...)`

Creates or updates a canonical draft in one operation. The RPC validates:

- required name and subject
- client or relationship content scope
- direct, campaign, or newsletter mode
- TipTap document JSON
- rendered HTML and plain text
- theme key
- editor schema version
- canonical render hash
- tenant ownership
- archive state
- immutable scope after publication history exists

Saving canonical content always writes the JSON, HTML, text, preheader, theme, schema version, and render hash as one snapshot.

### `crm_email_template_publish(...)`

Publication is atomic:

1. lock the template identity
2. validate canonical completeness
3. compare against the current published version
4. reject publication when no content changed
5. allocate the next version number
6. insert the immutable version snapshot
7. update the template's current published-version pointer and status

A browser or client cannot create a version while failing to update the template pointer.

### `crm_email_template_reopen_draft(...)`

Returns a published template identity to editable draft status. Existing published versions remain immutable.

### `crm_email_template_copy(...)`

Creates an independent draft with the same canonical content and no published-version pointer.

### `crm_email_template_archive(...)`

Archives the template identity instead of deleting it. Published versions remain available for audit and historical delivery references.

## Template workspace

### Directory

The directory supports:

- name, subject, and description search
- status filtering
- client-versus-relationship filtering
- canonical-versus-legacy identification
- role-aware creation controls

The one pre-existing legacy HTML template remains visible. Opening it creates a non-trusting plain-text editor reconstruction and displays a blocking review warning until the user deliberately saves reviewed canonical content.

### Editor

The persistent editor owns:

- template name
- description
- subject
- content scope
- authoring mode
- theme
- preheader
- current canonical document
- lifecycle status
- publish summary
- immutable version history

Every save and publication generates a fresh canonical export from the current editor state. A previously exported browser snapshot is never silently reused after later edits.

Published and archived templates are read-only. Published templates must be explicitly reopened before modification. Archived templates must be copied to create new editable content.

## Email image assets

The existing public `email-assets` bucket is now exposed through a tenant-scoped manager.

Before upload, the browser validates:

- JPEG, PNG, WebP, or GIF MIME type
- maximum 5 MiB size
- non-empty meaningful alt text
- maximum 3,000 × 3,000 pixel dimensions

Objects are stored under the active tenant UUID with randomized, sanitized filenames. Object metadata records alt text and dimensions. The manager supports:

- upload
- preview
- copy public URL
- insert into the active email document
- deletion with an explicit warning that existing emails may reference the URL

The database Storage policies remain authoritative for tenant access.

## Live validation

A rollback-only Billing Hub transaction verified:

- CRM admin context resolution
- canonical draft creation
- publication of version 1
- rejection of unchanged publication
- explicit draft reopening
- updated canonical save
- publication of version 2
- independent draft copy
- archive behavior
- zero persisted test templates or versions

The checked-in contract is `supabase/tests/email_studio_template_lifecycle_contract.sql`.

## Explicit boundaries

Pass 5 does not:

- replace the manual client composer
- replace the client campaign editor
- replace the relationship campaign editor
- attach published templates to campaigns
- change bulk sending
- change Resend payloads or webhooks
- change campaign scheduling or enrollment
- activate relationship campaign delivery
- rewrite existing template rows during migration

Those consumption and delivery integrations remain later passes.
