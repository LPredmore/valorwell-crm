

# ValorWell CRM - Implementation Plan

## Overview
Build a CRM application that integrates with your existing Supabase data, provides a Missive-powered email inbox, and enables status-driven client management with a UI similar to established CRM tools.

---

## Phase 1: Foundation & Data Integration
**Goal: Connect to existing Supabase and establish core CRM structure**

### 1.1 Supabase Connection & Schema Discovery
- Connect to your existing Supabase project
- Review existing tables (clients, statuses, admin users)
- Identify relationships and any schema additions needed

### 1.2 Schema Enhancements
- Add email address field to client/contact records
- Create internal notes table for CRM annotations
- Create conversations-to-clients linking table
- Add activity/timeline tracking table for status changes and events

### 1.3 Authentication
- Implement admin login using your existing Supabase auth
- Set up RLS policies for proper data access control

---

## Phase 2: Core CRM Interface
**Goal: Build the main CRM views for managing clients and statuses**

### 2.1 Dashboard & Navigation
- Sidebar navigation (similar to HubSpot/Pipedrive)
- Quick stats overview (counts by status, needs reply count)

### 2.2 Kanban Board View
- Drag-and-drop cards grouped by pipeline status
- Visual status progression
- Quick preview of client details on hover/click

### 2.3 Table/List View
- Sortable, filterable client list
- Saved view presets (e.g., "Waitlist by State", "Needs Reply")
- Column customization

### 2.4 Client Detail Page
- Summary header with current status and key info
- Activity timeline showing:
  - Status changes (timestamped)
  - Internal notes
  - Email activity (linked conversations)
- Quick actions: change status, add note, link conversations

---

## Phase 3: Missive Email Integration
**Goal: Native inbox within the CRM powered by Missive API**

### 3.1 Missive Connection
- Secure server-side API proxy (Edge Function)
- Connect Missive account and configure fixed "From" identity
- Store credentials securely (never exposed client-side)

### 3.2 Inbox UI
- **Left Panel**: Conversation list with subject, participants, timestamps
- **Main Panel**: Thread viewer with chronological messages, attachments
- **Right Panel**: Linked CRM record context + internal notes

### 3.3 "Needs Reply" System
- Automatic detection (inbound message without subsequent reply)
- Visual badge/indicator on conversations
- Filterable inbox view for "Needs Reply" only

### 3.4 Reply & Compose
- Inline reply box below conversation thread
- Gmail-style automatic quoting (sender, timestamp, body)
- Attachment upload with progress indicator
- Rich text formatting

### 3.5 Conversation-Client Linking
- Auto-link based on email address match (once emails added to clients)
- Manual link/unlink from inbox and client detail page
- Show related conversations on client detail page

---

## Phase 4: Bulk Messaging & Segments
**Goal: Enable targeted operational bulk emails**

### 4.1 Segment Builder
- Filter clients by status, state, or other attributes
- Save segments for reuse

### 4.2 Bulk Send Workflow
- Compose email with template selection
- Preview recipients and sample list
- Confirm and send with throttling
- Log results per recipient (success/failure)
- Add timeline entry summarizing bulk send

### 4.3 Suppression
- "Do not contact" flag on client records
- Automatically exclude from bulk sends

---

## Phase 5: Polish & Settings
**Goal: Admin configuration and system health**

### 5.1 Settings Pages
- Status/pipeline management (add, edit, reorder)
- Email templates manager
- Missive connection health & status

### 5.2 Connection Health UI
- Last sync timestamp
- Error states with recovery steps
- Connection status indicator

### 5.3 Basic Reporting
- Counts by status
- "Needs Reply" with age buckets
- Bulk send summaries

---

## Future Phases (After MVP)
*Not included in initial build, but architecture will support:*
- Full automation rules engine with configurable triggers/conditions
- Multi-user support with role-based permissions
- Multiple mailboxes/inboxes
- Advanced analytics

---

## Technical Approach

| Component | Technology |
|-----------|------------|
| Frontend | React + TypeScript + Tailwind CSS |
| UI Components | shadcn/ui (already installed) |
| State Management | TanStack Query |
| Backend | Supabase (your existing project) |
| Email Integration | Supabase Edge Functions → Missive API |
| Real-time Updates | Supabase Realtime + Missive webhooks |

---

## Key Deliverables

1. **Kanban + Table views** for status-driven client management
2. **Client detail page** with activity timeline and notes
3. **In-app inbox** powered by Missive with full reply/compose
4. **Automatic "Needs Reply"** detection and filtering
5. **Conversation ↔ Client linking** (auto + manual)
6. **Bulk email** to filtered segments with logging
7. **Settings** for statuses, templates, and connection management

