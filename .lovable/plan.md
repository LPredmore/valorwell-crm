

# Fix HelpScout Reply: Add Required `customer` Field

## Problem

The HelpScout Mailbox API v2 requires a `customer` object in every reply thread payload. The edge function at line 661-664 sends only `text` and `status`, causing a `400 Bad Request` with `"customer": "must not be null"`.

## Technical Decision

**Resolve the customer on the server side using the conversation's existing data**, rather than passing it from the frontend.

Why this is the right approach:
- The edge function already has the `conversationId`. It can fetch the conversation from HelpScout to get the `primaryCustomer.id` before posting the reply. This is one extra API call but guarantees correctness.
- The alternative -- passing `customer.id` from the frontend -- is fragile. The frontend has the `primaryCustomer` object from its cached conversation list, but that data could be stale. The server should be the source of truth for outbound API calls.
- HelpScout's reply endpoint accepts `customer.id` (numeric HelpScout customer ID). The conversation detail response always includes this.

## Changes

### 1. Edge function: `supabase/functions/helpscout-proxy/index.ts`

In the `reply` case (around line 660), before constructing `replyBody`:

1. Fetch the conversation from HelpScout to get the primary customer ID:
   ```
   GET /conversations/{conversationId}?fields=primaryCustomer
   ```
2. Extract `primaryCustomer.id` from the response.
3. Include it in the reply payload:
   ```typescript
   const replyBody = {
     customer: { id: primaryCustomer.id },
     text,
     status: status || "active",
   };
   ```

This is a single change to the edge function. No frontend changes needed -- `ReplyComposer.tsx`, `useReplyToConversation.ts`, and `ConversationThread.tsx` all remain untouched.

### 2. Deploy and verify

Deploy the updated edge function, then test by sending a reply through the CRM inbox.

