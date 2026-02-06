
# Staff Bulk Email Implementation Plan

## Executive Summary

Extend the existing CRM bulk email system to support sending emails to Staff/Therapists. This leverages the existing infrastructure (HelpScout, bulk send tables, edge function) with minimal new code by following established patterns.

---

## Technical Decision: Unified Bulk Send Architecture with a `recipient_type` Discriminator

**The Right Approach: Extend existing tables rather than create parallel infrastructure.**

### Why This Is Correct

| Alternative | Problem |
|-------------|---------|
| Create separate `crm_staff_bulk_send_*` tables | Duplicates schema, requires separate edge function logic, doubles maintenance burden |
| Create a generic `recipients` table from scratch | Requires migrating existing client bulk send data |
| Add staff support inline to existing tables | Clean extension of existing pattern, minimal schema change, reuses all existing code |

The existing `crm_bulk_send_recipients` table has a `client_id` FK. Rather than making this nullable and adding a separate `staff_id` column (which would break existing code), we will:

1. Add a `recipient_type` column to `crm_bulk_send_logs` to indicate whether recipients are `'client'` or `'staff'`
2. Create a new `crm_bulk_send_staff_recipients` table that mirrors the structure of `crm_bulk_send_recipients` but references `staff.id`
3. Extend the edge function to check `recipient_type` and process accordingly

This approach:
- Preserves all existing client bulk send functionality untouched
- Keeps referential integrity (FK constraints remain valid)
- Minimal edge function changes (one conditional branch)
- Clear separation of concerns

---

## Database Changes

### 1. Add `recipient_type` to `crm_bulk_send_logs`

```sql
ALTER TABLE crm_bulk_send_logs 
ADD COLUMN recipient_type TEXT NOT NULL DEFAULT 'client' 
CHECK (recipient_type IN ('client', 'staff'));
```

### 2. Create Staff Recipients Table

```sql
CREATE TABLE crm_bulk_send_staff_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_send_id UUID NOT NULL REFERENCES crm_bulk_send_logs(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  sent_at TIMESTAMPTZ
);

-- RLS policies matching existing pattern
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
```

---

## Frontend Components

### New Files

| File | Purpose |
|------|---------|
| `src/pages/crm/Staff.tsx` | Main staff page with table view, filters, and bulk selection |
| `src/hooks/crm/useStaff.ts` | Query staff with filters (status, state) + join profiles for email |
| `src/components/crm/staff/StaffTable.tsx` | Table component with checkboxes, mirrors ClientTable |
| `src/components/crm/staff/StaffFilters.tsx` | Popover with Status (New/Active/Inactive) and State filters |
| `src/components/crm/staff/StaffStatusBadge.tsx` | Status badge for clinician_status_enum values |
| `src/lib/crm/staff-types.ts` | TypeScript types for CrmStaff, StaffFilters, etc. |

### Modified Files

| File | Change |
|------|--------|
| `src/components/crm/layout/CrmSidebar.tsx` | Add "Staff" nav item (remove disabled flag from or replace Bulk Messaging) |
| `src/App.tsx` | Add route `/crm/staff` |
| `src/hooks/crm/useBulkSend.ts` | Add support for `recipientType: 'client' | 'staff'` and `staffIds` |
| `src/components/crm/clients/BulkActionBar.tsx` | Generalize to accept `entityType` prop for display text |
| `supabase/functions/helpscout-proxy/index.ts` | Handle `recipient_type === 'staff'` in bulk-send action |

---

## Component Architecture

```text
Staff.tsx
  ├── StaffFilters (status, state dropdowns)
  ├── StaffTable
  │     ├── Checkbox (select all / individual)
  │     ├── Name column (prov_name_f + prov_name_l)
  │     ├── Email column (from profiles.email)
  │     ├── Status column (StaffStatusBadge)
  │     └── State column (prov_state)
  ├── BulkActionBar (shared with clients, shows "X staff selected")
  ├── BulkComposeDialog (reused as-is)
  └── BulkProgressModal (reused as-is)
```

---

## Data Flow

```text
User selects staff → clicks "Send Email" → BulkComposeDialog opens
        ↓
User enters subject/body → clicks Send
        ↓
useBulkSend.createBulkSend({
  staffIds: [...],
  recipientType: 'staff',
  subject,
  bodyHtml
})
        ↓
Creates crm_bulk_send_logs with recipient_type='staff'
Creates crm_bulk_send_staff_recipients records
Triggers helpscout-proxy?action=bulk-send
        ↓
Edge function checks recipient_type
Fetches from crm_bulk_send_staff_recipients
Joins staff → profiles for email
Sends via HelpScout API
```

---

## useStaff Hook Implementation

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
          profiles!inner (
            email
          )
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

---

## Edge Function Changes

In `handleBulkSend`:

```typescript
// Fetch bulk send log
const { data: bulkSendLog } = await supabase
  .from("crm_bulk_send_logs")
  .select("*, recipient_type")
  .eq("id", bulkSendId)
  .single();

if (bulkSendLog.recipient_type === 'staff') {
  // Fetch staff recipients
  const { data: recipients } = await supabase
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

  // Process each recipient
  for (const recipient of recipients) {
    const email = recipient.staff?.profiles?.email;
    // ... same HelpScout conversation creation logic
  }
} else {
  // Existing client logic unchanged
}
```

---

## Staff Status Configuration

```typescript
// src/lib/crm/staff-types.ts
export type StaffStatus = 'Invited' | 'New' | 'Active' | 'Inactive';

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

---

## Sidebar Update

Replace the disabled "Bulk Messaging" nav item with an active "Staff" link:

```typescript
{
  label: 'Staff',
  href: '/crm/staff',
  icon: Users, // or UserCog from lucide
},
```

---

## Implementation Sequence

1. **Database migration**: Add `recipient_type` column and create `crm_bulk_send_staff_recipients` table
2. **Type definitions**: Create `src/lib/crm/staff-types.ts`
3. **Hook**: Create `src/hooks/crm/useStaff.ts`
4. **Components**: Create `StaffTable.tsx`, `StaffFilters.tsx`, `StaffStatusBadge.tsx`
5. **Page**: Create `src/pages/crm/Staff.tsx`
6. **Routing**: Add route in `App.tsx`, update sidebar
7. **Modify useBulkSend**: Support `recipientType` parameter
8. **Edge function**: Add staff recipient processing branch
9. **Testing**: End-to-end verification

---

## Risk Mitigation

- **No changes to existing client bulk send flow**: The `recipient_type` column defaults to `'client'`, so existing data and code paths are unaffected
- **Email availability**: Staff email comes from `profiles.email` via FK join, verified to work (sample query confirmed emails exist)
- **RLS**: New table follows existing RLS patterns for tenant isolation
