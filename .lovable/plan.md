

# Staff Bulk Email Implementation Plan (Refined)

## Executive Summary

Extend the CRM bulk email system to support Staff/Therapists, reusing existing HelpScout infrastructure with minimal new code. This plan incorporates all identified risks and ensures zero disruption to existing client bulk send functionality.

---

## Technical Decision: Unified Bulk Send with `recipient_type` Discriminator

**Why this is the correct approach:**

| Alternative | Problem |
|-------------|---------|
| Separate `crm_staff_bulk_send_*` tables | Duplicates schema, requires separate edge function logic, doubles maintenance |
| Make `client_id` nullable + add `staff_id` | Breaks existing FK constraints, requires code changes everywhere |
| Generic polymorphic recipients table | Requires data migration, loses referential integrity |

The chosen approach:
1. Add `recipient_type` column to `crm_bulk_send_logs` (defaults to `'client'`)
2. Create parallel `crm_bulk_send_staff_recipients` table with `staff_id` FK
3. Branch in edge function based on `recipient_type`

This preserves **100% backward compatibility** - existing client sends continue working unchanged.

---

## Deployment Sequence (Critical Order)

Incorrect ordering causes failures. This sequence is mandatory:

```text
1. Database Migration
   └── Add recipient_type column (defaults to 'client')
   └── Create crm_bulk_send_staff_recipients table with RLS
   
2. Wait for TypeScript types regeneration
   └── Types auto-regenerate after migration
   
3. Edge Function Update
   └── Add staff branch to handleBulkSend
   └── Deploy function
   
4. Frontend Changes
   └── Type definitions (staff-types.ts)
   └── Hook (useStaff.ts)
   └── Components (StaffTable, StaffFilters, StaffStatusBadge)
   └── Page (Staff.tsx)
   └── Routing (App.tsx, CrmSidebar.tsx)
   └── Modify useBulkSend hook
   └── Generalize BulkActionBar and BulkComposeDialog
```

---

## Database Schema Changes

### Migration 1: Extend bulk_send_logs

```sql
-- Add recipient_type discriminator
ALTER TABLE crm_bulk_send_logs 
ADD COLUMN recipient_type TEXT NOT NULL DEFAULT 'client' 
CHECK (recipient_type IN ('client', 'staff'));

-- Index for filtering
CREATE INDEX idx_bulk_send_logs_recipient_type 
ON crm_bulk_send_logs(recipient_type);
```

### Migration 2: Staff recipients table

```sql
CREATE TABLE crm_bulk_send_staff_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_send_id UUID NOT NULL REFERENCES crm_bulk_send_logs(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX idx_bulk_send_staff_recipients_bulk_send 
ON crm_bulk_send_staff_recipients(bulk_send_id);

CREATE INDEX idx_bulk_send_staff_recipients_status 
ON crm_bulk_send_staff_recipients(bulk_send_id, status);

-- RLS policies (matching client recipients pattern exactly)
ALTER TABLE crm_bulk_send_staff_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view staff recipients in their tenant"
  ON crm_bulk_send_staff_recipients FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE profile_id = auth.uid()
  ));

CREATE POLICY "Users can insert staff recipients in their tenant"
  ON crm_bulk_send_staff_recipients FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE profile_id = auth.uid()
  ));

CREATE POLICY "Users can update staff recipients in their tenant"
  ON crm_bulk_send_staff_recipients FOR UPDATE
  USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE profile_id = auth.uid()
  ));
```

---

## Files Created

### 1. `src/lib/crm/staff-types.ts`

Type definitions for staff management:

