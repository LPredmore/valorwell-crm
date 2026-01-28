

# Inbox: Display Emails from Known Clients Only

## Problem Statement

The Inbox page is currently a shell. You need it to:
1. Fetch conversations from HelpScout
2. Filter out any conversations where the sender's email doesn't match a client in the database
3. Display the filtered conversation list
4. Allow viewing conversation threads

---

## Architecture Decision: Server-Side Filtering

**Decision:** Filter conversations in the Edge Function, not the client.

**Why this is correct:**
1. **Security** - Client-side filtering would expose all HelpScout conversations to the browser, including emails from non-clients. The Edge Function should only return data the user should see.
2. **Performance** - Fetching 100 conversations then filtering to 10 on the client wastes bandwidth. Better to do the filtering server-side.
3. **Pagination** - HelpScout paginates results. If you filter client-side, page 1 might have 0 results while page 2 has 25. Server-side filtering can handle this properly.
4. **Tenant isolation** - The Edge Function already has the tenant context and can query the clients table directly.

---

## Data Flow

```text
Client requests: GET /helpscout-proxy?action=list-conversations
                              |
                              v
Edge Function fetches conversations from HelpScout API
                              |
                              v
For each conversation, extract primaryCustomer.email
                              |
                              v
Query clients table: SELECT id, email FROM clients 
                     WHERE tenant_id = ? AND email IN (list of emails)
                              |
                              v
Filter conversations to only those with matching client emails
                              |
                              v
Return filtered list + client_id for each conversation
                              |
                              v
UI renders conversation list with client info
```

---

## Implementation Phases

### Phase 1: Enhance Edge Function `list-conversations` Action

**Current behavior:** Returns raw HelpScout response  
**New behavior:** Filters to known clients + enriches with client_id

Changes to `supabase/functions/helpscout-proxy/index.ts`:

1. After fetching conversations from HelpScout, extract all unique customer emails
2. Query the `clients` table to find which emails exist in the tenant
3. Filter conversations to only include those with matching emails
4. Add `client_id` to each conversation object for linking
5. Return the filtered + enriched response

**Why modify existing action vs new action:**
- Keeps the API simple (one action for listing)
- All callers automatically get the filtering behavior
- Avoids duplicating pagination logic

### Phase 2: Create `useConversations` Hook

New hook: `src/hooks/crm/useConversations.ts`

Features:
- Fetches conversations via `helpscoutApi('list-conversations', { params: { status, page } })`
- Handles loading/error states
- Supports status filtering (active/pending/closed/all)
- Pagination support
- Auto-refetch on interval (optional, for "live" inbox feel)

### Phase 3: Create Conversation List UI

New component: `src/components/crm/inbox/ConversationList.tsx`

Displays:
- Subject line
- Customer name (from client record)
- Preview text (first line of last message)
- Status badge (active/pending/closed)
- "Needs reply" indicator
- Timestamp (relative, e.g., "2 hours ago")
- Click to select

### Phase 4: Update Inbox Page

Modify `src/pages/crm/Inbox.tsx`:

- Replace placeholder with actual ConversationList
- Add status filter tabs (All, Active, Pending, Closed)
- Track selected conversation ID
- When conversation selected, show thread viewer (Phase 5)

### Phase 5: Create Thread Viewer

New components:
- `src/components/crm/inbox/ConversationThread.tsx` - displays full conversation
- `src/components/crm/inbox/ThreadMessage.tsx` - single message in thread

New hook: `src/hooks/crm/useConversationDetail.ts`
- Fetches single conversation with embedded threads
- Uses `helpscoutApi('get-conversation', { params: { id } })`

---

## File Structure

