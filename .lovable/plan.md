

# Fix: Bulk Status Change Fails for Clients with Active Campaign Enrollments

## Root Cause

The error is NOT in the CRM application code. Both `useBulkUpdateStatus` and `useUpdateClientStatus` are written correctly. The bug is in the database.

When you change a client's status, a database trigger (`trg_cancel_campaign_on_status_change`) fires to automatically cancel any active campaign enrollment for that client. As part of that trigger, it tries to log an audit event with `event_type = 'campaign_auto_cancelled'`. But the `crm_activity_events` table has a CHECK constraint that only allows these event types:

- status_change
- note_added
- email_sent
- email_received
- conversation_linked
- bulk_send

`campaign_auto_cancelled` is not in that list. The constraint rejects the insert, the trigger fails, and the entire transaction (including the original status update) rolls back. PostgREST reports this as a 400 error.

This affects ANY status change (bulk or single) on ANY client that has an active campaign enrollment. The profile page appeared to work only because that particular client had no active enrollment at the time.

## The Fix

One database migration that adds `campaign_auto_cancelled` to the check constraint on `crm_activity_events.event_type`. While we are at it, we should also add `sms_sent` and `sms_received` since the SMS features exist and will likely need audit logging too.

No application code changes are needed. No table structure changes (columns stay the same). This only widens the set of allowed string values in an existing constraint.

### Migration SQL

```sql
ALTER TABLE crm_activity_events
  DROP CONSTRAINT crm_activity_events_event_type_check;

ALTER TABLE crm_activity_events
  ADD CONSTRAINT crm_activity_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'status_change',
    'note_added',
    'email_sent',
    'email_received',
    'conversation_linked',
    'bulk_send',
    'campaign_auto_cancelled',
    'sms_sent',
    'sms_received'
  ]));
```

### TypeScript Type Update

Update the `CrmActivityEvent` interface in `src/lib/crm/types.ts` to include the new event types so the frontend type system stays in sync:

```typescript
event_type: 'status_change' | 'note_added' | 'email_sent' | 'email_received'
  | 'conversation_linked' | 'bulk_send' | 'campaign_auto_cancelled'
  | 'sms_sent' | 'sms_received';
```

## What This Does NOT Change

- No columns are added, removed, or modified on any table
- No existing data is affected
- No application logic changes
- No new tables
- The trigger function itself is correct and does not need modification

## Risk Assessment

Minimal. Dropping and re-adding a CHECK constraint is a metadata-only operation in Postgres -- it does not lock the table or rewrite data. The only behavioral change is that the trigger will now succeed instead of crashing, which is the intended behavior.