```typescript
export type StaffStatus = 'Invited' | 'New' | 'Active' | 'Inactive';

export interface CrmStaff {
  id: string;
  tenant_id: string;
  prov_name_f: string | null;
  prov_name_l: string | null;
  prov_name_for_clients: string | null;
  prov_status: StaffStatus | null;
  prov_state: string | null;
  email: string | null; // Joined from profiles
}

export interface StaffFilters {
  statuses: StaffStatus[];
  states: string[];
  search: string;
}

export const STAFF_STATUS_CONFIG: Record<StaffStatus, {
  label: string;
  bgColor: string;
  textColor: string;
}> = {
  'Invited': {
    label: 'Invited',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    textColor: 'text-blue-700 dark:text-blue-300',
  },
  'New': {
    label: 'New',
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    textColor: 'text-purple-700 dark:text-purple-300',
  },
  'Active': {
    label: 'Active',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    textColor: 'text-green-700 dark:text-green-300',
  },
  'Inactive': {
    label: 'Inactive',
    bgColor: 'bg-gray-100 dark:bg-gray-800/50',
    textColor: 'text-gray-500 dark:text-gray-400',
  },
};
```

### 2. `src/hooks/crm/useStaff.ts`

Query hook with filtering (mirrors useClients pattern):

```typescript
export function useStaff(options: UseStaffOptions = {}) {
  const { tenantId, isAuthenticated } = useCrmAuth();
  const { filters, enabled = true } = options;

  return useQuery({
    queryKey: ['crm-staff', tenantId, filters],
    queryFn: async (): Promise<CrmStaff[]> => {
      let query = supabase
        .from('staff')
        .select(`
          id,
          tenant_id,
          prov_name_f,
          prov_name_l,
          prov_name_for_clients,
          prov_status,
          prov_state,
          profiles!inner (email)
        `)
        .eq('tenant_id', tenantId)
        .order('prov_name_l', { ascending: true });

      if (filters?.statuses?.length > 0) {
        query = query.in('prov_status', filters.statuses);
      }
      if (filters?.states?.length > 0) {
        query = query.in('prov_state', filters.states);
      }
      if (filters?.search?.trim()) {
        const term = `%${filters.search.trim()}%`;
        query = query.or(`prov_name_f.ilike.${term},prov_name_l.ilike.${term}`);
      }

      const { data, error } = await query;
      if (error) throw error;

      return data.map(s => ({
        ...s,
        email: s.profiles?.email ?? null,
      }));
    },
    enabled: enabled && isAuthenticated && !!tenantId,
  });
}
```

### 3. `src/components/crm/staff/StaffTable.tsx`

Table with checkboxes, name, email, status, state columns.

### 4. `src/components/crm/staff/StaffFilters.tsx`

Popover with Status and State multi-select dropdowns.

### 5. `src/components/crm/staff/StaffStatusBadge.tsx`

Badge component using STAFF_STATUS_CONFIG.

### 6. `src/pages/crm/Staff.tsx`

Main page composing all staff components with bulk selection state.

---

## Files Modified

### 1. `src/hooks/crm/useBulkSend.ts`

**Current signature:**
```typescript
interface CreateBulkSendParams {
  clientIds: string[];
  subject: string;
  bodyHtml: string;
}
```

**New signature (backward compatible):**
```typescript
interface CreateBulkSendParams {
  subject: string;
  bodyHtml: string;
  // One of these must be provided
  clientIds?: string[];
  staffIds?: string[];
}
```

**Logic changes:**
- Determine `recipientType` from which IDs array is provided
- Insert into `crm_bulk_send_logs` with `recipient_type`
- Insert into appropriate recipients table based on type
- Existing client calls continue working (clientIds still works)

### 2. `src/components/crm/clients/BulkActionBar.tsx`

Add `entityLabel` prop:

```typescript
interface BulkActionBarProps {
  selectedCount: number;
  onSendEmail: () => void;
  onClear: () => void;
  entityLabel?: 'client' | 'staff'; // defaults to 'client'
}
```

Display: `"{count} {entityLabel}s selected"`

### 3. `src/components/crm/bulk/BulkComposeDialog.tsx`

Add `recipientLabel` prop:

```typescript
interface BulkComposeDialogProps {
  // ... existing props
  recipientLabel?: 'client' | 'staff member'; // defaults to 'client'
}
```

Updates description and button text based on label.

### 4. `src/App.tsx`

Add route:
```typescript
<Route path="staff" element={<CrmStaff />} />
```

