
# ValorWell CRM - Sprint 1 Implementation Plan

## Overview

Build Phase 1 of the CRM: Foundation, Authentication, and Core Client Views. This sprint focuses on establishing the CRM infrastructure with **zero modifications to existing tables**.

---

## Database Discovery Summary

### Existing Tables We Will READ FROM (Never Modify)

| Table | Key Columns for CRM |
|-------|---------------------|
| `clients` | id, tenant_id, pat_name_f/m/l, pat_name_preferred, email, phone, pat_state, pat_status (enum), primary_staff_id |
| `profiles` | id, email, is_active |
| `staff` | id, tenant_id, profile_id, prov_name_f/l, prov_name_for_clients |
| `tenant_memberships` | tenant_id, profile_id, tenant_role |
| `user_roles` | user_id, role (admin/staff/client) |
| `tenants` | id |

### Existing Status Pipeline (17 values)
Active, Blacklisted, Early Sessions, Established, Found Somewhere Else, Inactive, Interested, Matching, New, Not the Right Time, Registered, Scheduled, Unresponsive - Cold, Unresponsive - Warm, Unscheduled, Waitlist, Went Dark (Previously Seen)

### Existing RLS Pattern
Uses `tenant_memberships` subquery for tenant isolation and `has_role()` security definer function for role checks.

---

## Phase 1A: New CRM Database Tables

### 8 New Tables (Additive Only)

```text
1. crm_notes
   - id (uuid, PK)
   - tenant_id (uuid, FK tenants, NOT NULL)
   - client_id (uuid, FK clients, nullable)
   - conversation_id (text, nullable) -- Missive conversation ID
   - created_by_profile_id (uuid, FK profiles, NOT NULL)
   - note_content (text, NOT NULL)
   - note_type (text: 'internal' | 'system')
   - is_pinned (boolean, default false)
   - created_at, updated_at (timestamptz)

2. crm_activity_events
   - id (uuid, PK)
   - tenant_id (uuid, FK tenants, NOT NULL)
   - client_id (uuid, FK clients, NOT NULL)
   - event_type (text: 'status_change' | 'note_added' | 'email_sent' | 'email_received' | 'conversation_linked' | 'bulk_send')
   - old_value (text, nullable)
   - new_value (text, nullable)
   - metadata (jsonb)
   - created_by_profile_id (uuid, FK profiles, nullable)
   - created_at (timestamptz)

3. missive_conversations
   - id (uuid, PK)
   - tenant_id (uuid, FK tenants, NOT NULL)
   - missive_conversation_id (text, UNIQUE, NOT NULL)
   - subject (text)
   - snippet (text) -- Preview text
   - participants (jsonb) -- Array of {email, name}
   - last_message_at (timestamptz)
   - needs_reply (boolean, default false)
   - is_archived (boolean, default false)
   - created_at, updated_at (timestamptz)

4. missive_conversation_links
   - id (uuid, PK)
   - tenant_id (uuid, FK tenants, NOT NULL)
   - conversation_id (uuid, FK missive_conversations, NOT NULL)
   - client_id (uuid, FK clients, NOT NULL)
   - linked_by_profile_id (uuid, FK profiles, NOT NULL)
   - link_type (text: 'auto' | 'manual')
   - created_at (timestamptz)
   - UNIQUE(conversation_id, client_id)

5. crm_email_templates
   - id (uuid, PK)
   - tenant_id (uuid, FK tenants, NOT NULL)
   - name (text, NOT NULL)
   - subject (text, NOT NULL)
   - body_html (text, NOT NULL)
   - is_active (boolean, default true)
   - created_by_profile_id (uuid, FK profiles, NOT NULL)
   - created_at, updated_at (timestamptz)

6. crm_bulk_send_logs
   - id (uuid, PK)
   - tenant_id (uuid, FK tenants, NOT NULL)
   - template_id (uuid, FK crm_email_templates, nullable)
   - subject (text, NOT NULL)
   - body_html (text, NOT NULL)
   - recipient_count (integer)
   - sent_count (integer, default 0)
   - failed_count (integer, default 0)
   - status (text: 'pending' | 'in_progress' | 'completed' | 'failed')
   - created_by_profile_id (uuid, FK profiles, NOT NULL)
   - created_at (timestamptz)
   - completed_at (timestamptz, nullable)

7. crm_bulk_send_recipients
   - id (uuid, PK)
   - bulk_send_id (uuid, FK crm_bulk_send_logs, NOT NULL)
   - client_id (uuid, FK clients, NOT NULL)
   - tenant_id (uuid, FK tenants, NOT NULL)
   - status (text: 'pending' | 'sent' | 'failed')
   - error_message (text, nullable)
   - sent_at (timestamptz, nullable)

8. crm_missive_settings
   - id (uuid, PK)
   - tenant_id (uuid, FK tenants, UNIQUE, NOT NULL)
   - from_email (text)
   - from_name (text)
   - is_connected (boolean, default false)
   - last_sync_at (timestamptz, nullable)
   - connection_status (text)
   - created_at, updated_at (timestamptz)
```

