

# Plan: Clean up 385 polluted `crm_activity_events` rows

## Context

The edge function fix is already deployed — no new `convo.created` rows will be written as `email_received`. What remains is deleting the 385 historical misclassified rows (370 distinct clients, spanning March 12–17).

## The change

Run a single DELETE via the insert tool (this is a data operation, not a schema change):

```sql
DELETE FROM crm_activity_events
WHERE event_type = 'email_received'
  AND metadata->>'source' = 'webhook'
  AND metadata->>'helpscout_event' = 'convo.created';
```

This is precise and safe:
- The `metadata->>'helpscout_event'` field distinguishes `convo.created` from `convo.customer.reply.created` — no legitimate inbound records will be touched.
- 385 rows removed. Zero side effects on campaign enrollments, step logs, or any other table.

## What happens after

- The Communication Received filter will immediately reflect accurate counts (the ~12 real clients instead of 369).
- Client detail timelines will no longer show phantom "email received" entries for outbound campaign sends.
- No other tables, triggers, or functions are affected.

## Verification

After the delete, I'll run a quick count query to confirm the remaining `email_received` rows all have `helpscout_event = 'convo.customer.reply.created'` or `source != 'webhook'`.

