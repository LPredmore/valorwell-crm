
# Plan: Add "Joined Date" Filter and Scrollable Filters Menu

## Overview
Add a date range filter for "Joined Date" (using `clients.created_at`) to the Clients page filters, and make the entire filters popover content scrollable for better usability.

---

## What Will Change

### 1. Filter Type Updates
The `ClientFilters` interface will be extended to include optional date range fields:
- `joinedDateFrom` - Start date for filtering
- `joinedDateTo` - End date for filtering

### 2. Filter UI Updates
The ClientFilters component will get:
- A new "Joined Date" section with two date pickers (From and To)
- The entire filter content wrapped in a ScrollArea component with a max height
- Clear buttons for individual date selections

### 3. Query Updates
The useClients hook will apply the date range filter:
- If "From" date is set: filter where `created_at >= fromDate`
- If "To" date is set: filter where `created_at <= toDate`

---

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/crm/types.ts` | Add `joinedDateFrom?: Date` and `joinedDateTo?: Date` to ClientFilters interface |
| `src/components/crm/clients/ClientFilters.tsx` | Add date picker UI, wrap content in ScrollArea |
| `src/hooks/crm/useClients.ts` | Add date range filtering logic to the query |
| `src/pages/crm/Clients.tsx` | Update initial filter state to include undefined date values |
| `src/components/ui/calendar.tsx` | Add `pointer-events-auto` class for popover compatibility |

---

## Technical Details

### Type Changes (types.ts)
```typescript
export interface ClientFilters {
  statuses: PatStatus[];
  states: string[];
  search: string;
  tags: string[];
  joinedDateFrom?: Date;  // NEW
  joinedDateTo?: Date;    // NEW
}
```

### Date Filter UI Design
- Two inline date pickers using the existing Calendar and Popover components
- "From" and "To" labels with calendar icon buttons
- Each picker shows the selected date or "Any" as placeholder
- Individual clear (X) buttons when a date is selected

### Query Logic (useClients.ts)
```typescript
// Apply joined date range filter
if (filters?.joinedDateFrom) {
  query = query.gte('created_at', filters.joinedDateFrom.toISOString());
}
if (filters?.joinedDateTo) {
  // Add 1 day to include the entire "To" date
  const endOfDay = new Date(filters.joinedDateTo);
  endOfDay.setHours(23, 59, 59, 999);
  query = query.lte('created_at', endOfDay.toISOString());
}
```

### Scrollable Popover
- Wrap filter content in `<ScrollArea>` component
- Set `max-h-[70vh]` to limit height to 70% of viewport
- Ensures usability on smaller screens while keeping all filters accessible

### Active Filter Count
The badge count will include date filters:
- +1 if `joinedDateFrom` is set
- +1 if `joinedDateTo` is set
