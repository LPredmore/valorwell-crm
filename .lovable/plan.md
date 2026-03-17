

# Fix: Communication Received filter showing polluted data

## Root cause (confirmed)

Line 924 of `helpscout-proxy/index.ts`:

```javascript
if (!eventType?.includes("customer.reply") && !eventType?.includes("convo.created")) {
```

This treats `convo.created` webhooks identically to `convo.customer.reply.created` webhooks. Both paths flow into line 981, which inserts `event_type: 'email_received'` into `crm_activity_events`.

When the campaign scheduler sends an outbound email, HelpScout fires a `convo.created` webhook. The proxy records it as `email_received`. The database now has 384 fake "received" rows from campaign sends in the last 24 hours alone, inflating the filter from ~12 real clients to 369.

## The decision

**Remove `convo.created` from the webhook handler's accepted event types.** Only `customer.reply` represents an actual inbound message from a client. Here's why this is the right call:

1. `convo.created` fires for *any* new conversation — outbound staff-initiated, campaign-created, or customer-initiated. There is no reliable way to distinguish "customer started this" from "our system started this" using only the webhook payload structure.
2. HelpScout has a dedicated event for when a customer actually replies: `convo.customer.reply.created`. This is already handled.
3. The campaign auto-pause feature (lines 990–1040) also runs on `convo.created`, which means outbound campaign emails could theoretically pause *other* active campaigns for the same client — a second bug from the same root cause.
4. Keeping `convo.created` and trying to filter by payload heuristics (e.g., checking if the conversation was created by a user vs. customer) is fragile and couples the webhook handler to HelpScout's internal data model.

## Implementation

### 1. Fix the webhook event filter (edge function)

**File:** `supabase/functions/helpscout-proxy/index.ts`, line 924

Change:
```javascript
if (!eventType?.includes("customer.reply") && !eventType?.includes("convo.created")) {
```
To:
```javascript
if (!eventType?.includes("customer.reply")) {
```

This is a one-line change. Only true customer replies will be processed — logging `email_received` and triggering campaign auto-pause.

### 2. Clean up polluted historical data

Run a SQL migration to delete the misclassified rows:

```sql
DELETE FROM crm_activity_events
WHERE event_type = 'email_received'
  AND metadata->>'source' = 'webhook'
  AND metadata->>'helpscout_event' = 'convo.created';
```

The metadata already distinguishes `convo.created` from `convo.customer.reply.created` (it stores the raw `helpscout_event` value), so this is a precise, safe cleanup — it won't touch legitimate inbound records.

### 3. Deploy and verify

Deploy the updated edge function, then confirm the filter returns a realistic number.

## What this fixes

- **Communication Received filter**: Will show only clients who actually sent a message (email reply or SMS), not clients who received outbound campaign emails
- **Campaign auto-pause**: Will no longer falsely trigger on outbound-initiated conversations
- **Historical data**: Cleaned up so past filter queries are also accurate

## What this does NOT change

- The `useClients.ts` hook logic — it's already correct (queries `email_received` and `sms_received`)
- The `CommunicationReceivedFilter` component — already correct
- SMS inbound handling in `ringcentral-sms` — unaffected, already only processes true inbound

