

# Fix Bulk Email Delivery - Corrected Implementation Plan

## Problem Summary

After implementing the two-step process, bulk emails are still failing. The edge function logs show:
- Step 1 (create conversation) **succeeds** - conversations are created in HelpScout
- Step 2 (send reply) **fails** with error: `"path": "customer", "message": "must not be null"`

## Root Cause

The HelpScout API documentation explicitly states that the `customer` field is **required** for the reply endpoint:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | String | Y | The reply message |
| `customer` | Object | **Y** | Customer being replied to |

**Current code (broken):**
```typescript
const replyBody = {
  text: bulkSendLog.body_html,
  status: "active",
};
```

**What HelpScout requires:**
```typescript
const replyBody = {
  text: bulkSendLog.body_html,
  status: "active",
  customer: { email: recipient.email },  // REQUIRED
};
```

The `customer` object tells HelpScout WHO to send the email to. Without it, HelpScout rejects the request with a 400 Bad Request.

---

## Implementation Change

### File: `supabase/functions/helpscout-proxy/index.ts`

**Lines 309-312** - Add the required `customer` field to the reply body:

```typescript
// STEP 2: Add reply to trigger actual email delivery
const replyBody = {
  text: bulkSendLog.body_html,
  status: "active",
  customer: {
    email: recipient.email,
  },
};
```

This is a 3-line addition to the existing code block.

---

## Why This Is the Right Fix

1. **API Documentation is explicit**: The HelpScout API v2 documentation at `developer.helpscout.com/mailbox-api/endpoints/conversations/threads/reply/` marks `customer` as required with "Y"

2. **Error message confirms**: The logs show `"path": "customer", "message": "must not be null"` - HelpScout is telling us exactly what's missing

3. **Minimal change**: We don't need to restructure the approach - the two-step flow is correct, it's just missing one required field

4. **Consistent with API design**: HelpScout needs to know the recipient email to route the SMTP delivery, even though the conversation already has a customer attached

---

## Technical Details

### What Each Step Does

**Step 1 - Create Conversation:**
- Establishes the conversation record in HelpScout
- Links the customer (recipient) to the conversation
- Creates a placeholder inbound thread
- Returns conversation ID via Location header

**Step 2 - Send Reply (with fix):**
- Uses the conversation ID from Step 1
- Sends the actual email content as a reply thread
- `customer.email` tells HelpScout where to deliver the email
- `status: "active"` activates the conversation
- HelpScout dispatches the email via SMTP

### Rate Limiting
The existing 150ms delay between recipients remains in place to respect HelpScout's API limits.

---

## Testing After Deployment

1. Select 1-2 staff members on the Staff page
2. Compose and send a test email
3. Verify in the edge function logs that both steps succeed
4. Check recipient's Gmail inbox for actual delivery
5. Confirm conversation appears in HelpScout with the reply thread

---

## Recovery for Previous Failed Sends

Once the fix is deployed, the 3 failed staff emails from the "EHR Update" bulk send can be resent by resetting their status to `pending` and re-triggering the bulk send job.

---

## Summary

| Item | Details |
|------|---------|
| **Root Cause** | Missing required `customer` field in reply request |
| **Fix** | Add `customer: { email: recipient.email }` to reply body |
| **Lines Changed** | 3 lines added in helpscout-proxy/index.ts |
| **Risk Level** | Very Low - single field addition |
| **Testing** | Send 1-2 test emails to staff, verify Gmail delivery |

