

# Kanban Status Configuration Implementation Plan

## Discovery Summary

### Current State Analysis

**Database Enum (20 statuses):**
Interested, New, Active, Inactive, Registered, Waitlist, Matching, Unscheduled, Scheduled, Early Sessions, Established, Not the Right Time, Found Somewhere Else, Went Dark (Previously Seen), Blacklisted, Unresponsive - Warm, Unresponsive - Cold, Manual Check, No Insurance, DNC

**Current Code (17 statuses):**
Missing: Manual Check, No Insurance, DNC

**Tags Column:**
`public.clients.tags` is a TEXT field (single value per client) with existing values like "Unresponsive Warm", "LEGACY", "DNC"

---

## Technical Decision: Per-Tenant Database Configuration

### Why This Architecture

**Option A: Hardcoded in code** - Rejected
- No runtime configurability
- Requires code deployment to change order
- All tenants forced to use same workflow

**Option B: LocalStorage per-user** - Rejected
- Doesn't sync across devices/browsers
- Each user configures separately (inconsistent team experience)
- Lost on browser clear

**Option C: Database per-user** - Rejected
- Different team members see different pipelines
- Confusing for collaboration ("I don't see that column")

**Option D: Database per-tenant** - Selected
- Business workflows are organizational decisions, not personal preferences
- Admins configure once, all team members share same view
- Persists correctly across sessions and devices
- Follows existing multi-tenant architecture pattern
- Standard CRM practice (HubSpot, Pipedrive work this way)

---

## Implementation Architecture

### New Database Table

```text
crm_kanban_config
  - id (uuid, PK)
  - tenant_id (uuid, FK tenants, UNIQUE)
  - visible_statuses (text[])  -- Ordered array of status names
  - created_at (timestamptz)
  - updated_at (timestamptz)
```

**Why text[] array:**
- Order matters and is preserved
- Simple to add/remove/reorder
- No junction table complexity
- Matches PostgreSQL's native array features

### Default Status Configuration

Based on typical therapy practice client journey, the recommended default order:

```text
Pipeline Stage          | Status           | Rationale
------------------------|------------------|---------------------------
1. Intake               | Interested       | Initial inquiry received
2. Intake               | New              | Completed intake form
3. Review Required      | No Insurance     | Needs insurance resolution
4. Review Required      | Manual Check     | Requires admin review
5. Waiting              | Waitlist         | Waiting for availability
6. Matching             | Matching         | Finding right therapist
7. Onboarding           | Registered       | Paperwork completed
8. Onboarding           | Unscheduled      | Registered, no appointment yet
9. Onboarding           | Scheduled        | Has upcoming appointment
10. Active Care         | Early Sessions   | First 1-3 appointments
11. Active Care         | Established      | Ongoing therapeutic relationship
12. Terminal            | Inactive         | Paused or completed care
13. Terminal            | Blacklisted      | Do not contact (serious)
14. Terminal            | DNC              | Do not contact (preference)
```

**Excluded from default Kanban view:**
- Active (redundant with Established)
- Not the Right Time (closed state)
- Found Somewhere Else (closed state)
- Went Dark (Previously Seen) (legacy tracking)
- Unresponsive - Warm/Cold (can be handled with tags)

---

## Tags Filtering Approach

### Current Constraint
Cannot modify `clients` table (additive-only rule). Tags is a single TEXT field.

### Solution: Smart Filter UI
Add a tags filter dropdown that:
1. Queries distinct tag values from clients table
2. Applies ILIKE filter to show matching clients within each Kanban column
3. Works with existing data structure

**Query for distinct tags:**
```sql
SELECT DISTINCT tags FROM clients 
WHERE tenant_id = $1 AND tags IS NOT NULL
```

**Filter application:**
```sql
-- When tag filter is active
.ilike('tags', `%${selectedTag}%`)
```

---

## File Changes

### New Files

```text
src/hooks/crm/useKanbanConfig.ts       -- Fetch/save Kanban settings
src/hooks/crm/useTagOptions.ts         -- Fetch distinct tags
src/components/crm/settings/
  KanbanConfigPanel.tsx                -- Drag-drop status ordering UI
```

### Modified Files

```text
src/lib/crm/types.ts                   -- Add 3 missing statuses to PatStatus
src/lib/crm/status-config.ts           -- Add configs for all 20 statuses
src/components/crm/clients/ClientKanban.tsx      -- Use dynamic config
src/components/crm/clients/ClientFilters.tsx     -- Add tags filter
src/hooks/crm/useClients.ts            -- Support tags filter
src/pages/crm/Settings.tsx             -- Add Kanban config section
```

