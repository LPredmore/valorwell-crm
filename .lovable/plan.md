
# Plan: Fix Campaign Email Quote Issue

## Problem
Campaign emails show a quoted reply chain at the bottom: `"On Sat, Feb 7, 2026 at 4:42 PM UTC, Carson Pritchett wrote: (Campaign outreach)"`.

This happens because the current implementation:
1. Creates a HelpScout conversation with a fake **"customer" type thread** containing "(Campaign outreach)"
2. Then sends a **"reply"** to that fake message

Email clients treat this as a reply thread and show the quoted original message.

## Solution
Change the email creation to use HelpScout's **"message" type thread** instead. A "message" thread represents an outgoing staff-initiated email that doesn't need a reply pattern and won't include quoted content.

---

## Changes

### File: `supabase/functions/campaign-scheduler/index.ts`

Update the `sendEmail` function (around lines 309-386) to send a single outgoing message instead of the two-step create-customer-then-reply pattern:

**Current approach (lines 326-344):**
```typescript
threads: [
  {
    type: 'customer',
    customer: { email: toEmail },
    text: '(Campaign outreach)',
  },
],
```
Then replies with the actual content.

**New approach:**
```typescript
threads: [
  {
    type: 'message',
    customer: { email: toEmail },
    text: bodyHtml,
  },
],
status: 'active',
```

This sends the email directly without creating a fake customer message to reply to.

---

## Technical Details

The HelpScout API supports these thread types:
- `customer` - Inbound message from customer (what we're incorrectly using)
- `message` - Outbound email sent by staff (correct for campaigns)
- `reply` - Staff reply to a customer message

Using `type: 'message'` in the initial conversation creation:
1. Creates the conversation
2. Sends the email immediately
3. No quoted reply chain appears

The function will be simplified to a single API call instead of two calls (create + reply).

---

## Files Modified

| File | Changes |
|------|---------|
| `supabase/functions/campaign-scheduler/index.ts` | Rewrite `sendEmail` function to use "message" thread type |