### 5. `src/components/crm/layout/CrmSidebar.tsx`

Replace disabled "Bulk Messaging" with active "Staff":
```typescript
{
  label: 'Staff',
  href: '/crm/staff',
  icon: UserCog, // or Users
  disabled: false,
}
```

### 6. `supabase/functions/helpscout-proxy/index.ts`

**In `handleBulkSend` function:**

```typescript
// Fetch bulk send log with recipient_type
const { data: bulkSendLog } = await supabase
  .from("crm_bulk_send_logs")
  .select("*, recipient_type")
  .eq("id", bulkSendId)
  .single();

let recipients;
let getRecipientData;

if (bulkSendLog.recipient_type === 'staff') {
  // Staff path
  const { data } = await supabase
    .from("crm_bulk_send_staff_recipients")
    .select(`
      id,
      staff_id,
      status,
      staff!inner (
        id,
        prov_name_f,
        prov_name_l,
        profiles!inner (email)
      )
    `)
    .eq("bulk_send_id", bulkSendId)
    .eq("status", "pending");
  
  recipients = data;
  getRecipientData = (r) => ({
    id: r.id,
    email: r.staff?.profiles?.email,
    firstName: r.staff?.prov_name_f || '',
    lastName: r.staff?.prov_name_l || '',
    recipientTable: 'crm_bulk_send_staff_recipients',
  });
} else {
  // Client path (existing logic unchanged)
  const { data } = await supabase
    .from("crm_bulk_send_recipients")
    .select(`...existing query...`)
    .eq("bulk_send_id", bulkSendId)
    .eq("status", "pending");
  
  recipients = data;
  getRecipientData = (r) => ({
    id: r.id,
    email: r.clients?.email,
    firstName: r.clients?.pat_name_f || '',
    lastName: r.clients?.pat_name_l || '',
    recipientTable: 'crm_bulk_send_recipients',
  });
}

// Unified processing loop
for (const recipient of recipients || []) {
  const data = getRecipientData(recipient);
  // ... HelpScout conversation creation (same for both types)
  // ... Update correct table using data.recipientTable
}
```

---

## Component Architecture

```text
Staff.tsx
├── Toolbar
│   ├── Search Input
│   └── StaffFilters (status, state dropdowns)
├── StaffTable
│   ├── Select All Checkbox
│   ├── Name Column (prov_name_f + prov_name_l)
│   ├── Email Column (from profiles.email)
│   ├── Status Column (StaffStatusBadge)
│   └── State Column (prov_state)
├── BulkActionBar (shared, entityLabel="staff")
├── BulkComposeDialog (shared, recipientLabel="staff member")
└── BulkProgressModal (reused as-is)
```

---

## Risk Analysis & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing client bulk sends | `recipient_type` defaults to `'client'`; existing code paths unchanged |
| Staff without email | Edge function already handles missing email (skip + log + mark failed) |
| TypeScript type mismatch | Types auto-regenerate after migration; wait before frontend changes |
| Edge function deployed before migration | Deployment sequence enforces DB first |
| RLS policy gaps | Exact same policy pattern as client recipients table |
| HelpScout rate limits | Existing 150ms delay between sends applies to staff too |

---

## Testing Checklist

1. **Existing client bulk send still works** - Send to 2-3 clients, verify delivery
2. **Staff page loads** - Navigate to /crm/staff, verify table renders
3. **Staff filters work** - Filter by Active status, filter by state
4. **Staff selection works** - Select 2+ staff, verify BulkActionBar appears
5. **Staff bulk send completes** - Send email, verify progress modal, verify HelpScout
6. **Staff emails appear in HelpScout** - Check mailbox for new conversations
7. **Edge function logs** - Verify no errors, correct recipient_type branching

---

## Summary

This implementation extends bulk email to staff with:
- Zero changes to existing client functionality
- Minimal database additions (1 column, 1 table)
- Reuse of all existing UI components
- Single conditional branch in edge function
- Proper tenant isolation via RLS

Total new files: 6
Total modified files: 6
Estimated implementation time: 2-3 hours