---

## Implementation Steps

### Step 1: Database Migration
Create `crm_kanban_config` table with:
- Tenant foreign key (unique constraint)
- text[] for ordered visible statuses
- RLS policies matching existing pattern

### Step 2: Sync Status Definitions
Update TypeScript types and STATUS_CONFIG to include all 20 database enum values:
- Manual Check (orange, review category)
- No Insurance (amber, review category)
- DNC (red, closed category)

### Step 3: Create Configuration Hook
`useKanbanConfig` hook that:
- Fetches tenant's Kanban config
- Returns default if none exists
- Provides save mutation for admins
- Caches with TanStack Query

### Step 4: Update Kanban Component
Modify `ClientKanban.tsx` to:
- Consume `useKanbanConfig` instead of hardcoded `KANBAN_STATUSES`
- Render columns in config-specified order
- Only show configured statuses

### Step 5: Add Tags Filtering
- Create `useTagOptions` hook to fetch distinct tags
- Add tags filter to `ClientFilters.tsx`
- Update `useClients` to apply tag filter

### Step 6: Build Settings UI
Create `KanbanConfigPanel.tsx` with:
- List of all available statuses
- Checkboxes to toggle visibility
- Drag-and-drop to reorder visible statuses
- Save button (admin only)
- Preview of current Kanban order

---

## UI Design for Settings

```text
+------------------------------------------+
| Kanban Column Configuration              |
+------------------------------------------+
| Visible Columns (drag to reorder)        |
| +--------------------------------------+ |
| | ≡ Interested                    [x]  | |
| | ≡ New                           [x]  | |
| | ≡ No Insurance                  [x]  | |
| | ≡ Manual Check                  [x]  | |
| | ≡ Waitlist                      [x]  | |
| | ≡ Matching                      [x]  | |
| | ...                                  | |
| +--------------------------------------+ |
|                                          |
| Hidden Statuses                          |
| +--------------------------------------+ |
| | [ ] Active                           | |
| | [ ] Not the Right Time               | |
| | [ ] Found Somewhere Else             | |
| | ...                                  | |
| +--------------------------------------+ |
|                                          |
| [Save Configuration]                     |
+------------------------------------------+
```

---

## Data Flow

```text
1. User loads /crm/clients
        |
2. useKanbanConfig fetches crm_kanban_config for tenant
        |
3a. Config exists -> Return visible_statuses array
3b. No config -> Return default 14-status array
        |
4. ClientKanban renders columns in specified order
        |
5. Admin visits Settings -> Can modify config
        |
6. On save -> Updates crm_kanban_config
        |
7. TanStack Query invalidates -> Kanban re-renders
```

---

## Security

- RLS on crm_kanban_config: tenant members can read, admin-only writes
- No modification to existing tables
- Tags filter uses parameterized queries (no SQL injection)

---

## Complete Status Configuration (All 20)

| Status | Label | Color | Category | Default Visible |
|--------|-------|-------|----------|-----------------|
| Interested | Interested | Blue | lead | Yes |
| New | New | Purple | lead | Yes |
| No Insurance | No Insurance | Amber | review | Yes |
| Manual Check | Manual Check | Orange | review | Yes |
| Waitlist | Waitlist | Yellow | lead | Yes |
| Matching | Matching | Orange | onboarding | Yes |
| Registered | Registered | Teal | onboarding | Yes |
| Unscheduled | Unscheduled | Amber | onboarding | Yes |
| Scheduled | Scheduled | Cyan | onboarding | Yes |
| Early Sessions | Early Sessions | Green | active | Yes |
| Established | Established | Emerald | active | Yes |
| Active | Active | Green | active | No |
| Inactive | Inactive | Gray | closed | Yes |
| Blacklisted | Blacklisted | Red | closed | Yes |
| DNC | Do Not Contact | Red | closed | Yes |
| Not the Right Time | Not the Right Time | Violet | closed | No |
| Found Somewhere Else | Found Elsewhere | Slate | closed | No |
| Went Dark | Went Dark | Gray | inactive | No |
| Unresponsive - Warm | Unresponsive (Warm) | Orange | inactive | No |
| Unresponsive - Cold | Unresponsive (Cold) | Slate | inactive | No |

