
Diagnosis summary (no fix proposals)

I traced this end-to-end through code, DB schema, live DB state, network logs, console logs, and Postgres logs.  
The current failure is not the old unique-enrollment problem anymore.

What is happening right now

1. Your UI sends this request:
- PATCH /rest/v1/clients?id=eq.572593d4-a290-42ee-894b-07c70a6dd3a4
- body: {"pat_status":"Matching"}

2. The DB receives that status change and runs status-change triggers on clients:
- trg_cancel_campaign_on_status_change
- trg_enroll_campaign_on_status_change

3. For this client/status, auto-enroll logic is active:
- There is an active campaign trigger for status "Matching" in crm_campaign_triggers.
- This client currently has a paused enrollment (not active), so auto-enroll proceeds.

4. During auto-enroll, the DB function enroll_campaign_on_status_change tries to insert an activity row with:
- event_type = 'campaign_auto_enrolled'

5. That insert is rejected by a DB check constraint:
- constraint: crm_activity_events_event_type_check
- allowed values include status_change, note_added, email_sent, email_received, conversation_linked, bulk_send, campaign_auto_cancelled, sms_sent, sms_received
- it does NOT allow campaign_auto_enrolled

6. Postgres throws:
- SQLSTATE 23514 (check constraint violation)
- message: new row for relation "crm_activity_events" violates check constraint "crm_activity_events_event_type_check"

Why the status update fails in the UI

Because this error happens inside the same database transaction as the client status update, Postgres rolls the whole transaction back.  
So from your perspective:
- status change fails
- toast shows “Failed to update client status”
- client remains on old status

Evidence confirmed from live DB/logs

- Postgres logs show the exact failing statement inside enroll_campaign_on_status_change inserting 'campaign_auto_enrolled'.
- Network response for the PATCH request returns 400 with code 23514 and that same constraint error.
- Client row still has status "Legacy - Has Therapist Available" (unchanged after attempt).
- No new enrollment row was committed for this attempt (client still only has the paused prior enrollment).
- No new activity event row for campaign_auto_enrolled exists (insert failed and rolled back).
- Two failed attempts were logged at ~21:19:35 and ~21:19:50 UTC.

Important context about the previous issue

The earlier unique-constraint issue (23505) appears resolved:
- global unique constraint on (tenant_id, client_id) is gone
- partial unique index for active-only exists (crm_campaign_enrollments_one_active)
So the current blocker is specifically the activity-event check constraint mismatch with trigger behavior.

Unrelated warning you also saw

There is a React warning about refs in ActivityItem/StatusBadge.  
That is a front-end rendering warning and not the cause of this database failure.
