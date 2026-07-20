# P33 — Relationship domain release audit

**Status:** IMPLEMENTED, verification blocked in this environment.

This audit records application-source evidence for the non-clinical
Business Development domain. It is not a database migration, deployment
approval, production-data change, or outreach authorization.

## Scope and separation audit

| Check | Result | Evidence |
| --- | --- | --- |
| Dedicated boundary | Pass | `RelationshipsRepository` contains relationship operations only; the unavailable adapter throws for each unavailable operation. |
| No clinical fallback | Pass | Relationship pages use relationship capability hooks and state copy that says clinical data is not used as a fallback. |
| Campaign isolation | Pass | Relationship campaign execution source has a static test against clinical scheduler/campaign imports. |
| Reply/inbox isolation | Pass | Reply planner only receives relationship communication logs; the inbox route is separate from `/crm/inbox`. |
| Suppression/unsubscribe isolation | Pass | Suppression resolution does not read client preferences; public unsubscribe planning is capability-gated and token-opaque. |
| Database/migration changes | Pass | No relationship SQL, migration, or live Supabase query was added in the audited application paths. |
| Deployment and outreach changes | Pass | No deployment configuration, provider implementation, scheduled send, or outreach execution is included. |

## Route regression inventory

Relationship routes are separated under `/crm/business-development/`:

* Organizations, contacts, opportunities, imports, campaigns, replies,
  suppressions, reports, and search.
* Public relationship unsubscribe uses `/relationships/unsubscribe/:token`.
* Existing clinical routes remain under `/crm/`, including `/crm/campaigns`,
  `/crm/inbox`, `/crm/reports`, and `/crm/canonical/search`.

## Capability and UX audit

* Capability states distinguish available, pending, permission, network,
  query, invalid-response, and missing-contract conditions.
* Directory, monitor, reporting, reply, suppression, search, and unsubscribe
  surfaces show pending/unavailable state rather than fabricated zero values.
* The public unsubscribe page does not render its URL token.
* Keyboard/focus and automated accessibility verification are still required
  in a browser-capable validation environment.

## Verification matrix

| Required check | Current result |
| --- | --- |
| `npm ci --legacy-peer-deps --no-audit --no-fund` | Blocked: required package archives are unavailable to this environment. |
| `npx eslint src --max-warnings=0` | Blocked by the unavailable dependency tree. |
| App and Node TypeScript checks | Blocked by the unavailable dependency tree. |
| Full Vitest suite | Blocked by the unavailable dependency tree. |
| Production build | Blocked by the unavailable dependency tree. |
| Route regression/manual accessibility review | Deferred until the application can be started with dependencies installed. |
| Screenshot review | Deferred until the application can be started with dependencies installed. |
| Static import/database/deployment audit | Pass: no clinical imports, migration/query patterns, or deployment markers were found in audited relationship service/domain/page/component paths. |

## Completion gate

P33 may be marked **COMPLETE** only after a GitHub-connected environment runs
the full verification matrix, reviews the relationship routes in a browser,
captures required screenshots, and records the resulting command output.
