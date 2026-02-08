
# Communications Hub Implementation Plan

## Executive Summary

This plan transforms the current email-only Inbox into a unified **Communications** page that supports both Email (HelpScout) and SMS (RingCentral), adds phone number to the client table, expands search functionality, and implements the missing email reply capability.

## Current State Analysis

**What exists today:**
- Email integration via HelpScout with read-only thread viewing (no reply capability)
- SMS integration via RingCentral for outbound bulk messaging only
- Client table shows: Name, Email, Status, State, Therapist, Last Updated
- Search only queries: `pat_name_f`, `pat_name_l`, `pat_name_preferred`, `email`
- Inbound SMS webhook pauses campaign enrollments but has no UI visibility

**Key gaps:**
1. Cannot reply to emails from within the CRM
2. No SMS conversation visibility
3. Phone number not displayed in client table
4. Search excludes phone number field
5. No unified communication view

---

## Implementation Strategy

### Phase 1: Client Table & Search Enhancements

**1.1 Add Phone Column to Client Table**

Update `ClientTable.tsx` to add a "Phone" column after Email. This requires no database changes since `phone` is already fetched in the `useClients` hook.

Table column order will become:
| Checkbox | Name | Email | Phone | Status | State | Therapist | Quick View | Last Updated |

**1.2 Expand Search to Include Phone**

Modify the search filter in `useClients.ts` to include `phone` in the OR clause:
```sql
pat_name_f.ilike.%term%,
pat_name_l.ilike.%term%,
pat_name_preferred.ilike.%term%,
email.ilike.%term%,
phone.ilike.%term%
```

This is a single-line change to the existing query builder.

---

### Phase 2: Email Reply Capability

**2.1 Reply Composer Component**

Create `src/components/crm/inbox/ReplyComposer.tsx`:
- Fixed-position form at bottom of ConversationThread
- Textarea for message body
- Send button with loading state
- Status selector (keep active, set to pending, set to closed)

**2.2 Reply Hook**

Create `src/hooks/crm/useReplyToConversation.ts`:
- Uses the existing `helpscoutApi('reply', ...)` action
- Invalidates conversation detail cache on success
- Returns mutation state for UI feedback

**2.3 Integrate into ConversationThread**

Add the ReplyComposer to the bottom of `ConversationThread.tsx`. After successful send:
- Refetch thread messages
- Show success toast
- Clear the composer

The edge function already has `case "reply"` implemented - no backend changes needed.

---

### Phase 3: Unified Communications Page

**3.1 Rename and Restructure /inbox**

Transform `Inbox.tsx` into `Communications.tsx` with three-tab architecture:

```text
[All Communications] [Email] [SMS]
```

**All Communications**: Merged timeline of recent emails and SMS (from webhook logs)
**Email Tab**: Current email functionality (Inbox/Sent + status filters + reply)  
**SMS Tab**: View of outbound SMS logs and inbound responses

**3.2 Sidebar Navigation Update**

Change the nav item in `CrmSidebar.tsx`:
- Label: "Inbox" → "Communications"
- Icon: Keep Inbox icon (or use MessageSquare for multi-channel feel)
- Route: `/crm/inbox` remains unchanged (no URL breakage)

**3.3 SMS Tab Implementation**

Create new components:
- `SmsConversationList.tsx` - List of SMS threads grouped by client phone
- `SmsThread.tsx` - Display outbound messages and any inbound responses

Data sources:
- Outbound: Query `crm_bulk_sms_recipients` joined with `crm_bulk_sms_logs` for message history
- Inbound: Currently logged in edge function console only; need new table

**3.4 New Database Table for Inbound SMS Log**

