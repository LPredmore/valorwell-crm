
# Plan: Add Quick Client Profile Sheet with Status Change

## Overview
Create a slide-out panel (Sheet) that shows a client's non-clinical contact information and allows changing their status quickly without navigating to the full detail page.

---

## What Will Be Built

### 1. Quick Profile Sheet Component
A new `ClientQuickProfile.tsx` component that slides in from the right side, displaying:
- Client name (with preferred name if different)
- Email (clickable mailto link)
- Phone (clickable tel link)
- State
- Primary Therapist
- Current Status (as a dropdown/select for changing)
- Client Since date

### 2. Status Update Hook
A new `useUpdateClientStatus.ts` hook that:
- Updates `pat_status` in the `clients` table
- Logs the change to `crm_activity_events` for audit trail
- Invalidates the client queries to refresh the UI

### 3. Integration Points
The quick profile can be triggered from:
- **Kanban cards** - New "quick view" button (or click behavior option)
- **Table rows** - Right-click context menu or dedicated button
- Initially, we'll add a dedicated "eye" icon button in the table for simplicity

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/components/crm/clients/ClientQuickProfile.tsx` | The slide-out Sheet panel component |
| `src/hooks/crm/useUpdateClientStatus.ts` | Mutation hook for status updates with activity logging |

## Files to Modify

| File | Change |
|------|--------|
| `src/components/crm/clients/ClientTable.tsx` | Add quick-view button column to trigger the sheet |
| `src/pages/crm/Clients.tsx` | Add state for selected client and render the ClientQuickProfile sheet |

---

## Technical Details

### ClientQuickProfile Component Structure
```text
Sheet (right side, sm:max-w-md)
├── SheetHeader
│   ├── SheetTitle: Client Name
│   └── SheetDescription: "Client since [date]"
├── SheetContent
│   ├── Contact Info Section
│   │   ├── Email with mail icon
│   │   ├── Phone with phone icon
│   │   └── State with map-pin icon
│   ├── Therapist Section
│   │   └── Primary Therapist name
│   └── Status Section
│       ├── Current status badge (visual)
│       └── Select dropdown with all statuses to change
└── SheetFooter
    └── "View Full Profile" button → navigates to /crm/clients/:id
```

### Status Update Hook Logic
```typescript
// In useUpdateClientStatus.ts
useMutation({
  mutationFn: async ({ clientId, newStatus, oldStatus }) => {
    // 1. Update client status
    await supabase
      .from('clients')
      .update({ pat_status: newStatus })
      .eq('id', clientId);

    // 2. Log activity event for audit trail
    await supabase
      .from('crm_activity_events')
      .insert({
        tenant_id: tenantId,
        client_id: clientId,
        event_type: 'status_change',
        old_value: oldStatus,
        new_value: newStatus,
        created_by_profile_id: userId,
      });
  },
  onSuccess: () => {
    // Invalidate queries to refresh client list
    queryClient.invalidateQueries(['crm-clients']);
    queryClient.invalidateQueries(['crm-client', clientId]);
    toast.success('Status updated');
  }
});
```

### Table Integration
Add a new column before "Last Updated" with an eye icon button:
```typescript
<TableCell>
  <Button
    variant="ghost"
    size="icon"
    onClick={(e) => {
      e.stopPropagation();
      onQuickView(client);
    }}
  >
    <Eye className="h-4 w-4" />
  </Button>
</TableCell>
```

### Status Select Component
Uses the existing `ALL_STATUSES` from status-config and a Select component:
- Shows status color dot next to each option
- Grouped by category (Lead, Onboarding, Active, Inactive, Closed)
- Triggers mutation on change with optimistic UI update

---

## User Experience Flow

1. User is on Clients table view
2. User sees an "eye" icon on each row
3. User clicks the eye icon → Sheet slides in from right
4. Sheet shows client contact info and current status
5. User can:
   - Click email/phone to contact
   - Change status via dropdown (saves immediately with toast confirmation)
   - Click "View Full Profile" to go to detail page
6. User clicks X or outside to close sheet
