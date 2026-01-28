

# Bulk Email to Selected Clients - Implementation Plan

## Overview

Add the ability to select multiple clients from the table view and send individual emails to each one via HelpScout. Each recipient receives their own separate conversation (not a group email or CC).

---

## Architecture Decision: Server-Side vs Client-Side Sending

**Decision: Hybrid approach with Edge Function orchestration**

**Why:**
1. **Rate limiting** - HelpScout has API rate limits. Client-side loops could hit 429 errors unpredictably.
2. **Reliability** - If the browser closes mid-send, partial sends would be lost. Edge Function can complete the job.
3. **Audit trail** - Server-side can reliably write to `crm_bulk_send_logs` and `crm_bulk_send_recipients` tables.
4. **User feedback** - Client doesn't need to wait; polling can show progress.

---

## Data Flow

```text
User selects clients → Opens compose dialog → Submits
                                ↓
                    Creates bulk_send_log record (status: 'pending')
                    Creates bulk_send_recipient records
                                ↓
                    Calls Edge Function 'bulk-send' action
                                ↓
          Edge Function loops through recipients:
            → For each: call HelpScout create-conversation
            → Update recipient record (sent/failed)
            → Update bulk_send_log counts
                                ↓
                    UI polls for completion status
```

---

## Implementation Phases

### Phase A: Selection UI (Table View)

**Goal:** Add checkbox selection to ClientTable with a floating action bar when selections exist.

**Changes to `ClientTable.tsx`:**
- Add checkbox column as first column
- Add "select all" checkbox in header
- Track selected client IDs in parent component
- Show floating action bar with "Send Email" button when count > 0

**Changes to `Clients.tsx`:**
- Add `selectedClientIds` state
- Pass selection handlers to ClientTable
- Render `BulkActionBar` component when selections exist

### Phase B: Compose Dialog

**Goal:** Modal for composing the bulk email with subject, body, and optional template selection.

**New component: `BulkComposeDialog.tsx`**
- Shows recipient count ("Sending to 12 clients")
- Subject input field
- Rich text body (or simple textarea initially)
- Template dropdown (optional - can start without templates)
- Preview mode showing sample with first recipient
- Send button with confirmation

### Phase C: Edge Function Enhancement

**Goal:** Add `bulk-send` action to `helpscout-proxy` that processes recipients server-side.

**New action: `bulk-send`**
```text
Input:
  - bulkSendId (uuid) - reference to crm_bulk_send_logs record
  
Process:
  1. Fetch recipients from crm_bulk_send_recipients where bulk_send_id matches
  2. Fetch client emails from clients table
  3. For each recipient:
     a. Call HelpScout create-conversation
     b. Update crm_bulk_send_recipients.status
     c. Log any errors to error_message column
  4. Update crm_bulk_send_logs with final counts
```

### Phase D: Hooks and State Management

**New hooks:**

1. `useBulkSend.ts`
   - `createBulkSend(clientIds, subject, bodyHtml)` - mutation to create records and trigger send
   - Returns bulk_send_id for polling

2. `useBulkSendStatus.ts`
   - `useQuery` that polls `crm_bulk_send_logs` by ID
   - Returns progress (sent_count / recipient_count)
   - Auto-stops polling when status is 'completed' or 'failed'

### Phase E: Progress & Feedback

**Goal:** Show user the sending progress.

**Options:**
1. Toast notification with progress bar
2. Modal with live progress updates
3. Background task with notification when complete

**Recommendation:** Modal with progress bar that can be minimized to a toast. User can continue working.

---

## File Structure

```text
src/
  components/crm/clients/
    ClientTable.tsx           -- EDIT: Add checkbox column
    BulkActionBar.tsx         -- NEW: Floating action bar
  components/crm/bulk/
    BulkComposeDialog.tsx     -- NEW: Compose modal
    BulkProgressModal.tsx     -- NEW: Progress display
    RecipientPreview.tsx      -- NEW: Preview list
  hooks/crm/
    useBulkSend.ts            -- NEW: Create/trigger bulk send
    useBulkSendStatus.ts      -- NEW: Poll for progress
  pages/crm/
    Clients.tsx               -- EDIT: Add selection state

supabase/functions/
  helpscout-proxy/
    index.ts                  -- EDIT: Add 'bulk-send' action
```

---

## Database Usage

The existing tables are sufficient:

**crm_bulk_send_logs:**
- `id` - job identifier
- `subject` / `body_html` - message content
- `recipient_count` - total recipients
- `sent_count` / `failed_count` - progress tracking
- `status` - 'pending' → 'sending' → 'completed' / 'failed'

**crm_bulk_send_recipients:**
- `bulk_send_id` - links to parent job
- `client_id` - the recipient
- `status` - 'pending' → 'sent' / 'failed'
- `error_message` - failure reason if any

---

## Edge Function Bulk Send Logic

```text
async function handleBulkSend(bulkSendId, supabase):
  
  1. Fetch bulk_send record
  2. Update status to 'sending'
  
  3. Fetch recipients with client email join:
     SELECT r.*, c.email, c.pat_name_f, c.pat_name_l
     FROM crm_bulk_send_recipients r
     JOIN clients c ON r.client_id = c.id
     WHERE r.bulk_send_id = bulkSendId AND r.status = 'pending'
  
  4. For each recipient:
     - Skip if no email
     - Call create-conversation via HelpScout API
     - Update recipient status to 'sent' or 'failed'
     - Increment counters
  
  5. Update bulk_send_log:
     - sent_count = successful sends
     - failed_count = failures
     - status = 'completed' (or 'failed' if all failed)
     - completed_at = now()
```

---

## UI Flow

1. **User goes to Clients page, switches to Table view**
2. **Sees checkbox column, selects multiple clients**
3. **Floating bar appears: "12 clients selected" [Send Email] [Clear]**
4. **Clicks "Send Email" → Compose dialog opens**
5. **Enters subject and body, clicks "Send"**
6. **Progress modal shows: "Sending... 5 of 12"**
7. **Completes: "Sent 11 emails. 1 failed (no email address)"**
8. **User can view details or dismiss**

---

## Technical Considerations

### Clients Without Email
- Filter out clients with null/empty email in the edge function
- Mark them as 'skipped' with error_message "No email address"
- Show count in final summary

### HelpScout Rate Limits
- Add small delay between API calls (100-200ms)
- Handle 429 responses with exponential backoff
- Consider batch size limits for very large sends (50+ at a time)

### Activity Logging
- After successful send, create `crm_activity_events` record with `event_type: 'bulk_send'`
- Link to bulk_send_log for reference

---

## Phase Summary

| Phase | Scope | Complexity |
|-------|-------|------------|
| A | Selection UI in ClientTable | Medium |
| B | Compose Dialog | Medium |
| C | Edge Function bulk-send | High |
| D | Hooks for mutations/polling | Medium |
| E | Progress feedback | Low |

**Recommended order:** A → B → C → D → E (build UI first, then backend, then wire together)

---

## Scope Boundaries

**Included:**
- Multi-select from table view
- Free-form compose (subject + body)
- Individual emails per recipient via HelpScout
- Progress tracking
- Basic error handling

**Not Included (Phase 4+ / Future):**
- Template management UI
- Personalization variables ({{first_name}}, etc.)
- Scheduling sends for later
- Segment builder (dynamic recipient selection)
- Rich text editor (starts with textarea)

