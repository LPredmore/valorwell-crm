# Donor synchronization dependency evidence

Date: 2026-10-15 UTC (October 14 evening America/Chicago). Read-only discovery only. No donor transaction queued/processed, source record edited, communication sent or worker activated.

Task 40 remains OPEN. The October 9 roadmap note that the identity registries are empty describes current records, not the behavior of the donor ingestion code. The existing code needs a complete cross-app migration/dependency review before changes.

## Directly inspected current code

Live Billing Hub `ahqauomkgflopxgnlndd` definitions:

- `private.crm_process_donor_transaction(uuid,text,boolean)` reads `givebutter_donations`, reads an email from `raw.data`, looks up `crm_person_identities` by normalized email, and creates `crm_people`/`crm_person_identities` if absent. It can also insert `crm_person_records`. This conflicts with the chosen conservative reviewed-link approach if the donor workflow is expanded unchanged.
- The same function adds one to `donation_count` and adds the donation amount to `lifetime_amount` on each successful processing invocation. There is no transaction-ledger uniqueness check inside this function. The outer queue unique key and pending-only processing limit ordinary repeats, but do not prove replay-safe donor aggregation for reprocessing/repair paths. This is a code risk, not a reproduced duplicate transaction incident.
- It emits `donor.donation_received`, `donor.first_one_time_donation`, and `donor.first_recurring_donation` through `crm_emit_automation_event`. Historical processing sets `suppress_campaign_trigger`; nonhistorical processing can participate in existing automation. Do not invoke as a diagnostic or reconciliation test against live records.
- `public.crm_enqueue_donor_transactions` selects all available Givebutter transactions into the current tenant queue. The source `givebutter_donations` table has no tenant column. A reviewed campaign/account-to-tenant ownership contract is needed before expanding this path.
- `public.crm_donor_overview` includes a global `givebutter_donations` count alongside tenant-filtered donor/queue data. Do not expose this RPC as a new tenant dashboard metric without its authorization/data-scope audit.
- `public.crm_process_donor_queue` locks pending rows with SKIP LOCKED, processes inside per-item exception blocks, records status/attempts, and appends CRM activity. Do not reset failed/processed work without an approved repair design.
- `crm_donors` has one aggregate lifetime amount and no currency column. Per-currency transaction accounting must be defined before treating mixed-currency totals as a coherent amount.

GitHub `LPredmore/valorwell-billing-hub` immutable tree `9d9819e0f378c1e263ab2736a1b3172df49431b7`:

- `supabase/functions/givebutter-webhook-v2/index.ts` (blob `aa66901652932d13e491e37ced649870da7ceb60`) handles `transaction.succeeded`, authenticates a shared webhook key by hash and limits to a campaign. It stores raw transactions and uses a read-before-write update/insert sequence. It does not implement recurring pause/cancel/status reconciliation. Its accepted `raw.data.transaction` shape can differ from the donor processor's flat `raw.data` field lookup.
- `supabase/functions/givebutter-webhook/index.ts` (blob `aeec0fdcd04c0448d4b515325b1e0b28ac131b88`) is a legacy alternative with different parsing/authentication behavior. Deployment/configuration evidence must establish the active path before editing or retiring either handler. Repository code alone does not prove which handler receives current Givebutter delivery.

No scheduled donor/Givebutter cron job was found by job name in the live catalog. This does not rule out generic dispatch jobs, external webhooks or manual consumers; complete consumer discovery remains outstanding.

## Required next review and deferred checks

Inventory every consumer of donor RPCs/tables, views, shared registries and automation events across repositories, deployed Edge Functions, webhook subscriptions and jobs. Inspect current grants/RLS/view invoker settings, queue uniqueness, current aggregate data and actual authoritative event payloads without exposing PII. Decide explicit source ownership, money units/currency, stable donor/source IDs, transaction idempotency, recurring lifecycle and human-reviewed CRM contact linking. Preserve donation attribution/Google Ads upload contracts and current outreach suppression.

Prepare a forward migration strategy and affected-file/object inventory for approval before schema-contract implementation. Do not enable ingestion merely to make a dashboard appear populated. Append event replay/concurrency, recurring lifecycle, currency totals, source-tenant ownership, reviewed identity linking and zero-unsolicited-communication acceptance to Task 42.

This evidence establishes implementation gaps and unresolved contracts; no behavioral, security or financial reconciliation pass is claimed.

## October 15 continuation: expanded static dependency review

Read-only catalog/deployed-source discovery; no processing, enqueue, replay, schema change, grant change or source write. Reviewed CRM branch `0c816b9fb45e48d1a73519a66bffcee8c22dd0a3`, Billing Hub `9d9819e0f378c1e263ab2736a1b3172df49431b7`, staff `2386d0334b23c67febc038bdb8f4971d9b8d7bda`, live donor definitions/grants and deployed webhook source. This is not a complete inventory of external subscriptions or inaccessible consumers.

### Objects and consumers

