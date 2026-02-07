
# Plan: Add "Active Campaign" Filter to Clients Page

## Overview
Add a dropdown filter to the Clients page that lets you filter clients by whether they're currently enrolled in an active campaign. Options: All (default), Yes, No.

---

## Files to Modify

### 1. `src/lib/crm/types.ts`

**Add new filter field to `ClientFilters` interface:**

```typescript
export interface ClientFilters {
  statuses: PatStatus[];
  states: string[];
  search: string;
  tags: string[];
  joinedDateFrom?: Date;
  joinedDateTo?: Date;
  activeCampaign?: 'all' | 'yes' | 'no';  // NEW
}
```

---

### 2. `src/pages/crm/Clients.tsx`

**Update initial filter state to include the new field:**

```typescript
const [filters, setFilters] = useState<ClientFiltersType>({
  statuses: [],
  states: [],
  search: '',
  tags: [],
  joinedDateFrom: undefined,
  joinedDateTo: undefined,
  activeCampaign: 'all',  // NEW - default to "All"
});
```

---

### 3. `src/components/crm/clients/ClientFilters.tsx`

**Add a Select dropdown for Active Campaign filter:**

- Import the `Select` components from `@/components/ui/select`
- Add a new filter section with label "Active Campaign"
- Use a dropdown with three options: All, Yes, No
- Update the `activeFilterCount` calculation to count this filter when it's not "all"
- Update `clearFilters` to reset this field to `'all'`

**UI placement:** Add this as the first filter (before Joined Date) since it's likely to be commonly used.

---

### 4. `src/hooks/crm/useClients.ts`

**Add filtering logic for active campaign enrollment:**

The approach: Query clients, then fetch active enrollments, and filter client-side based on the filter value.

```typescript
// After fetching clients, if activeCampaign filter is 'yes' or 'no':
if (filters?.activeCampaign && filters.activeCampaign !== 'all') {
  // Fetch client IDs that have active campaign enrollments
  const { data: activeEnrollments } = await supabase
    .from('crm_campaign_enrollments')
    .select('client_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active');
  
  const enrolledClientIds = new Set(activeEnrollments?.map(e => e.client_id) || []);
  
  // Filter the clients array
  if (filters.activeCampaign === 'yes') {
    // Keep only clients who are in an active campaign
    return clientsData.filter(client => enrolledClientIds.has(client.id));
  } else {
    // Keep only clients who are NOT in an active campaign
    return clientsData.filter(client => !enrolledClientIds.has(client.id));
  }
}
```

---

## Summary

| File | Change |
|------|--------|
| `src/lib/crm/types.ts` | Add `activeCampaign?: 'all' \| 'yes' \| 'no'` to `ClientFilters` interface |
| `src/pages/crm/Clients.tsx` | Add `activeCampaign: 'all'` to initial filter state |
| `src/components/crm/clients/ClientFilters.tsx` | Add Select dropdown for Active Campaign filter |
| `src/hooks/crm/useClients.ts` | Add logic to filter clients based on active campaign enrollments |

---

## Result
Users will see a new "Active Campaign" dropdown in the filters panel. By default it shows "All" clients. Selecting "Yes" shows only clients currently enrolled in an active campaign. Selecting "No" shows clients not enrolled in any active campaign.
