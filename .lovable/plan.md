

# Gmail-Like Inbox: Action-Focused Sent vs Received

## Problem Identified

The current implementation uses `conversation.source.via` to determine direction. This field indicates who **started** the conversation, not who sent the **last message**. 

When you send an email to a client and they reply, the conversation still shows as "Sent" because the conversation was originally initiated by staff (`source.via === "user"`). This never changes even after multiple client replies.

## Correct Technical Approach

**Use the most recent thread (message) to determine direction**, not the conversation's source field.

```text
Conversation Source (what we're using now - WRONG):
  source.via === "user"  → Started by staff (never changes)
  source.via === "customer" → Started by client (never changes)

Last Thread (what we need - CORRECT):
  Last thread type === "customer" → Client replied last → Show in INBOX
  Last thread type === "reply"    → Staff replied last → Show in SENT
```

This matches Gmail's behavior exactly: a thread moves to your inbox when someone else replies, and moves to sent (or out of inbox) when you reply.

---

## Data Source: HelpScout Threads

HelpScout provides thread data in two ways:
1. **Embedded threads** when fetching conversations with `?embed=threads`
2. **Separate threads endpoint** `/conversations/{id}/threads`

The challenge: The list-conversations endpoint doesn't embed threads by default, and embedding threads for every conversation in the list would be slow.

**Solution:** Use the `customerWaitingSince` field that HelpScout already provides in the conversation list response. This field exists when the customer is waiting for a reply (i.e., staff last replied). If this field is present and has a time, it means the customer is waiting → **SENT**. If absent or the conversation was just created by a customer → **INBOX**.

However, looking at the network response data you provided, I see both conversations have `customerWaitingSince` with times even though one should be "received". This means `customerWaitingSince` tracks when customer last contacted, not when staff last contacted.

**Better solution:** Fetch the most recent thread for each conversation. We can optimize by:
1. Using `embed=threads` in the list call (HelpScout returns threads array)
2. Looking at `threads[0]` or the last thread to determine who sent it

---

## Revised Architecture

### Data Flow

```text
HelpScout API: GET /conversations?embed=threads
                      ↓
For each conversation:
  - Look at _embedded.threads (or fetch if not embedded)
  - Find most recent thread
  - Check thread.type or thread.source.via
    → "customer" = Client last messaged → INBOX
    → "reply"/"message" from user = Staff last messaged → SENT
                      ↓
Edge Function enriches each conversation with:
  - lastMessageBy: "customer" | "staff"
  - needsReply: boolean
                      ↓
UI groups conversations:
  - Inbox tab: Shows lastMessageBy === "customer" (needs response)
  - Sent tab: Shows lastMessageBy === "staff" (awaiting client)
```

### Thread Type Reference (HelpScout API)
- `customer` - Customer sent this message (needs reply)
- `reply` - Staff reply to customer (waiting on customer)
- `note` - Internal note (skip)
- `message` - Outbound message from staff (waiting on customer)

---

## Implementation Plan

### Phase 1: Update Types

Add `lastMessageBy` field to `HelpScoutConversation`:
```typescript
interface HelpScoutConversation {
  // ... existing fields
  lastMessageBy: 'customer' | 'staff';
  needsReply: boolean;
}
```

### Phase 2: Update Edge Function (list-conversations)

1. Change the API call to embed threads: `/conversations?embed=threads&mailbox=...`
2. For each conversation, examine `_embedded.threads`
3. Find the most recent non-note thread
4. Determine `lastMessageBy` based on thread type:
   - `thread.type === "customer"` → `lastMessageBy: "customer"`
   - `thread.type === "reply" || thread.type === "message"` → `lastMessageBy: "staff"`
5. Set `needsReply = conversation.status === "active" && lastMessageBy === "customer"`
6. Filter based on direction param:
   - `received` → `lastMessageBy === "customer"`
   - `sent` → `lastMessageBy === "staff"`

### Phase 3: Simplify UI to Match Gmail

Based on user preferences:
- **Inbox** (default view): Shows conversations where client last messaged (needs response). Always Active status.
- **Sent**: Shows conversations where staff last messaged (awaiting client). Can filter Active/Pending/Closed.

**Remove** the current direction toggle and replace with a tab-based navigation:

```text
+-------------------------------------------+
|  [Inbox]  [Sent]                          |
+-------------------------------------------+
| Status: (only in Sent view)               |
| [All] [Active] [Pending] [Closed]         |
+-------------------------------------------+
| Conversation list...                      |
```