| Object/consumer | Observed dependency and implication |
| --- | --- |
| `givebutter-webhook` v17 | ACTIVE in the deployed catalog; legacy transaction upsert keyed by `transaction_id`. Deployment does not establish that Givebutter sends to it. |
| `givebutter-webhook-v2` v17 | Also ACTIVE; source accepts only `transaction.succeeded`, enforces campaign `565036`, parses nested/flat shapes and stores raw payload. It checks for an existing row before update/insert. No recurring cancellation/pause handler. Deployment does not establish subscription configuration or amount units. |
| `google-ads-givebutter-feed` v23 / `claim_google_ads_donations` | Existing donation attribution/upload consumer. Preserve transaction/token/ads state and claim semantics; do not use a CRM ledger repair to reset attribution or resubmit conversions. Claim RPC execute is denied to anon/authenticated. |
| `donate-go`, `givebutter-cutover-check` v18 | Donation entry/cutover dependencies. Inspect their authoritative configuration before retiring a handler. Do not invoke diagnostics that may write. |
| `crm_donor_transactions_v` | Authenticated SELECT granted, no `security_invoker` option. Joins global source transactions to donors by contact ID using `IS NOT DISTINCT FROM`, or by normalized email, without an explicit tenant predicate. Missing contact IDs can therefore join unrelated records. Owner privilege/RLS interaction requires a reviewed restriction; do not expose as a new CRM reporting source. Anon SELECT is already revoked. |
| `private.crm_process_donor_transaction(uuid,text,boolean)` | SECURITY DEFINER with empty search path, but no caller/tenant authorization in its body. Authenticated has private-schema USAGE and EXECUTE; anon has EXECUTE but not private-schema USAGE. Catalog privileges alone do not prove HTTP reachability because private-schema API exposure was not established. Restrict direct calls in the migration design; retain a properly authorized wrapper for legitimate consumers. |
| `crm_enqueue_donor_transactions` | Authenticated EXECUTE granted; reads global source transactions into the context tenant's queue. Campaign/account ownership is not enforced by source tenancy. |
| `crm_process_donor_queue` | Authenticated/anon EXECUTE currently denied. Uses authorized context, pending-only `FOR UPDATE SKIP LOCKED`, exception accounting and activity logging; invokes the private processor. Do not restore grants merely to populate CRM. |
| `crm_donors`, `crm_donor_ingest_queue` | RLS enabled; inspected SELECT policy checks tenant membership. Queue unique key is `(tenant_id,transaction_id)`; source PK is `transaction_id`. Neither proves financial exactly-once behavior inside the processor. |
| CRM giving cards | Reads only explicitly linked contact aggregates from `crm_donors`, not the transaction view or ingestion RPCs. Current source changes scope the cache by tenant/user/role, hide cached enrichment on errors and label aggregates as unreconciled with no currency attribution. No ingestion expansion. |
| CRM campaigns/newsletters/control plane | Donor audience, automation events and legacy registries are consumers. Preserve suppression and all execution holds. Event uniqueness does not make aggregate increments idempotent. |

No cron command text matched donor/Givebutter names during discovery. Generic dispatch, external/manual invocations and provider subscriptions remain outside this evidence. No non-generated donor consumer was found in the inspected staff application source. This does not prove global absence.

Aggregate-only snapshot: 9 source transactions, USD only in current rows, 3 flat-email payloads, zero nested `data.transaction` objects; 1 donor with no relationship-contact link; empty ingest queue. These counts are not reconciliation or an ownership decision. No donor identifiers, addresses or raw payloads were exported. Current USD-only rows do not establish the future currency contract.

### Proposed forward strategy — not applied

1. Establish authoritative Givebutter account/campaign-to-tenant ownership, configured delivery endpoint and redacted payload/event contracts (including amount units, currency, source event IDs and recurring plan updates). Reject unmapped/ambiguous events; never assign all global payments to whichever tenant invokes enqueue.
2. Review all existing dependent views, private/public routines, automation/registry consumers, ads attribution and deployed webhook variants. Inventory external subscriptions and any additional application consumers before finalizing the migration. Restrict unsafe direct processor execution and transaction-view access as a reviewed, separately tracked repair; do not activate ingestion as part of that repair.
3. Introduce a tenant-owned immutable transaction/event ledger with source-account transaction uniqueness and explicit currency/units. Persist source IDs independently of CRM contacts. Require a human-reviewed contact link; remove legacy email identity creation from any replacement path. Do not backfill identities or populate registries.
4. Apply each ledger entry once in one transaction; aggregate by currency from the ledger rather than add on every invocation. Keep historical backfill communication-suppressed. Preserve source ads attribution and existing delivery/automation holds. Treat corrections/refunds as explicit ledger events, not destructive source rewrites.
5. Define recurring plan state from authoritative lifecycle events with stable plan identity, source ordering/watermarks and handling of delayed delivery. A recurring gift alone cannot prove a plan remains active. Keep uncertain/unmapped lifecycle states unavailable for automated decisions.
6. Publish the affected-object inventory and reviewed forward SQL before database-contract implementation. Preserve existing source tables/records and audit history; no blind historical migration replay. Roll back application access first, retain ledger/audit evidence and use a forward repair after any use.

### Concrete blockers / next actions

- Obtain authoritative campaign `565036` owner tenant, provider webhook subscription URL/status, amount-unit contract and recurring event documentation or sanitized fixtures. These cannot be inferred from a deployed handler or current counts. An asynchronous question was sent to the user for these non-secret details.
- Finish external/other-repository consumer inventory and review the explicit view/private-RPC restrictions plus ledger/lifecycle contract before migration implementation. The catalog findings are static evidence, not executed exploit tests.
- Run controlled replay/concurrency/currency/source-isolation/recurring acceptance only in the deferred Task 42 pass after the contract is agreed. Never run live enqueue/process as a diagnostic.

Task 40 remains OPEN. This continuation advances the dependency review and conservative UI handling; it does not complete payment or recurring-giving synchronization.
