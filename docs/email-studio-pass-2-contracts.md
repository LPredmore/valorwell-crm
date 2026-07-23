# Email Studio Pass 2 — Canonical contracts

## Scope

Pass 2 establishes code-level contracts only. It does not add tables, columns, RPCs, RLS policies, storage buckets, persistence behavior, email sends, or campaign execution.

## Canonical content document

`EmailContentDocument` is the common immutable snapshot shape for direct email, campaign email, and newsletters:

- editor schema version
- authoring mode
- structured editor JSON
- rendered HTML
- rendered plain text
- optional preheader
- theme key
- deterministic render hash

The render hash is calculated from a stable serialization of every delivery-relevant content field. SHA-256 is used where Web Crypto is available, with a deterministic fallback for constrained runtimes.

## Variable domains

The registry separates variables into three scopes:

- client
- relationship
- system

Client and relationship variables are mutually isolated. System variables are available to both domains. Unknown variables and variables from the wrong domain are blocking validation errors.

### Canonical client variables

- `first_name`
- `preferred_name`
- `last_name`
- `therapist_name`
- `sender_name`

### Canonical relationship variables

- `contact_first_name`
- `contact_display_name`
- `organization_name`
- `organization_type`
- `real_action_summary`
- `cause_area`
- `opportunity_context`
- `approved_source_sentence`
- `sender_name`

### Canonical system variables

- `unsubscribe_url`
- `postal_address`

### Temporary relationship aliases

Legacy relationship templates remain valid during migration:

- `recipient_name` → `contact_display_name`
- `first_name` → `contact_first_name`
- `unsubscribe_link` → `unsubscribe_url`
- `valorwell_postal_address` → `postal_address`

Aliases generate warnings and can be normalized to canonical tokens. They do not expand the canonical vocabulary.

## Rendering safety

Template rendering applies these rules:

- HTML output escapes all inserted values.
- Plain-text output preserves text values.
- URL variables are validated independently and allow only HTTP or HTTPS URLs.
- Missing values, unsafe URLs, unknown variables, and cross-domain variables block rendering.
- Structured `emailVariable` editor nodes are validated against the selected content domain.

## Legacy HTML boundary

The legacy adapter does not treat arbitrary HTML as trusted editor structure. It:

1. preserves the source HTML as an import candidate,
2. creates a plain-text editor reconstruction,
3. marks the result as requiring manual review, and
4. emits explicit warnings.

A later migration pass must validate and approve imported content before persistence as canonical editor JSON.

## Relationship campaign alignment

Relationship campaign definition validation now uses the shared registry for subject and body templates. Unknown and client-only variables block campaign definition saves. Existing legacy aliases remain accepted with migration warnings.

The relationship campaign execution lock is unchanged.

## Deferred work

Pass 2 intentionally defers:

- database persistence
- template/version tables
- asset storage
- production editor integration
- server-side content validation endpoints
- relationship worker HTML delivery
- campaign migration

Those remain in later reviewed passes.