### Phase 4: Update ConversationListItem

- Remove the direction badge (no longer needed - tab already indicates)
- Keep visual styling to highlight conversations that need attention
- Use the computed `needsReply` field from server

### Phase 5: Update Inbox Page and Sidebar

Option A (Recommended): Keep single Inbox route but with tabs for Inbox/Sent
- Simpler routing
- Users can quickly toggle

Option B: Separate routes `/crm/inbox` and `/crm/sent`
- More explicit
- Requires sidebar change

**Recommendation: Option A** - Keep single page with internal Inbox/Sent tabs.

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/helpscout-proxy/index.ts` | EDIT | Embed threads, compute `lastMessageBy` and `needsReply` |
| `src/lib/crm/types.ts` | EDIT | Add `lastMessageBy`, `needsReply` to interface |
| `src/components/crm/inbox/StatusFilterTabs.tsx` | EDIT | Replace direction toggle with Inbox/Sent tabs |
| `src/components/crm/inbox/ConversationListItem.tsx` | EDIT | Use `needsReply` from server, remove direction badge |
| `src/hooks/crm/useConversations.ts` | EDIT | Update params - direction becomes "inbox" | "sent" |
| `src/pages/crm/Inbox.tsx` | EDIT | Update state and logic for new tab structure |

---

## Edge Function Logic (Detailed)

```typescript
// In list-conversations case:

// 1. Fetch with embedded threads
const endpoint = `/conversations?mailbox=${mailboxId}&page=${page}&embed=threads`;
if (status !== 'all') endpoint += `&status=${status}`;

// 2. For each conversation, determine lastMessageBy
const enrichedConversations = filteredConversations.map(conv => {
  const threads = conv._embedded?.threads || [];
  
  // Find most recent non-note thread (threads are typically newest first)
  const lastRelevantThread = threads.find(t => 
    t.type === 'customer' || t.type === 'reply' || t.type === 'message'
  );
  
  let lastMessageBy: 'customer' | 'staff' = 'customer'; // default to customer (needs attention)
  
  if (lastRelevantThread) {
    if (lastRelevantThread.type === 'customer') {
      lastMessageBy = 'customer';
    } else {
      lastMessageBy = 'staff';
    }
  }
  
  return {
    ...conv,
    lastMessageBy,
    needsReply: conv.status === 'active' && lastMessageBy === 'customer',
  };
});

// 3. Filter by direction
if (direction === 'received' || direction === 'inbox') {
  return enrichedConversations.filter(c => c.lastMessageBy === 'customer');
} else if (direction === 'sent') {
  return enrichedConversations.filter(c => c.lastMessageBy === 'staff');
}
```

---

## UI Mockup

```text
+------------------------------------------+
|            Inbox                         |
|  [ Inbox (3) ]  [ Sent ]                 |
+------------------------------------------+
|  (When Sent selected:)                   |
|  [All] [Active] [Pending] [Closed]       |
+------------------------------------------+
|                                          |
|  ┌────────────────────────────────────┐  |
|  │ ↓ John Smith           2h ago     │  |
|  │ RE: Question about scheduling     │  |
|  │ "I wanted to follow up..."        │  |
|  └────────────────────────────────────┘  |
|  ┌────────────────────────────────────┐  |
|  │ ↓ Jane Doe             5h ago     │  |
|  │ Thanks for the info               │  |
|  │ "That sounds great, I'll..."      │  |
|  └────────────────────────────────────┘  |
|                                          |
+------------------------------------------+
```

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| No threads in conversation | Default to `lastMessageBy: 'customer'` (fail safe) |
| Only internal notes | Skip notes, look for customer/reply/message types |
| New outbound (no reply yet) | `lastMessageBy: 'staff'` → Sent |
| Client starts thread, staff replies, client replies again | `lastMessageBy: 'customer'` → Inbox |

---

## Summary

The fundamental fix is to look at **who sent the last message**, not who started the conversation. This requires:
1. Embedding threads in the API call
2. Computing `lastMessageBy` server-side
3. Simplifying the UI to Inbox (needs reply) vs Sent (awaiting response) tabs
4. Removing the direction toggle in favor of cleaner tab navigation

This matches Gmail's behavior and gives users an action-oriented inbox where they can quickly see what needs their attention.

