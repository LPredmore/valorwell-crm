

# Distinguish Sent vs Received Emails in Inbox

## Problem Analysis

The Inbox currently shows all conversations without indicating their direction. Users cannot distinguish between:
- **Received emails** - Conversations initiated by or last replied to by the client (need attention)
- **Sent emails** - Conversations initiated by or last replied to by staff (awaiting response)

This is confusing because the "All" view mixes both types with no visual differentiation.

---

## Technical Decision: Use HelpScout's `source.via` Field

**Decision:** Capture the `source.via` field from HelpScout's API and use it to determine conversation direction.

**Why this is correct:**

1. **HelpScout provides this data natively.** The API includes a `source` object with `via: "customer"` or `via: "user"` that indicates who initiated the conversation. This is the authoritative source.

2. **No database changes needed.** The direction is a property of the HelpScout conversation, not something we need to store. We simply need to pass it through.

3. **Consistent with thread-level logic.** The `ThreadMessage` component already uses `thread.type === 'customer'` to style individual messages. Extending this to the conversation level is a natural progression.

4. **Enables future filtering.** Once we have the direction data, we can add filter options to show only "Needs Reply" (received) or "Sent" conversations.

---

## Data Flow Enhancement

```text
HelpScout API returns:
{
  "source": { "type": "email", "via": "customer" },  <-- CURRENTLY IGNORED
  "primaryCustomer": {...},
  "subject": "...",
  ...
}
         |
         v
Edge Function passes through source field
         |
         v
UI uses source.via to determine:
  - "customer" = Received (client sent this)
  - "user" = Sent (staff sent this)
         |
         v
Visual indicators in ConversationListItem:
  - Icon (ArrowDownLeft for received, ArrowUpRight for sent)
  - Badge/label ("Received" / "Sent")
  - Left border color differentiation
```

---

## Implementation Phases

### Phase 1: Extend TypeScript Types

Update `src/lib/crm/types.ts` to include the `source` object in `HelpScoutConversation`:

```typescript
interface HelpScoutSource {
  type: 'email' | 'web' | 'api' | 'chat';
  via: 'customer' | 'user';
}

interface HelpScoutConversation {
  // ... existing fields
  source: HelpScoutSource;
}
```

### Phase 2: Update Edge Function

Ensure the `list-conversations` action in `helpscout-proxy` passes through the `source` field. Currently the conversation object is spread directly from HelpScout, so this should already work - but we need to verify it's included in the filtered response.

The HelpScout API already returns this field. The current code:
```typescript
.map((c) => ({
  ...c,  // This spreads all fields including source
  client_id: emailToClientId.get(...)
}));
```

This should already preserve `source`. If testing shows it's missing, we explicitly include it.

### Phase 3: Update ConversationListItem UI

Modify `src/components/crm/inbox/ConversationListItem.tsx` to:

1. Derive direction from `conversation.source?.via`
2. Add a direction indicator (icon + label)
3. Apply distinct styling for sent vs received

**Visual Design:**
```text
RECEIVED (source.via === 'customer'):
+------------------------------------------+
| [↓ icon] John Smith              2h ago  |
| RE: Question about scheduling            |
| "I wanted to follow up..."   [Received]  |
+------------------------------------------+
Border: accent color (needs attention)

SENT (source.via === 'user'):  
+------------------------------------------+
| [↑ icon] Jane Doe                3h ago  |
| Welcome to our practice                  |
| "Thank you for reaching..."      [Sent]  |
+------------------------------------------+
Border: muted color (awaiting reply)
```

### Phase 4: Add Direction Filter

Update `StatusFilterTabs.tsx` to support an additional dimension of filtering, or add a secondary filter dropdown/toggle for direction. 

**Options:**
1. **Toggle button:** "Show All / Received Only / Sent Only"
2. **Add to existing tabs:** "Needs Reply" (combines active + received direction)

**Recommended approach:** Add a simple toggle or second row of tabs for direction filtering. This keeps status and direction as independent filters.

### Phase 5: Update useConversations Hook and Edge Function

Add a `direction` parameter to the hook and edge function:

```typescript
// useConversations options
interface UseConversationsOptions {
  status?: 'all' | 'active' | 'pending' | 'closed';
  direction?: 'all' | 'received' | 'sent';  // NEW
  page?: number;
  enabled?: boolean;
}
```

Edge function filters conversations based on `source.via` before returning:
- `received` = `source.via === 'customer'`
- `sent` = `source.via === 'user'`
- `all` = no filter (default)

---

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/crm/types.ts` | EDIT | Add `HelpScoutSource` interface, add `source` to `HelpScoutConversation` |
| `supabase/functions/helpscout-proxy/index.ts` | EDIT | Add direction filter param to `list-conversations` |
| `src/components/crm/inbox/ConversationListItem.tsx` | EDIT | Add direction icon, label, and conditional styling |
| `src/components/crm/inbox/StatusFilterTabs.tsx` | EDIT | Add direction filter controls |
| `src/hooks/crm/useConversations.ts` | EDIT | Add direction parameter |
| `src/pages/crm/Inbox.tsx` | EDIT | Add direction state and pass to hook/filter |

---

## Visual Differentiation Specification

**Received Conversations (from client):**
- Icon: `ArrowDownLeft` or `Mail` (lucide)
- Badge: "Received" with secondary variant
- Left border: Primary color (attention needed)
- Background on hover: Slightly warmer tone

**Sent Conversations (from staff):**
- Icon: `Send` or `ArrowUpRight` (lucide)
- Badge: "Sent" with outline variant
- Left border: Muted/gray
- Background on hover: Neutral tone

**Visual Hierarchy Goal:** Received emails should visually "pop" more than sent emails, since received emails typically require action.

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Missing `source` field | Default to "received" (fail safe to show as needing attention) |
| Conversation type is not email (chat, phone) | Still use `source.via` - same logic applies |
| Conversation started by customer, staff replied | `source.via` shows who *started* the conversation, not last activity. This is the correct indicator for inbox organization. |

---

## Technical Detail: "Needs Reply" Detection

The combination of:
- `source.via === 'customer'` (they initiated)
- `status === 'active'` (not pending/closed)

...indicates a conversation that "needs reply". This can power a "Needs Reply" quick filter in the future.

Currently, `needsReply` in `ConversationListItem.tsx` only checks status:
```typescript
const needsReply = conversation.status === 'active';
```

This can be enhanced to:
```typescript
const needsReply = conversation.status === 'active' && 
                   conversation.source?.via === 'customer';
```

---

## Implementation Order

1. **Types** - Update TypeScript interfaces (2 minutes)
2. **Edge Function** - Add direction filter param (5 minutes)
3. **List Item UI** - Add direction indicator (10 minutes)
4. **Hook** - Add direction param (2 minutes)
5. **Filter UI** - Add direction toggle/tabs (10 minutes)
6. **Inbox Page** - Wire up direction state (5 minutes)

---

## Outcome

After implementation:
- Users can instantly see which emails are sent vs received
- Visual hierarchy guides attention to emails needing response
- Optional direction filter allows focusing on sent or received only
- "Needs Reply" logic becomes more accurate (active + received)
- Consistent with how modern email clients display inbox