### RLS Policies (Using Existing Pattern)

All new tables will use the same tenant isolation pattern:
```sql
-- Read access for tenant members
tenant_id IN (
  SELECT tenant_id FROM tenant_memberships 
  WHERE profile_id = auth.uid()
)

-- Admin-only write operations where needed
has_role(auth.uid(), 'admin')
```

---

## Phase 1B: Authentication & Layout

### Authentication Flow
1. Check if user is authenticated via Supabase Auth
2. Verify user has `admin` or `staff` role via `user_roles` table
3. Verify user has tenant membership via `tenant_memberships`
4. Store current tenant context for queries

### Route Structure
```text
/crm                     -> Redirect to /crm/clients
/crm/clients             -> Client list (Kanban + Table views)
/crm/clients/:id         -> Client detail page
/crm/inbox               -> Missive inbox (Phase 3)
/crm/inbox/:id           -> Conversation detail (Phase 3)
/crm/bulk                -> Bulk messaging (Phase 4)
/crm/settings            -> Settings hub
/crm/settings/templates  -> Email templates
/crm/settings/missive    -> Missive connection
```

### Layout Components
```text
src/
  components/
    crm/
      layout/
        CrmLayout.tsx      -- Main layout wrapper with auth check
        CrmSidebar.tsx     -- Navigation sidebar
        CrmHeader.tsx      -- Top bar with user menu
```

---

## Phase 1C: Core CRM Interface

### 1. Dashboard Stats (Quick Overview)
- Total clients count
- Clients by status (chart)
- Needs reply count (when inbox ready)
- Recent activity feed

### 2. Client Kanban Board
- Columns for each status in pipeline order
- Draggable cards showing:
  - Client name (preferred or full)
  - State (pat_state)
  - Primary therapist name
  - Days since last status change
- Drag-and-drop creates activity event
- Click opens client detail

### 3. Client Table View
- Sortable columns: Name, Email, Status, State, Therapist, Created
- Filters: Status (multi-select), State (multi-select)
- Search by name/email
- Quick status change dropdown
- Toggle between Kanban/Table views

### 4. Client Detail Page
- Header: Name, current status (dropdown to change), email, phone
- Left panel: Client info card with key details
- Right panel: Activity timeline
  - Status changes
  - Internal notes
  - Future: Email activity
- Add note form
- Linked conversations section (Phase 3)

---

## File Structure

