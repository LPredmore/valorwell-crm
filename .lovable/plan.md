

# HelpScout Email Integration - Implementation Plan

## Overview

Replace the planned Missive integration with HelpScout to provide native email capabilities within the CRM. This includes viewing conversations, replying to clients, linking conversations to client records, and detecting "Needs Reply" status.

---

## Technical Decision: HelpScout Mailbox API v2

HelpScout provides two APIs:
- **Mailbox API v2** - Full access to conversations, threads, customers, and mailboxes
- **Conversations API** - Embedded widget (not suitable for native CRM inbox)

**Decision: Mailbox API v2** is required for building a native inbox UI with full control over display and workflow.

### Authentication Model
HelpScout uses OAuth 2.0 with App credentials (client_id + client_secret). The Edge Function will:
1. Store credentials securely in Supabase secrets
2. Exchange credentials for access tokens
3. Proxy all API calls through the Edge Function (never expose tokens client-side)

---

## Database Changes

### 1. Rename/Repurpose Settings Table
Update `crm_missive_settings` → create new `crm_helpscout_settings`:

```
crm_helpscout_settings
  - id (uuid, PK)
  - tenant_id (uuid, FK tenants, UNIQUE)
  - mailbox_id (text)          -- HelpScout mailbox ID
  - from_name (text)           -- Display name for outbound
  - from_email (text)          -- Verified sending email
  - connection_status (text)   -- connected/disconnected/error
  - last_sync_at (timestamptz)
  - created_at (timestamptz)
  - updated_at (timestamptz)
```

### 2. Conversation-Client Links Table
Already partially exists conceptually. Create explicit linking:

```
crm_conversation_links
  - id (uuid, PK)
  - tenant_id (uuid, FK tenants)
  - client_id (uuid, FK clients)
  - helpscout_conversation_id (text)  -- HelpScout conversation ID
  - linked_by_profile_id (uuid)       -- Who linked it
  - linked_at (timestamptz)
  - link_type (text)                  -- 'auto' or 'manual'
  - created_at (timestamptz)
```

### 3. Conversation Cache Table (Optional Performance)
Cache conversation metadata locally to reduce API calls:

```
crm_conversation_cache
  - id (uuid, PK)
  - tenant_id (uuid, FK tenants)
  - helpscout_conversation_id (text, UNIQUE)
  - subject (text)
  - status (text)               -- active/pending/closed
  - customer_email (text)
  - customer_name (text)
  - preview_text (text)
  - last_thread_at (timestamptz)
  - needs_reply (boolean)
  - cached_at (timestamptz)
```

---

## Edge Functions Architecture

### 1. `helpscout-proxy` (Main API Proxy)
Single Edge Function handling all HelpScout API operations:

**Endpoints:**
- `GET /conversations` - List conversations from mailbox
- `GET /conversations/:id` - Get full conversation with threads
- `POST /conversations/:id/reply` - Send reply
- `POST /conversations` - Create new conversation (compose)
- `GET /customers/search` - Search by email for auto-linking

**Security:**
- Validates JWT from Supabase Auth
- Retrieves HelpScout credentials from secrets
- Rate limiting awareness
- Error handling with retry logic

### 2. `helpscout-webhook` (Inbound Events)
Receives HelpScout webhooks for real-time updates:
- New conversation created
- Reply received
- Status changed
- Auto-updates conversation cache
- Triggers activity events in CRM

---

## UI Components

### 1. Inbox Page (`/crm/inbox`)

```
+------------------------------------------+
| Inbox                    [Compose] [⚙️]   |
+------------------------------------------+
| Filters: [All ▼] [Status ▼] [Needs Reply]|
+------------------------------------------+
| ┌──────────────────┐ ┌─────────────────┐ |
| │ Conversation List│ │ Thread Viewer   │ |
| │                  │ │                 │ |
| │ ○ John Doe      │ │ Subject: ...    │ |
| │   Re: Question  │ │                 │ |
| │   2h ago        │ │ [Message 1]     │ |
| │                  │ │ [Message 2]     │ |
| │ ● Jane Smith    │ │ [Message 3]     │ |
| │   Insurance... │ │                 │ |
| │   5h ago  🔴    │ │ ┌─────────────┐ │ |
| │                  │ │ │ Reply box  │ │ |
| │ ○ Bob Wilson    │ │ │             │ │ |
| │   Appointment   │ │ └─────────────┘ │ |
| └──────────────────┘ └─────────────────┘ |
+------------------------------------------+
```

**Components:**
- `InboxPage.tsx` - Main layout
- `ConversationList.tsx` - Left panel
- `ConversationThread.tsx` - Main panel
- `ReplyComposer.tsx` - Reply input
- `LinkedClientCard.tsx` - Right panel context

### 2. Conversation-Client Linking UI

**Auto-linking logic:**
1. Extract customer email from conversation
2. Query `clients.email` for exact match
3. If found, create link with `link_type: 'auto'`
4. Display linked client info in sidebar