Create `crm_inbound_sms_logs` to persist inbound SMS webhooks:
```sql
CREATE TABLE crm_inbound_sms_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  client_id UUID REFERENCES clients(id),
  from_phone TEXT NOT NULL,
  to_phone TEXT NOT NULL,
  message_body TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ringcentral_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Update `ringcentral-sms/index.ts` inbound handler to insert into this table.

---

### Phase 4: SMS Viewing Experience

**4.1 SMS Conversation Model**

SMS conversations will be grouped by client phone number:
- Each "thread" shows all messages to/from a specific client
- Outbound messages: from `crm_bulk_sms_logs` via recipient tables
- Inbound messages: from new `crm_inbound_sms_logs` table

**4.2 Individual SMS Sending (Future Enhancement)**

Note: This plan focuses on viewing. Individual SMS compose from Communications page is a logical next step but out of scope for this implementation.

---

## Technical Decisions & Rationale

**Decision 1: Keep /crm/inbox route**
- Renaming the page without changing the URL prevents bookmark/link breakage
- The page component name changes, route stays stable

**Decision 2: Store inbound SMS in new table**
- Required for SMS tab to show inbound messages
- Enables future features: SMS reply, full conversation threading
- Maintains clear separation (CRM-only table with `crm_` prefix)

**Decision 3: Three-tab architecture (All/Email/SMS) over two-panel**
- "All Communications" provides unified chronological view
- Dedicated tabs allow channel-specific workflows
- Mirrors Gmail/Outlook approach users are familiar with

**Decision 4: Reply composer at bottom of thread (not floating modal)**
- Matches email client UX expectations
- Keeps conversation context visible while composing
- Reduces modal fatigue in the application

---

## File Changes Summary

### New Files
| File | Purpose |
|------|---------|
| `src/components/crm/inbox/ReplyComposer.tsx` | Email reply form component |
| `src/hooks/crm/useReplyToConversation.ts` | Reply mutation hook |
| `src/components/crm/inbox/SmsConversationList.tsx` | SMS thread list |
| `src/components/crm/inbox/SmsThread.tsx` | SMS thread viewer |
| `src/hooks/crm/useSmsConversations.ts` | Fetch SMS history |
| `src/hooks/crm/useInboundSms.ts` | Fetch inbound SMS logs |

### Modified Files
| File | Changes |
|------|---------|
| `src/components/crm/clients/ClientTable.tsx` | Add Phone column |
| `src/hooks/crm/useClients.ts` | Add phone to search filter |
| `src/pages/crm/Inbox.tsx` | Restructure as Communications with tabs |
| `src/components/crm/inbox/ConversationThread.tsx` | Add ReplyComposer |
| `src/components/crm/layout/CrmSidebar.tsx` | Update label to "Communications" |
| `supabase/functions/ringcentral-sms/index.ts` | Log inbound SMS to database |

### Database Migration
- Create `crm_inbound_sms_logs` table with RLS policies

---

## Implementation Order

1. **Phase 1** (Quick wins)
   - Add phone column to table
   - Expand search to include phone

2. **Phase 2** (Email reply)
   - Create ReplyComposer component
   - Create useReplyToConversation hook
   - Integrate into ConversationThread

3. **Phase 3** (Communications restructure)
   - Create inbound SMS log table
   - Update edge function to log inbound SMS
   - Create SMS viewing components
   - Restructure Inbox page with tabs
   - Update sidebar label

4. **Phase 4** (Testing & Polish)
   - End-to-end testing of all flows
   - Loading states and error handling
   - Mobile responsiveness

---

## Database Migration (Required)

```sql
-- Create inbound SMS log table for SMS tab visibility
CREATE TABLE crm_inbound_sms_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  client_id UUID REFERENCES clients(id),
  from_phone TEXT NOT NULL,
  to_phone TEXT NOT NULL,
  message_body TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ringcentral_message_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient client lookups
CREATE INDEX idx_crm_inbound_sms_client ON crm_inbound_sms_logs(client_id);
CREATE INDEX idx_crm_inbound_sms_tenant ON crm_inbound_sms_logs(tenant_id);

-- RLS policies
ALTER TABLE crm_inbound_sms_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view inbound SMS for their tenant"
ON crm_inbound_sms_logs FOR SELECT
USING (
  tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE profile_id = auth.uid()
  )
);
```

---

## Success Criteria

- Phone number visible in client table view
- Search returns results when querying by phone number
- Users can reply to emails directly from conversation thread
- Communications page shows unified Email and SMS tabs
- Inbound SMS visible in SMS tab with client association
- All existing Inbox functionality preserved
