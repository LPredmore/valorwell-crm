# Email Studio Pass 3 — Database foundation

## Applied target

- Supabase project: Billing Hub
- Project ID: `ahqauomkgflopxgnlndd`
- PostgreSQL: 17.6.1
- Foundation migration: `20260723164221_email_studio_database_foundation`
- Normalization migration: `20260723165429_email_studio_remove_redundant_bulk_template_fk`

Both migrations were applied to Billing Hub before this repository change was opened. The checked-in SQL reproduces the live state.

## Compatibility decision

`crm_email_templates` already existed and was referenced by bulk-send history. Pass 3 extends that table rather than replacing it. Existing rows remain legacy-compatible because canonical editor fields are nullable and the existing HTML fields remain authoritative until later passes convert a record.

No existing campaign, message, template, signature, or send-history row was rewritten.

## Template foundation

### `crm_email_templates`

The existing table now supports:

- client or relationship content scope
- direct, campaign, or newsletter authoring mode
- editor JSON
- HTML and plain-text snapshots
- preheader and theme
- schema version and render hash
- draft, published, and archived lifecycle
- current immutable published-version reference
- creator/updater and archive metadata

Canonical completeness constraints activate only when `editor_document` is present. Legacy templates therefore remain readable and usable.

### `crm_email_template_versions`

Published versions are immutable snapshots containing:

- tenant and parent-template identity
- monotonically numbered version
- content scope and authoring mode
- subject
- editor JSON
- exact rendered HTML and text
- preheader and theme
- editor schema version
- render hash
- change summary and publisher metadata

Updates and deletes are rejected by database triggers. A published or versioned template identity must be archived rather than deleted.

## Delivery-surface fields

Pass 3 adds canonical-content metadata without changing runtime delivery behavior.

### Client campaign steps

- `email_content_mode`
- `email_editor_document`
- `email_body_text`
- `email_preheader`
- `email_theme_key`
- `email_editor_schema_version`
- `email_render_hash`
- `email_template_version_id`

### Relationship campaign steps

- `content_mode`
- `editor_document`
- `body_html_template`
- `body_text_template`
- `preheader_template`
- `theme_key`
- `editor_schema_version`
- `render_hash`
- `template_version_id`

### Bulk sends

- `body_text`
- `editor_document`
- `preheader`
- `content_mode`
- `theme_key`
- `editor_schema_version`
- `render_hash`
- `template_version_id`

### Canonical CRM email messages

- `preheader`
- `render_hash`
- `template_version_id`

### Relationship communications

- `rendered_html`
- `rendered_text`
- `rendered_preheader`
- `render_hash`
- `template_version_id`

### Signatures

- `body_text`

## Domain separation

Database triggers enforce the boundary established in Pass 2:

- client campaign steps, client bulk sends, and canonical client email messages may reference only client-scope template versions
- relationship campaign steps and relationship communications may reference only relationship-scope template versions
- a version must use the same scope as its parent template
- all template and version references are tenant-aware composite foreign keys

The relationship campaign execution lock is unchanged.

## Access model

The template tables use the existing CRM capability model:

- `crm_admin`, `crm_operator`, and `crm_readonly` may read tenant templates and versions
- `crm_admin` and `crm_operator` may create or update draft template identities and publish new immutable versions
- only `crm_admin` may request template deletion, and deletion triggers still reject published or versioned records
- authenticated users cannot update or delete published-version rows
- service-role access remains available for controlled backend workflows, but immutability triggers still apply

## Email asset storage

A public `email-assets` bucket supports images that must load in external email clients.

- maximum object size: 5 MiB
- accepted MIME types: JPEG, PNG, WebP, GIF
- SVG is not accepted
- object paths must begin with the tenant UUID
- CRM readers may inspect their tenant objects
- CRM admins/operators may create, update, and delete their tenant objects

Pixel dimensions and required alt text cannot be reliably enforced by Storage bucket metadata. Those checks remain mandatory in the upload/editor workflow introduced in a later pass.

## Validation performed

The live schema was inspected before and after migration. A rollback-only contract test then verified that:

- a valid canonical client template and immutable version can be created
- published versions cannot be updated
- a relationship template version cannot be attached to a client bulk send
- malformed editor JSON is rejected
- published/versioned template identities cannot be deleted
- no test rows persist after rollback

The checked-in test is `supabase/tests/email_studio_database_contract.sql`.

## Type alignment

`src/integrations/supabase/email-studio-database.types.ts` is a focused generated supplement for the new and extended Email Studio objects. The global generated Supabase file is intentionally not replaced in this database-only pass because no runtime code queries these objects yet and a 13,000-line unrelated diff would reduce review quality. The full global type generation should be performed in the first runtime integration pass that consumes these tables.

## Deferred work

Pass 3 does not:

- replace any composer
- persist editor documents from the application
- publish templates from the UI
- send HTML/text through a changed runtime path
- migrate legacy templates or campaign steps
- activate relationship campaign delivery
- enforce image dimensions or alt text outside the future uploader
