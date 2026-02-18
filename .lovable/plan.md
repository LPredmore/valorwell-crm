

# Activity Event Logging for Emails and SMS

## Problem

The `crm_activity_events` table and UI are fully wired to display communication events (`email_sent`, `email_received`, `sms_sent`, `sms_received`, `bulk_send`), but none of the three edge functions that actually send or receive messages ever insert rows into this table. The result: the Activity timeline on client profiles is blind to all communications.

## Technical Decision: Server-Side Logging in Edge Functions Only

All activity event inserts will happen inside the edge functions themselves -- not in the frontend hooks. This is the correct decision for three reasons:

1. **Single source of truth.** The edge function is the only code that knows whether a message was actually delivered. Frontend hooks fire optimistically; they don't know if the API call succeeded. Logging at the point of confirmed delivery prevents phantom entries.

2. **Coverage of automated paths.** The campaign scheduler runs on a cron job with zero frontend involvement. If logging lived in React hooks, campaign emails and SMS would never appear. Server-side logging covers manual, bulk, and automated paths uniformly.

3. **Atomicity with existing writes.** Each edge function already writes to recipient/log tables on success. Adding one more insert in the same code block keeps the audit trail consistent -- if the send status updated, the activity event exists, and vice versa.

## No Database Changes Required

The `crm_activity_events` table already has a CHECK constraint permitting all needed event types. The `metadata` JSONB column accommodates any extra context (subject lines, campaign names, phone numbers). No schema migration is needed.

## No Frontend Changes Required

`ActivityItem.tsx` already renders `email_sent`, `email_received`, `sms_sent`, and `sms_received` with appropriate icons. `ActivityTimeline.tsx` fetches all event types from the table. Once rows exist, they will appear automatically.

## Changes by File

### 1. `supabase/functions/helpscout-proxy/index.ts`

Three insertion points:

**a) Bulk email send (handleBulkSend, ~line 296-303)**
After each successful recipient send (where status is set to "sent"), insert an `email_sent` event for client recipients only (staff recipients have no `client_id` in the activity table). Use `bulkSendLog.tenant_id` for tenant. Set `created_by_profile_id` to null (system-initiated). Store subject in metadata.

**b) Manual reply (case "reply", ~line 647-660)**
After confirmed success from HelpScout, the function does not currently know the `client_id`. The reply action receives `conversationId` but not the client. Two options: (1) accept `clientId` as an optional parameter from the frontend hook, or (2) skip logging replies here and rely on the webhook for "email_received" only. The right call is option (1): pass `clientId` from the frontend `useReplyToConversation` hook, since the hook's caller already has the client context. The edge function logs `email_sent` only when `clientId` is provided, making it backward-compatible.

**c) Inbound email webhook (handleWebhook, ~line 928-961)**
After finding matching clients and processing campaign pauses, insert an `email_received` event for each matched client. Use the client's `tenant_id`. Store the webhook event type in metadata.

### 2. `supabase/functions/ringcentral-sms/index.ts`

Two insertion points:

**a) Bulk SMS send (processBulkSms, after successful send ~line where status is set to "sent")**
For client recipients only (not staff), insert an `sms_sent` event. The `client_id` is available via the recipient join. Use `smsLog.tenant_id`.

**b) Inbound SMS webhook (handleInboundSms, after logging to crm_inbound_sms_logs)**
If a client match was found, insert an `sms_received` event. The `client_id` and `tenant_id` are already resolved. Store the from_phone in metadata.

### 3. `supabase/functions/campaign-scheduler/index.ts`

Two insertion points, both inside the main processing loop:

**a) After successful email send (~line 628-638)**
Insert `email_sent` with `stepLog.client_id` and `stepLog.tenant_id`. Store campaign name and step order in metadata to distinguish campaign-originated emails from manual ones.

**b) After successful SMS send (~line 666-671)**
Insert `sms_sent` with the same pattern. Include campaign context in metadata.

### 4. `src/hooks/crm/useReplyToConversation.ts`

Pass `clientId` as an optional field in the mutation params. The hook's callers (ReplyComposer) already have the client context from the conversation. Forward it to the edge function so it can log the activity event. This is the minimal frontend change -- it adds one optional field to an existing API call.

### 5. `src/components/crm/inbox/ReplyComposer.tsx` (minor)

Pass the `clientId` (already available from conversation data) into the `useReplyToConversation` mutation call.

## Metadata Schema Convention

All inserts will use a consistent metadata shape:

```text
email_sent:     { source: "bulk"|"reply"|"campaign", subject?, campaign_id?, campaign_name?, step_order? }
email_received: { source: "webhook", helpscout_event? }
sms_sent:       { source: "bulk"|"campaign", campaign_id?, campaign_name?, step_order? }
sms_received:   { source: "webhook", from_phone? }
```

This lets the UI optionally enrich the timeline later (e.g., "Email sent via Campaign: Re-engagement Step 2") without requiring another schema change.

## Potential Side Effects

- **Volume**: High-volume bulk sends will generate one activity event per recipient. For a 500-person bulk email, that is 500 new rows. This is correct behavior -- each client's timeline should show their individual communication. The table already limits to 50 rows per client in the UI query.
- **Edge function execution time**: Each insert adds ~5-10ms. For bulk operations already spending 150-2000ms per recipient on API calls, this is negligible.
- **No risk to shared tables**: All writes target `crm_activity_events`, a CRM-prefixed table. No shared production tables are modified.

## Execution Order

1. Update `helpscout-proxy/index.ts` (3 insertion points)
2. Update `ringcentral-sms/index.ts` (2 insertion points)
3. Update `campaign-scheduler/index.ts` (2 insertion points)
4. Update `useReplyToConversation.ts` and `ReplyComposer.tsx` (pass clientId)
5. Deploy all three edge functions
6. Test by sending a bulk email, a manual reply, and checking the Activity tab

