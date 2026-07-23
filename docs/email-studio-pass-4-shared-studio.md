# Email Studio Pass 4 — Shared authoring surface

## Scope

Pass 4 converts the successful React Email Editor spike into a reusable CRM feature without connecting it to persistence or delivery.

The shared studio is available at `/crm/email-studio`. The Pass 1 compatibility spike remains at `/crm/email-studio-spike` for low-level regression diagnosis.

## Implemented surface

`src/features/email-studio/studio/` now contains:

- `EmailStudio` — reusable controlled authoring surface
- `ComposerField` — React Email Editor boundary
- `EmailStudioToolbar` — mode, theme, preview, export, and reset controls
- `BlockLibrary` — mode-filtered blocks
- `EmailStudioInspector` — scope, mode, theme, preheader, and export-boundary context
- `VariablePicker` — structured variables from the canonical scope registry
- `ValidationPanel` — blocking errors and non-blocking warnings
- `PreviewDialog` — sandboxed HTML plus text, HTML, JSON, and render hash inspection
- `TemplatePicker` — controlled starter layouts
- generic email-aware `emailStudioBlock` and `emailVariable` editor nodes

## Authoring modes

### Direct Email

Designed for restrained one-to-one messages.

Allowed controlled blocks:

- text section
- callout
- divider

Normal editor paragraphs and inline formatting remain available.

### Campaign Email

Designed for structured client or relationship sequences.

Adds:

- hero
- CTA
- story
- resource
- video
- quote
- Beyond The Yellow
- Operation Claims Success resource
- compliance footer

### Newsletter

Designed for full editorial communication.

Adds all campaign blocks plus:

- statistics
- clinician spotlight
- social footer

Newsletter exports require a compliance footer.

## Themes

The studio exposes four approved theme keys:

- `valorwell`
- `ocs`
- `bty`
- `plain-outreach`

Theme selection updates existing controlled blocks and becomes canonical export metadata. React Email Editor continues to use its proven `basic` editor theme internally; brand-specific email styling is applied by Email Studio blocks rather than by unverified editor theme internals.

## Content blocks

The first shared block registry includes:

- Hero
- Text
- Callout
- CTA
- Story
- Resource
- Video
- Quote
- Stats
- Clinician spotlight
- Beyond The Yellow
- Operation Claims Success resource
- Divider
- Social footer
- Compliance footer

Blocks are represented as structured editor JSON, not arbitrary HTML. Each block stores its semantic kind and controlled attributes such as title, body, safe URL, image URL, alt text, theme, and locked state.

## Validation

Pass 4 adds blocking validation for:

- unknown block kinds
- blocks used outside their allowed mode
- unsafe `javascript:`, `data:`, or other unsupported URLs
- unsafe image protocols
- image blocks without meaningful alt text
- newsletter exports without a compliance footer
- relationship campaign exports without a compliance footer
- canonical variable, scope, schema, HTML, text, theme, and token failures from Pass 2

Client campaign emails receive a warning, rather than a universal block, when no compliance footer is present because not every clinical campaign is promotional. Later integration passes may apply stricter policy based on the actual campaign classification.

## Export contract

A successful export produces the existing canonical `EmailContentDocument`:

- schema version
- mode
- editor JSON
- rendered HTML
- rendered plain text
- preheader
- theme key
- render hash

The studio uses the Pass 2 finalization and hashing functions. Browser output is still treated as a candidate snapshot that must be revalidated by a server-side delivery path before persistence or sending.

## Preview isolation

HTML previews use an iframe with an empty `sandbox` value. Preview HTML is not passed through the application-wide sanitizer because that sanitizer intentionally removes email inline styles. The iframe boundary prevents the generated document from receiving script, same-origin, form, popup, or navigation permissions.

## Read-only mode

The review page can remount the studio in read-only mode. The underlying TipTap editor is made non-editable and all mutation controls are disabled, while canonical export and preview remain available.

## Explicit boundaries

Pass 4 does not:

- save templates or versions
- upload email assets
- replace the manual client composer
- replace the client campaign editor
- replace the relationship campaign editor
- modify bulk sends
- modify Resend payloads
- change campaign scheduling or enrollment
- unlock relationship campaign production execution
- migrate legacy HTML

Those integrations remain in Passes 5–8.
