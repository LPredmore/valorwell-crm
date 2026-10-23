# Gmail → CRM sync incident, 2026-10-22/23

## Root cause
Edge Function code that calls `record_relationship_gmail_retrieval_failure` and
`record_relationship_gmail_source_receipt` was deployed. The four reviewed migrations that
define those objects were committed but never applied to production:
20261022195806, 195848, 195938 and 200829. Later migrations were applied, so the ledger
looked current. Every Gmail sync after 2026-10-22 15:00:55 UTC failed with PGRST202. Cron
still reported "succeeded", but that only means the HTTP request was sent. Watch renewal
kept working, which hid the failure.

## Repair (2026-10-23, ~15:55–16:05 UTC)
- Applied the four files unchanged as new forward-only migrations, in their original order.
  No ledger edits, no fake versions, no cursor reset.
- Verified: all six functions exist with `search_path=''`. The writer functions are
  service_role only. The anon role is denied on all of them. The two read-only staff reports
  require authentication and are tenant-scoped. The receipts table has no browser access.
- Reloaded the PostgREST schema cache. Redeployed `relationship-gmail-push` and
  `relationship-google-maintenance` from current source. Calendar observation stays off.
  OAuth and Pub/Sub are unchanged.
- Pre-repair snapshot: cursor 3485910; last success 2026-10-22 15:00:55.843913 UTC; last
  push 2026-10-22 21:16:36 UTC; watch expires 2026-10-30.

## Recurrence guards
- `scripts/check-edge-rpc-contracts.mjs` runs in CI. It fails when an Edge Function calls
  an RPC that no tracked migration defines. Seven verified-live legacy RPCs are allowlisted.
- `scripts/gmail-runtime-contract.sql` is a read-only predeploy check of the live
  signatures and grants. Every row must be `ok = true`.
- `get_relationship_gmail_diagnostics()` reports seconds since the last verified success
  (60-minute warning, 240-minute critical).
