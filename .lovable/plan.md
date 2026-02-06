

# Fix Bulk Email Delivery - Implementation Plan

## Problem Statement

Bulk emails are being logged in HelpScout but NOT delivered to recipients' email inboxes. The conversations appear in HelpScout's UI, but the actual email is never sent out.

## Root Cause Analysis

After investigating the HelpScout API documentation and the current implementation:

**Current Implementation (broken):**
```typescript
// Single API call - creates conversation with embedded reply thread
POST /v2/conversations
{
  subject: "...",
  customer: { email: "recipient@example.com" },
  type: "email",
  threads: [{ 
    type: "reply",  // Outbound message
    customer: { email: "recipient@example.com" },
    text: "..."
  }]
}
```

**The Issue:** When creating a conversation with an embedded `reply` thread via `POST /v2/conversations`, HelpScout logs the message as "sent" in the conversation history, but does NOT actually dispatch the email to the recipient. This is because the conversation creation endpoint is designed for importing/logging conversations, not for sending new outbound emails.

**Evidence:**
- The API returns 201 (success) and our database shows `status: sent`
- Conversations appear in HelpScout's web UI with the message content
- But recipients never receive the email in their Gmail/email client

**Working Pattern (from existing reply action):**
```typescript
// Two-step process - this DOES send email
// Step 1: Create conversation
POST /v2/conversations  
// Step 2: Add reply (triggers actual email delivery)
POST /v2/conversations/{id}/reply
```

## Technical Decision: Two-Step Conversation + Reply Flow

**Why this is correct:**

| Approach | Outcome |
|----------|---------|
| Single call with embedded `reply` thread | Logs message but does NOT send email |
| Two-step: create conversation + add reply | Actually triggers email delivery |

The HelpScout API distinguishes between:
- `POST /v2/conversations` with threads = **Import/log messages** (historical records)
- `POST /v2/conversations/{id}/reply` = **Send actual email** (triggers SMTP delivery)

This is consistent with how the existing single-reply feature works (lines 631-634 of helpscout-proxy) which uses the dedicated reply endpoint.

---

## Implementation Changes

### File Modified: `supabase/functions/helpscout-proxy/index.ts`

Update the `handleBulkSend` function to use a two-step process:

**Step 1: Create minimal conversation (no message content)**
```typescript
const createBody = {
  subject: bulkSendLog.subject,
  customer: {
    email: recipient.email,
    firstName: recipient.firstName,
    lastName: recipient.lastName,
  },
  mailboxId: parseInt(mailboxId || "0"),
  type: "email",
  status: "pending",  // Start as pending, reply will activate
  threads: [{
    type: "customer",  // Placeholder inbound message
    customer: { email: recipient.email },
    text: "(Outbound email initiated)"
  }]
};

const createResponse = await helpscoutRequest("POST", "/conversations", createBody);

// Extract conversation ID from Location header
const location = createResponse.headers.get("Location");
const conversationId = location?.split("/").pop();
```

**Step 2: Add reply to trigger actual email delivery**
```typescript
const replyBody = {
  text: bulkSendLog.body_html,
  status: "active"  // Activates the conversation
};

const replyResponse = await helpscoutRequest(
  "POST", 
  `/conversations/${conversationId}/reply`, 
  replyBody
);
```

### Changes Summary

```text
Lines 244-270 (handleBulkSend conversation creation block)
├── Replace single POST /conversations call
├── Split into two API calls:
│   ├── POST /conversations (create with placeholder)
│   └── POST /conversations/{id}/reply (send actual email)
├── Add error handling for both steps
└── Maintain 150ms rate limiting between recipients
```

---

## Additional Improvements

### 1. Add Resend Capability for Failed Staff Emails

Since the original 3 staff emails never delivered, add ability to retry:

**Database check for undelivered emails:**
```sql
-- These need to be resent
SELECT id, staff_id FROM crm_bulk_send_staff_recipients 
WHERE bulk_send_id = '1cdc81c5-24ad-415c-ae72-7459f3f48df2';
```

**Option A (Manual):** Mark recipients as `pending` and re-trigger bulk send
**Option B (Recommended):** Add a "Resend" button in the UI for completed bulk sends

### 2. Add Logging for Email Delivery Verification

Add detailed logging to confirm email delivery:
```typescript
console.log(`Created conversation ${conversationId} for ${maskEmail(recipient.email)}`);
console.log(`Reply sent to conversation ${conversationId}, response: ${replyResponse.status}`);
```

---

## Testing Checklist

1. **Fix verification** - Send test email to a staff member, verify Gmail receipt
2. **Client bulk send still works** - Send to 1-2 clients, verify delivery
3. **Staff bulk send works** - Send to 1-2 staff, verify delivery
4. **Edge function logs** - Verify two-step process in logs
5. **HelpScout verification** - Check conversation shows reply thread (not embedded)

---

## Recovery Plan for Original Failed Emails

The original "EHR Update" email content is preserved in the database:

```sql
SELECT body_html FROM crm_bulk_send_logs 
WHERE id = '1cdc81c5-24ad-415c-ae72-7459f3f48df2';
```

After deploying the fix, you have two options:

**Option 1 - Manual Resend via HelpScout:**
Go to each conversation in HelpScout and manually send a reply with the content

**Option 2 - Reset and Retry:**
```sql
-- Reset recipients to pending status
UPDATE crm_bulk_send_staff_recipients 
SET status = 'pending', sent_at = NULL 
WHERE bulk_send_id = '1cdc81c5-24ad-415c-ae72-7459f3f48df2';

-- Reset log status
UPDATE crm_bulk_send_logs 
SET status = 'pending', sent_count = 0, completed_at = NULL 
WHERE id = '1cdc81c5-24ad-415c-ae72-7459f3f48df2';
```

Then re-trigger the bulk send from the edge function.

---

## Summary

| What | Details |
|------|---------|
| **Root cause** | HelpScout's create-conversation endpoint logs but doesn't send emails |
| **Fix** | Use two-step process: create conversation, then add reply |
| **Files changed** | 1 (helpscout-proxy/index.ts) |
| **Risk level** | Low - isolated to bulk send logic, no database changes |
| **Backward compatible** | Yes - fixes both client and staff bulk sends |

