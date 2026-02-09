

# Plan: Bulk Status Change + Sortable Table Columns

## Feature 1: Bulk Status Change

### How It Works
When you select multiple clients in the table view, a "Change Status" button will appear in the bulk action bar (alongside the existing Send Email, Send Text, and Enroll in Campaign buttons). Clicking it opens a dropdown/dialog where you pick the new status, and all selected clients are updated at once with activity log entries for each.

### Implementation Details

**New hook: `src/hooks/crm/useBulkUpdateStatus.ts`**
- Accepts an array of client IDs, a new status, and optionally each client's old status (for audit logging)
- Loops through each client, updating `pat_status` and inserting `crm_activity_events` rows
- Shows a toast on completion with success/failure counts
- Invalidates the `crm-clients` query to refresh the list

**Update `src/components/crm/clients/BulkActionBar.tsx`**
- Add a "Change Status" button with a Popover or DropdownMenu containing all available statuses from `ALL_STATUSES`
- Statuses displayed with their colored badges for easy identification
- When a status is selected, calls the new bulk update handler

**Update `src/pages/crm/Clients.tsx`**
- Wire up the new bulk status change: pass selected client IDs and their current statuses to the handler
- Add state for the bulk status operation
- Clear selection after completion

---

## Feature 2: Sortable Table Columns

### How It Works
Each column header in the client table becomes clickable. Clicking a header sorts by that column; clicking again toggles between ascending and descending. A small arrow icon indicates the current sort direction.

### Implementation Details

**Update `src/components/crm/clients/ClientTable.tsx`**
- Add local state for `sortColumn` and `sortDirection` (asc/desc)
- Sortable columns: Name, Email, Phone, Status, State, Therapist, Last Updated
- Column headers get a click handler and a sort indicator icon (ChevronUp/ChevronDown from lucide-react)
- Sort the `clients` array in-memory before rendering based on current sort state
- Status sorting uses the `order` value from `STATUS_CONFIG` so statuses sort in their logical pipeline order, not alphabetically
- "Last Updated" defaults to descending (newest first) on initial click

---

## Technical Notes

- **No database changes** -- all sorting is client-side on the already-fetched data
- **No table schema changes** -- bulk status update uses the existing `clients.pat_status` column and `crm_activity_events` table
- Activity events are logged individually per client for proper audit trail
- The existing `useUpdateClientStatus` hook handles single updates; the new bulk hook handles multiple in parallel for speed

