

# Add/Remove Tags from Client Profile and Bulk Table View

## Overview

Add the ability to manage tags on individual client profiles and in bulk from the table view. Since the `clients.tags` column is a single TEXT field (not an array), each client can have one tag value. The UI will reflect this: selecting a tag replaces the current one, and "remove" clears it.

## Part 1: Tags on Client Profile Page

### ClientInfoCard changes

Add a "Tag" section to `ClientInfoCard` (below the status selector). It will show the client's current tag (if any) with an X button to remove it, plus a combo-box style selector to pick or type a new tag.

**How it works:**
- Fetch available tags using the existing `useTagOptions` hook
- Display current tag as a `Badge` with an X button to clear it
- A `Popover` with a `Command` (cmdk) input lets the user search existing tags or type a new one
- Selecting a tag calls `supabase.from('clients').update({ tags: newTag }).eq('id', client.id)`
- Removing calls the same update with `tags: null`
- After mutation, invalidate `crm-clients` and `crm-client` queries, plus `crm-tag-options` so new tags appear in filters

**Requires adding `tags` to the CrmClient type and the client detail query:**
- Add `tags: string | null` to the `CrmClient` interface in `src/lib/crm/types.ts`
- Add `tags` to the select in `ClientDetail.tsx` query
- Add `tags` to the select in `useClients.ts` query

### New hook: `useUpdateClientTag`

A small mutation hook in `src/hooks/crm/useUpdateClientTag.ts` that:
- Takes `{ clientId, tag: string | null }`
- Updates the `clients.tags` column
- Invalidates relevant queries
- Shows a toast on success/failure

## Part 2: Bulk Tag Management from Table View

### BulkActionBar changes

Add a "Set Tag" dropdown button to the bulk action bar (similar to "Change Status"). It will:
- Use a `DropdownMenu` with existing tag options listed, plus a "Remove Tag" option
- Selecting a tag calls a new `useBulkUpdateTag` hook

### New hook: `useBulkUpdateTag`

In `src/hooks/crm/useBulkUpdateTag.ts`, following the same pattern as `useBulkUpdateStatus`:
- Takes `{ clientIds: string[], tag: string | null }`
- Updates each client's `tags` column
- Invalidates queries and shows a toast with success/fail counts

### Clients page wiring

Add state and handler in `Clients.tsx` to:
- Pass `onSetTag` callback to `BulkActionBar`
- Call `useBulkUpdateTag` with selected client IDs
- Clear selection on success

## Files Changed

- **`src/lib/crm/types.ts`** -- Add `tags: string | null` to `CrmClient`
- **`src/pages/crm/ClientDetail.tsx`** -- Add `tags` to the client query select
- **`src/hooks/crm/useClients.ts`** -- Add `tags` to the clients query select
- **`src/hooks/crm/useUpdateClientTag.ts`** (new) -- Single-client tag mutation
- **`src/hooks/crm/useBulkUpdateTag.ts`** (new) -- Bulk tag mutation
- **`src/components/crm/detail/ClientInfoCard.tsx`** -- Add tag display/selector section
- **`src/components/crm/clients/BulkActionBar.tsx`** -- Add "Set Tag" dropdown button
- **`src/pages/crm/Clients.tsx`** -- Wire bulk tag handler

## What Does NOT Change

- No database columns modified (uses existing `clients.tags` TEXT column)
- No new tables or migrations
- Existing tag filtering in `useClients` and `ClientFilters` continues to work unchanged
- `useTagOptions` continues to work unchanged (new tags typed by users will automatically appear in filters)

