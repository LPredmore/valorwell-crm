# Relationship domain delivery map

This checklist makes the database-gated Business Development implementation
verifiable without using clinical CRM records or creating temporary persistence.

## Phase 0 — validation baseline

The CI workflow is the required validation contract: dependency installation,
lint, application and tooling type checks, tests, and production build.  The
lockfile must stay synchronized with `package.json`; changes to dependencies
must be validated with the same `npm ci --legacy-peer-deps` command used in CI.

## Phase 1 — application boundary

| Requirement | Application boundary |
| --- | --- |
| Organizations and contacts | `RelationshipsRepository` |
| Referrals, opportunities, interactions | Typed relationship contracts and repository methods |
| Imports | `previewImport`; writes remain unavailable until a database adapter exists |
| Campaigns, replies, suppressions, unsubscribe, reporting, search | Capability keys reserved for dedicated future adapters |
| Clinical separation | Relationship repository has no client, clinical campaign, note, or clinical communication-policy API |
| Database readiness | `CapabilityAvailability` has explicit available, pending, permission, network, query, invalid-response, and missing-contract states |

The initial `unavailableRelationshipsRepository` is intentional: it performs
no Supabase query or fallback write.  A later typed schema adapter replaces it
only after the database capability is installed and verified.