```text
src/
  pages/
    crm/
      Index.tsx              -- Dashboard/redirect
      Clients.tsx            -- Kanban + Table views
      ClientDetail.tsx       -- Single client page
      Inbox.tsx              -- (Phase 3)
      BulkMessaging.tsx      -- (Phase 4)
      Settings.tsx           -- Settings index
      settings/
        Templates.tsx        -- (Phase 4)
        MissiveConnection.tsx -- (Phase 3)
  
  components/
    crm/
      layout/
        CrmLayout.tsx
        CrmSidebar.tsx
        CrmHeader.tsx
      clients/
        ClientKanban.tsx
        ClientKanbanColumn.tsx
        ClientKanbanCard.tsx
        ClientTable.tsx
        ClientFilters.tsx
        StatusBadge.tsx
        StatusSelect.tsx
      detail/
        ClientInfoCard.tsx
        ActivityTimeline.tsx
        ActivityItem.tsx
        NoteForm.tsx
      common/
        QuickStats.tsx
  
  hooks/
    crm/
      useClients.ts           -- Fetch/filter clients
      useClientDetail.ts      -- Single client + updates
      useActivityEvents.ts    -- Timeline data
      useCrmNotes.ts          -- Notes CRUD
      useCrmAuth.ts           -- Auth + tenant context
      useStatusUpdate.ts      -- Status change with activity log

  lib/
    crm/
      status-config.ts        -- Status colors, order, labels
      types.ts                -- TypeScript interfaces
```

---

## New Dependencies Required

| Package | Purpose |
|---------|---------|
| `@dnd-kit/core` | Drag-and-drop for Kanban |
| `@dnd-kit/sortable` | Sortable items in Kanban |

---

## Technical Implementation Details

### Status Configuration
Map the 17 existing statuses to colors and pipeline order:
```typescript
const STATUS_CONFIG = {
  'Interested': { color: 'blue', order: 1, category: 'lead' },
  'New': { color: 'purple', order: 2, category: 'lead' },
  'Waitlist': { color: 'yellow', order: 3, category: 'lead' },
  'Matching': { color: 'orange', order: 4, category: 'onboarding' },
  'Scheduled': { color: 'cyan', order: 5, category: 'onboarding' },
  'Registered': { color: 'teal', order: 6, category: 'onboarding' },
  'Early Sessions': { color: 'green', order: 7, category: 'active' },
  'Established': { color: 'emerald', order: 8, category: 'active' },
  'Active': { color: 'green', order: 9, category: 'active' },
  // ... etc
};
```

### Client Query with Joins
```typescript
const { data: clients } = await supabase
  .from('clients')
  .select(`
    id, pat_name_f, pat_name_m, pat_name_l, pat_name_preferred,
    email, phone, pat_state, pat_status, created_at, updated_at,
    primary_staff:staff!clients_primary_staff_id_fkey (
      id, prov_name_f, prov_name_l, prov_name_for_clients
    )
  `)
  .eq('tenant_id', tenantId)
  .order('updated_at', { ascending: false });
```

### Activity Event Logging
When status changes:
```typescript
await supabase.from('crm_activity_events').insert({
  tenant_id: tenantId,
  client_id: clientId,
  event_type: 'status_change',
  old_value: previousStatus,
  new_value: newStatus,
  created_by_profile_id: userId,
  metadata: { source: 'kanban_drag' }
});
```

---

## Security Considerations

1. **No existing table modifications** - All reads are safe
2. **Tenant isolation** - Every query scoped to user's tenant
3. **Role verification** - Only admin/staff can access CRM
4. **RLS on all new tables** - Using existing proven pattern
5. **Status changes audited** - Activity events create paper trail

---

## Implementation Order

### Step 1: Database Migration
- Create all 8 new CRM tables
- Add RLS policies using existing pattern
- Add indexes for common queries

### Step 2: Authentication & Layout
- CrmLayout with auth check
- CrmSidebar with navigation
- Route configuration

### Step 3: Client List Views
- useClients hook for data fetching
- ClientTable component
- ClientKanban component with drag-and-drop
- Status filters

### Step 4: Client Detail Page
- ClientDetail page
- ClientInfoCard
- ActivityTimeline
- NoteForm and useCrmNotes hook

---

## What This Plan Does NOT Touch

| Existing Resource | Our Approach |
|-------------------|--------------|
| `clients` table | READ ONLY - no schema changes |
| `profiles` table | READ ONLY |
| `staff` table | READ ONLY |
| `tenant_memberships` | READ ONLY |
| `user_roles` table | READ ONLY |
| `pat_status_enum` | Use as-is, no modifications |
| `has_role()` function | Use existing function |
| Any existing RLS policies | Leave untouched |
| Any existing triggers | Leave untouched |
