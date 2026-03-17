

# Plan: Default Table View + Communication Received Filter

## Two changes

### 1. Default view → Table (trivial)

Change the initial state in `Clients.tsx` from `'kanban'` to `'table'`.

### 2. "Communication Received" standalone filter

A new dropdown next to the existing Filters button on the Clients toolbar. Options: "1 day", "2 days", ... "7 days", and a clear/reset option.

**Data source decision: `crm_activity_events` table**

The `crm_activity_events` table already records `email_received` and `sms_received` events with `client_id` and `created_at`. This is the correct source because:

- It captures both channels (SMS and email) in one place
- It has 405 records already (404 email + 1 SMS received events)
- It's indexed by `tenant_id` and `client_id`
- Using it avoids querying HelpScout's external API or joining multiple tables
- It matches the existing activity architecture — every inbound message already creates an event here

Using `crm_inbound_sms_logs` alone would miss emails. Using HelpScout API would be slow and external. The activity events table is the unified audit log and the right choice.

**How the filter works:**

When the user selects e.g. "3 days", the `useClients` hook runs a subquery against `crm_activity_events` to get the set of `client_id`s that have at least one `email_received` or `sms_received` event in the last 3 days, then filters the client list to only those IDs. This is the same pattern already used for the `activeCampaign` filter (client-side set intersection after the main query).

### Implementation details

**Files to change:**

1. **`src/lib/crm/types.ts`** — Add `communicationReceivedDays?: number` to `ClientFilters`

2. **`src/hooks/crm/useClients.ts`** — Add a post-query filter block (same pattern as `activeCampaign`): when `communicationReceivedDays` is set, query `crm_activity_events` for `event_type IN ('email_received', 'sms_received')` with `created_at >= now - N days`, collect the `client_id` set, and intersect

3. **`src/pages/crm/Clients.tsx`** — Add `communicationReceivedDays: undefined` to initial filter state; change default view to `'table'`; render the new `CommunicationReceivedFilter` component in the toolbar next to `ClientFilters`

4. **`src/components/crm/clients/CommunicationReceivedFilter.tsx`** (new file) — A `Select` dropdown with a mail-receive icon, options 1–7 days, and a clear button. Styled consistently with the existing `ClientFilters` button (outline variant, `size="sm"`, badge for active state)

No database changes needed — the data already exists in `crm_activity_events`.

