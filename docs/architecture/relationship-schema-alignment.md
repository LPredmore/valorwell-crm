# Relationship Schema Alignment

## Decision

The canonical persistence schema for the ValorWell CRM relationship domain is the `public` schema in the Billing Hub Supabase project (`ahqauomkgflopxgnlndd`). The CRM must consume that schema through generated Supabase types; it must not create a parallel CRM-owned schema or reuse clinical CRM tables.

The live database and `src/integrations/supabase/types.ts` were compared on 2026-07-20. The generated `Database` type already contains the eight deployed `relationship_*` tables and matches their current column shapes. No corrective database migration is required for schema alignment.

`src/repositories/supabase/relationships-schema.ts` is the application persistence boundary. Its named row, insert, and update aliases are derived directly from the generated `Database` type, so table or column drift causes a TypeScript failure instead of being hidden behind handwritten duplicate interfaces.

## Canonical tables

| Purpose | Billing Hub table |
| --- | --- |
| Organizations | `relationship_organizations` |
| Contacts | `relationship_contacts` |
| Contact/organization affiliations | `relationship_contact_organizations` |
| Role catalog | `relationship_role_catalog` |
| Contact roles | `relationship_contact_roles` |
| Organization roles | `relationship_organization_roles` |
| Social profiles | `relationship_social_profiles` |
| Influencer extensions | `relationship_influencer_profiles` |

The first persistence vertical slice should use only organizations, contacts, and contact/organization affiliations. Presence in the generated schema does not make later capabilities operational.

## First-slice mapping

### Organizations

| Database column | Application meaning |
| --- | --- |
| `id` | organization identifier |
| `tenant_id` | mandatory account/tenant boundary |
| `name` | organization name |
| `website` | website |
| `organization_kind` | organization type/kind |
| `veteran_affiliated` | veteran affiliation flag |
| `outreach_status` | current outreach status |
| `owner_profile_id` | assigned owner profile |
| `next_action` | next action text |
| `next_action_due_at` | next action due time |
| `last_contact_at` | most recent contact time |
| `do_not_contact` | organization-level outreach restriction |
| `source` / `source_record_key` | provenance and external idempotency key |
| `metadata` | explicitly approved extension data only |
| `created_at` / `updated_at` | audit timestamps |

### Contacts

| Database column | Application meaning |
| --- | --- |
| `id` | contact identifier |
| `tenant_id` | mandatory account/tenant boundary |
| `profile_id` | optional linked application profile |
| `first_name` / `last_name` | canonical contact name fields |
| `preferred_name` | preferred display name input |
| `title` | contact title |
| `email` / `phone` / `linkedin_url` | contact channels |
| `owner_profile_id` | assigned owner profile |
| `next_action` | next action text |
| `next_action_due_at` | next action due time |
| `last_contact_at` | most recent contact time |
| `do_not_contact` | contact-level outreach restriction |
| `source` / `source_record_key` | provenance and external idempotency key |
| `metadata` | explicitly approved extension data only |
| `created_at` / `updated_at` | audit timestamps |

A contact display name is derived from the stored name fields. Organization membership is derived through `relationship_contact_organizations`; it is not a contact-table column.

### Affiliations

`relationship_contact_organizations` does not have a synthetic `id`. Its canonical identity is the composite key:

- `tenant_id`
- `contact_id`
- `organization_id`

The remaining persisted fields are `role_title`, `is_primary`, `metadata`, `created_at`, and `updated_at`. Repository update/delete operations must address an affiliation by the composite key and must not invent an affiliation UUID.

## Handwritten domain contracts

The broader relationship contracts describe planned business-development behavior as well as persisted data. They are not database schemas. Fields that are not first-class Billing Hub columns—including organization `state`, lifecycle `stage`, `reviewStatus`, free-form `description`, and affiliation `startedAt`/`endedAt`—must not receive fabricated defaults in a Supabase adapter.

A later feature may add an approved column migration or an explicit metadata mapping. Until then, those values remain unavailable and any capability depending on them remains pending.

## Tenant and RLS findings

All deployed relationship tables have `tenant_id` and RLS enabled. The current deployed authenticated policies permit authenticated access with unconditional `USING (true)` / `WITH CHECK (true)` expressions. Therefore, RLS currently does **not** independently enforce tenant separation.

Until a separately reviewed RLS-hardening migration is approved, every relationship repository query and mutation must:

1. Resolve the authenticated user's current tenant through the existing application helper.
2. Include an explicit `tenant_id` filter.
3. Include `tenant_id` in inserts.
4. Include the tenant key when resolving composite affiliations.
5. Never rely on the broad authenticated policy as proof of tenant authorization.

RLS hardening is required before this domain can be considered fully production-safe, but it is distinct from application-schema alignment and should not be hidden inside an unrelated migration.

## Generated-type workflow

After every approved Billing Hub migration affecting the public schema:

```bash
supabase gen types typescript \
  --project-id ahqauomkgflopxgnlndd \
  --schema public \
  > src/integrations/supabase/types.ts
```

Then run the repository typecheck and the relationship schema tests. Generated-type diffs must be committed with the migration or with the first consuming application change.

## Deferred work

This alignment does not:

- activate the relationship repository provider;
- enable campaign, enrollment, reply, suppression, unsubscribe, import, reporting, or global-search capabilities;
- add demo data;
- query or modify clinical tables;
- claim tenant-safe RLS beyond what the deployed policies currently enforce.

The next implementation step is a typed Supabase adapter for organizations, contacts, and affiliations using the compiler-bound persistence types defined here.