**Manual linking:**
- "Link to Client" button on conversation
- Client search modal
- Confirm and create link

### 3. "Needs Reply" Detection

HelpScout provides `status` field:
- `active` - Waiting for agent reply
- `pending` - Waiting for customer
- `closed` - Resolved

**Logic:** Conversation needs reply when:
- `status === 'active'` AND
- Last thread was from customer (not agent)

Display badge count in sidebar navigation.

---

## File Structure

```
src/
  pages/crm/
    Inbox.tsx                    -- NEW: Main inbox page
  components/crm/inbox/
    ConversationList.tsx         -- NEW: Left panel
    ConversationListItem.tsx     -- NEW: List row
    ConversationThread.tsx       -- NEW: Thread viewer
    ThreadMessage.tsx            -- NEW: Single message
    ReplyComposer.tsx            -- NEW: Reply input
    ComposeDialog.tsx            -- NEW: New conversation
    LinkedClientCard.tsx         -- NEW: Client context
    LinkClientDialog.tsx         -- NEW: Manual linking
  components/crm/settings/
    HelpScoutConfigPanel.tsx     -- NEW: Connection settings
  hooks/crm/
    useConversations.ts          -- NEW: Fetch conversations
    useConversationDetail.ts     -- NEW: Single conversation
    useConversationLink.ts       -- NEW: Client linking
    useHelpScoutSettings.ts      -- NEW: Settings hook
    useSendReply.ts              -- NEW: Reply mutation

supabase/functions/
  helpscout-proxy/
    index.ts                     -- NEW: API proxy
  helpscout-webhook/
    index.ts                     -- NEW: Webhook handler
```

---

## Implementation Phases

### Phase 3A: Foundation (Week 1)
1. Create HelpScout settings table (migration)
2. Create conversation links table (migration)
3. Create `helpscout-proxy` Edge Function
4. Add HelpScout API credentials to secrets
5. Build `HelpScoutConfigPanel` for settings

### Phase 3B: Inbox UI (Week 2)
1. Create Inbox page with three-panel layout
2. Build ConversationList with filtering
3. Build ConversationThread viewer
4. Implement "Needs Reply" badge

### Phase 3C: Replies & Linking (Week 3)
1. Build ReplyComposer with rich text
2. Implement auto-linking by email match
3. Build manual LinkClientDialog
4. Add LinkedClientCard sidebar

### Phase 3D: Polish (Week 4)
1. Webhook handler for real-time updates
2. Conversation cache for performance
3. Activity timeline integration
4. Error handling and retry logic

---

## Security Considerations

- HelpScout API credentials stored as Supabase secrets (never in code)
- All API calls proxied through Edge Function
- RLS policies on conversation links table
- Webhook signature validation
- Rate limiting handling

---

## Required Secrets

| Secret Name | Purpose |
|-------------|---------|
| `HELPSCOUT_APP_ID` | OAuth app identifier |
| `HELPSCOUT_APP_SECRET` | OAuth secret |
| `HELPSCOUT_MAILBOX_ID` | Default mailbox |

---

## HelpScout API Reference

Key endpoints for Mailbox API v2:

| Operation | Endpoint |
|-----------|----------|
| List conversations | `GET /v2/conversations?mailbox={id}` |
| Get conversation | `GET /v2/conversations/{id}?embed=threads` |
| Reply to conversation | `POST /v2/conversations/{id}/reply` |
| Create conversation | `POST /v2/conversations` |
| Search customers | `GET /v2/customers?email={email}` |

---

## Data Flow

```
User opens Inbox
      ↓
useConversations hook
      ↓
Edge Function (helpscout-proxy)
      ↓
HelpScout Mailbox API
      ↓
Return conversations list
      ↓
For each: Check crm_conversation_links for client match
      ↓
Display with linked client indicator
      ↓
User selects conversation
      ↓
useConversationDetail fetches threads
      ↓
Display thread + linked client card
      ↓
User types reply → useSendReply mutation
      ↓
Edge Function posts to HelpScout
      ↓
Create activity event in crm_activity_events
```

---

## What Still Remains After Email Integration

After Phase 3 (HelpScout), these items remain from the PRD:

| Feature | Phase | Status |
|---------|-------|--------|
| Bulk Messaging UI | 4 | DB ready, needs UI |
| Email Templates UI | 4 | DB ready, needs UI |
| Segment Builder | 4 | Not started |
| Dashboard Stats | 5 | Not started |
| Reporting | 5 | Not started |

---

## Summary

The CRM foundation is solid. The next major milestone is **HelpScout email integration** which requires:
1. Two new database tables
2. Two Edge Functions
3. ~10 new UI components
4. HelpScout API credentials

This provides native inbox functionality, conversation-client linking, and "Needs Reply" tracking - the core email workflow from the PRD.

