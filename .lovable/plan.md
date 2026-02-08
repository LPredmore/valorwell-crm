
# SMS Conversations Implementation Plan

## Current State (Verified Through Database Queries)

### What Actually Exists in the Database

| Table | Records | Purpose |
|-------|---------|---------|
| `crm_campaign_step_logs` | **9 SMS records** (8 sent, 1 skipped) | Campaign automation SMS with full message content stored in joined `crm_campaign_steps.sms_body_text` |
| `crm_bulk_sms_recipients` | **0 records** | Manual bulk SMS to clients (none sent yet) |
| `crm_bulk_sms_staff_recipients` | 3 records | Staff test SMS (not client communications) |
| `crm_inbound_sms_logs` | **0 records** | Inbound SMS storage (table created after Carson's test) |

### Root Cause Analysis

The `useSmsConversations.ts` hook currently queries:
1. `crm_inbound_sms_logs` - Empty (logging was added after the webhook test)
2. `crm_bulk_sms_recipients` - Empty (no manual bulk SMS to clients yet)

It **does not query** `crm_campaign_step_logs`, which contains all 9 campaign SMS messages including the "New York Start" campaign messages sent to Nathalie DeVore, Joann Murphy, Carson Pritchett, and others.

---

## Technical Decision: Unified Outbound SMS Query

### The Right Approach

Create a single, consolidated data source for all outbound SMS by querying **all three tables** that can contain client SMS:

1. **`crm_campaign_step_logs`** - Campaign automation (primary source today)
2. **`crm_bulk_sms_recipients`** - Manual bulk sends to clients
3. **`crm_bulk_sms_staff_recipients`** - Excluded (staff messages are internal, not client communications)

### Why This Is Correct

- **Single Source of Truth**: The Communications hub should show all client-facing SMS regardless of origination method
- **Future-Proof**: As manual bulk SMS is used more, it will automatically appear
- **Consistent Data Model**: Both sources can be normalized to the same `SmsMessage` interface with direction, phone, message, timestamp, and client info
- **No Schema Changes**: All required data already exists in these tables

---

## Implementation Plan

### Phase 1: Fix Outbound SMS Data Source

**File: `src/hooks/crm/useSmsConversations.ts`**

Add a third query to fetch campaign SMS from `crm_campaign_step_logs`:

```text
Query: crm_campaign_step_logs
  WHERE channel = 'sms' 
    AND status = 'sent'
    AND tenant_id = currentTenant
  JOIN crm_campaign_steps for sms_body_text
  JOIN clients for phone and name
```

Normalize campaign SMS into the existing `SmsMessage` format:
- `direction`: 'outbound'
- `phone`: from joined client record
- `message`: from `crm_campaign_steps.sms_body_text`
- `timestamp`: from `sent_at`
- `client_id` / `client_name`: from joined client

### Phase 2: Fix Inbound SMS Logging

**File: `supabase/functions/ringcentral-sms/index.ts`**

The current logic only logs inbound SMS when a client match is found (lines 437-462). This is problematic because:
- Messages from unknown numbers are lost
- Historical context is incomplete

**Change**: Always log to `crm_inbound_sms_logs`, with `client_id = null` and a default tenant when no client match exists. This ensures:
- Complete message history
- Ability to manually associate messages later
- Audit trail for compliance

### Phase 3: Add Read/Unread State

**Database Migration**: Add `is_read` column to `crm_inbound_sms_logs`

```sql
ALTER TABLE crm_inbound_sms_logs 
ADD COLUMN is_read BOOLEAN NOT NULL DEFAULT false;
```

**UI Changes**:
- Add toggle in SMS tab header: "New" | "All" (default to "New")
- "New" filter shows threads with at least one unread inbound message
- Clicking a thread marks all its inbound messages as read
- Outbound-only threads always appear (they represent sent campaigns awaiting response)

### Phase 4: Update UI Components

**File: `src/pages/crm/Inbox.tsx`**
- Add filter state: `smsFilter: 'new' | 'all'`
- Default to 'new'
- Pass filter to `useSmsConversations`

**File: `src/hooks/crm/useSmsConversations.ts`**
- Accept optional `filter` parameter
- When `filter === 'new'`: only include threads where any inbound message has `is_read = false`
- When `filter === 'all'`: include all threads

**File: `src/components/crm/inbox/SmsConversationList.tsx`**
- Add visual indicator for threads with unread messages (bold text, dot badge)

**New Hook: `src/hooks/crm/useMarkSmsRead.ts`**
- Mutation to set `is_read = true` for all inbound messages in a thread
- Called when user selects a thread

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/hooks/crm/useSmsConversations.ts` | Modify | Add `crm_campaign_step_logs` query, accept filter param |
| `supabase/functions/ringcentral-sms/index.ts` | Modify | Log all inbound SMS regardless of client match |
| `src/pages/crm/Inbox.tsx` | Modify | Add New/All toggle for SMS tab |
| `src/components/crm/inbox/SmsConversationList.tsx` | Modify | Add unread visual indicators |
| `src/hooks/crm/useMarkSmsRead.ts` | Create | Mutation to mark messages as read |

### Database Migration

```sql
-- Add read status to inbound SMS
ALTER TABLE crm_inbound_sms_logs 
ADD COLUMN is_read BOOLEAN NOT NULL DEFAULT false;

-- Index for efficient filtering
CREATE INDEX idx_crm_inbound_sms_is_read 
ON crm_inbound_sms_logs(tenant_id, is_read) 
WHERE is_read = false;
```

---

## Implementation Order

1. **Immediate Fix** (makes SMS appear):
   - Update `useSmsConversations.ts` to query `crm_campaign_step_logs`
   
2. **Inbound Logging** (captures future messages):
   - Update edge function to log all inbound SMS
   
3. **Read State** (enables New/All filter):
   - Database migration for `is_read`
   - Create `useMarkSmsRead` hook
   - Add filter toggle to UI
   - Add visual indicators for unread

---

## Expected Outcome

After implementation:
- SMS tab shows all 8+ sent campaign messages from "New York Start"
- Messages are grouped by client phone number into threads
- New inbound messages (from webhook) appear immediately
- "New" filter (default) highlights threads needing attention
- "All" shows complete SMS history
