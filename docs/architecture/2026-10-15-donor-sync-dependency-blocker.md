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
