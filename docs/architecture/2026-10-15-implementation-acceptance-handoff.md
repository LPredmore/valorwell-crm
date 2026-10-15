# Continuation acceptance and remaining implementation handoff

October 15, 2026. CRM draft [PR #154](https://github.com/LPredmore/valorwell-crm/pull/154), latest implementation `e527566`; Billing Hub draft [PR #15](https://github.com/LPredmore/valorwell-billing-hub/pull/15), latest prepared fixtures `495d0ea`. Neither PR is merged or deployed. No tests, lint, type checks, builds, browser acceptance or workflow execution were performed. Todoist task 42 (`6hm9jrrxrXXxpPwq`) remains the complete acceptance checklist; this handoff does not replace its existing items.

## Status and exact next actions

| Area | Current evidence | Next action |
| --- | --- | --- |
| Identity | User applied current-tenant SQL; missing migration ledger row repaired and read; live types generated; application source integrated | Run deferred migration-sequence, signed-role, source-lifecycle and audit acceptance. No SQL reapply or identity backfill. |
| CRM tasks/direct relationships | Source pages/filters, selected scope, ownership, timestamps, non-clinical history and auth races implemented | Run prepared source fixtures and signed multi-tenant/readonly checks; then review staged frontend release. |
| Hosted invitation/recovery | Owner supplied shared client Site URL, redirect list missing CRM entries and both templates using ConfirmationURL; source/tooling implemented | Add the three exact CRM returns while retaining shared Site URL/templates/other entries; confirm saved configuration. Issuance must supply CRM redirectTo. Staff-only client-portal routing is a separate unimplemented app contract; dual-role clients retain client access. No real recipient acceptance until specifically authorized. |
| Zeffy capture | Existing v11 only captures; PR #15 prepares required HMAC, bounded capture, retry/conflict guards and read-only payment review | Owner confirms current Settings → Integrations URL/event selections, signing binding and read-API availability. Run synthetic acceptance before reviewed function deployment. |
| Foundation ownership | Owner explicitly confirmed existing CRM/Billing Hub tenant `00000000-0000-0000-0000-000000000001` for Foundation donations; webhook base also confirmed | Carry this ownership into reviewed downstream configuration/ledger. No new tenant needed; no database mapping deployed by the clarification. |
| Actual donation ledger | Pure cents/status/refund projection and GET-only report prepared; no ingestion/ledger writes | After ownership/authentication review, define and review tenant/account/payment/event uniqueness, immutable corrections, currency aggregation and delayed/refund reconciliation before database implementation. Do not invoke legacy donor processing. |
| Individual Ads attribution | Form-open intent exists; inspected payments carry no deterministic website/click token | Confirm a provider-supported opaque source/token round trip into authenticated payment/API/export output. Then implement a consented server-side join and separate actual-donation action/value/retry/refund-adjustment contract. Unmatched gifts remain unattributed. No email/time guesses or uploads. |
| Recurring plans | Payment-level recurring fields documented; no complete pause/cancel event contract | Obtain provider notification/reconciliation guarantees; retain unknown lifecycle state rather than infer active plans from installments. |
| Recruitment/staff | Source-authorized paged handoff queue and native action registry implemented | Accept source role/tenant and Approved/onboarding/closed behavior. Exact-applicant URL needs an authorized staff-side exact read contract; existing list/summary RPCs do not supply one. Native provision/invite retry/delivery acceptance remains separate. |
| Tenant-implicit RPCs | Campaign/delivery/import/referral/safety/enrollment adapters retain existing server-selected contracts | Review each backend permission/tenant/side-effect contract before adding explicit selection. Changing only browser context would be insufficient. These surfaces can remain unavailable to an ambiguous multi-tenant session. |
| Historical donor security | Legacy transaction-view/definer/processor/idempotency findings documented | Review explicit access restrictions against current consumers separately; preserve historical gifts/attribution and do not activate synchronization to diagnose them. |
| Real record reconciliation | Research/Primary/identity review tools implemented | Authorized operator supplies record-specific provenance and makes disputed choices deliberately; no automatic merge, affiliation repair or Primary decision. |
| Release/Social Media | Draft source only; current publishers preserved | Finish task 42, review commits and deployment boundaries, then record each actual release/configuration/runtime result. No Flurra cutover. |

## Deferred local commands

These commands are copied from the existing CRM CI workflow and are **not executed** here. Run in a fresh trusted checkout using Node 22 and record results against the exact commit. Inspect any failing fixture and repair source; prepared tests are not proof of correctness.

```sh
npm ci --legacy-peer-deps --no-audit --no-fund
bash .github/scripts/check-billing-hub-boundary.sh
node scripts/verify-clinical-recovery-provenance.mjs
npx eslint src --max-warnings=0
npx tsc --noEmit --project tsconfig.app.json
npx tsc --noEmit --project tsconfig.node.json
npm test
npm run build
```

Billing Hub's Zeffy synthetic suite is separately prepared:

```sh
node --test supabase/functions/zeffy-webhook/contract.test.mjs
```

Do not execute the authenticated Zeffy audit until trusted read access is configured; its separate runbook explains the command, partial-report behavior and PII limits. No credentials belong in tracked files/chat.

## Useful operator checks after the automated gate

1. Use authorized operator/readonly accounts in two authorized tenants. Switch tenants and sessions while loading contacts, Tasks, pipeline details and relationship history; confirm unavailable/error states do not display old successful data. Exercise wrong-tenant IDs through the deferred signed-JWT matrix.
2. Walk through task creation/editing/owner/due/description clearing, completion/reopen, filtered pages/back/forward and relationship links with approved non-production fixtures.
3. Check pipeline stage actors, owner directory beyond 500 entries, record bookmarks, saved views, source rejection/refresh and independent funnel metrics. No send, approval or provision action is necessary for navigation checks.
4. Inspect Auth allowlist/templates without messages. Private-browser invitation/recovery delivery checks need an explicitly approved recipient; preserve client and clinician flows.
5. Review Zeffy settings and authoritative Foundation mapping without creating a gift/refund. Keep Donation form opened and verified actual-donation reporting separate.

Record implementation, database application, configuration, deployment and verification as distinct statuses. Keep all failed/unrun checks and incomplete backend contracts open. Roll back application source through GitHub; retain migration, identity and donation audit/history and use reviewed forward repairs after use.

## Subsequent source batches

Client draft PR #31 (12c46bc) prepares the accepted staff-only redirect; staff draft PR #30 (5ebb2e9) prepares full applicant workspace paging and a reference marker in authorized results. CRM source adds those locators, URL-backed BTY directory returns, conditional ordinary BTY edits, additional interaction pages, connected-source traversal safeguards and Exception permission/error handling. All checks remain deferred; no configuration/schema/data/release changes. Earlier unimplemented staff routing/URL-selector notes are historical; exact-record API/SSO/transport and signed-role acceptance remain open. See the continuation progress notes for precise behavior and limits.