```text
src/
  components/crm/inbox/
    ConversationList.tsx       -- NEW: List of conversations
    ConversationListItem.tsx   -- NEW: Single list item
    ConversationThread.tsx     -- NEW: Full conversation view
    ThreadMessage.tsx          -- NEW: Single message bubble
    StatusFilterTabs.tsx       -- NEW: Active/Pending/Closed tabs
  hooks/crm/
    useConversations.ts        -- NEW: Fetch filtered conversations
    useConversationDetail.ts   -- NEW: Fetch single conversation
  pages/crm/
    Inbox.tsx                  -- EDIT: Wire up components

supabase/functions/
  helpscout-proxy/
    index.ts                   -- EDIT: Add filtering logic to list-conversations
```

---

## Edge Function Filter Logic (Technical Detail)

```text
case "list-conversations": {
  // 1. Get user's tenant_id from their profile
  const { data: membership } = await supabase
    .from('tenant_memberships')
    .select('tenant_id')
    .eq('profile_id', userId)
    .single();
  
  // 2. Fetch conversations from HelpScout
  const hsResponse = await helpscoutRequest("GET", endpoint);
  const hsData = await hsResponse.json();
  
  // 3. Extract all customer emails from conversations
  const customerEmails = hsData._embedded.conversations
    .map(c => c.primaryCustomer?.email)
    .filter(Boolean);
  
  // 4. Find matching clients in database
  const { data: clients } = await supabase
    .from('clients')
    .select('id, email')
    .eq('tenant_id', membership.tenant_id)
    .in('email', customerEmails);
  
  // 5. Create email -> client_id lookup
  const emailToClientId = new Map(clients.map(c => [c.email.toLowerCase(), c.id]));
  
  // 6. Filter and enrich conversations
  const filteredConversations = hsData._embedded.conversations
    .filter(c => {
      const email = c.primaryCustomer?.email?.toLowerCase();
      return email && emailToClientId.has(email);
    })
    .map(c => ({
      ...c,
      client_id: emailToClientId.get(c.primaryCustomer.email.toLowerCase())
    }));
  
  result = {
    conversations: filteredConversations,
    page: hsData.page,
  };
  break;
}
```

---

## TypeScript Types

Add to `src/lib/crm/types.ts`:

```text
interface HelpScoutConversation {
  id: number;
  number: number;
  subject: string;
  status: 'active' | 'pending' | 'closed' | 'spam';
  preview: string;
  primaryCustomer: {
    id: number;
    email: string;
    first: string;
    last: string;
  };
  createdAt: string;
  userUpdatedAt: string;
  client_id: string; // Added by our filtering
}

interface ConversationsResponse {
  conversations: HelpScoutConversation[];
  page: {
    size: number;
    totalElements: number;
    totalPages: number;
    number: number;
  };
}
```

---

## Edge Cases Handled

| Scenario | Handling |
|----------|----------|
| Conversation has no primaryCustomer | Filtered out |
| Email not in clients table | Filtered out |
| Case mismatch (JOHN@example.com vs john@example.com) | Normalize to lowercase before comparison |
| Client deleted after conversation created | Conversation disappears from list (correct behavior) |
| Empty inbox (no matching clients) | Show "No conversations" message |
| HelpScout API error | Show error state with retry button |
| Pagination with sparse results | May return fewer than 25 per page (acceptable) |

---

## Scope Boundaries

**Included:**
- Fetch conversations from HelpScout
- Filter to known clients only
- Display conversation list with status filtering
- View conversation threads
- Link conversations to client records (via client_id)

**Not Included (Future phases):**
- Reply composer
- Creating new conversations from inbox
- Real-time updates via webhooks
- Caching in crm_conversation_cache table
- Automatic client linking UI

---

## Phase Summary

| Phase | Scope | Complexity |
|-------|-------|------------|
| 1 | Edge Function filtering | High |
| 2 | useConversations hook | Medium |
| 3 | ConversationList component | Medium |
| 4 | Inbox page wiring | Low |
| 5 | Thread viewer | Medium |

**Recommended order:** 1 → 2 → 3 → 4 → 5 (backend first, then UI)

