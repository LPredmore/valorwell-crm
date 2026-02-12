

# Duplicate Campaign Feature

## What It Does

Adds a "Duplicate" option to each campaign's action menu on the Campaigns list page. Clicking it copies the campaign settings and all its steps into a new campaign named "Copy of [original name]", set to paused (is_active = false). You're then navigated to the editor to customize it.

## How It Works

### 1. New hook: `useDuplicateCampaign` in `src/hooks/crm/useCampaigns.ts`

A new mutation that:
- Reads the source campaign's settings from the existing query cache (already loaded on the list page)
- Inserts a new `crm_campaigns` row with identical settings except: name becomes `"Copy of [name]"`, `is_active` set to `false`
- Fetches all steps from `crm_campaign_steps` for the source campaign
- Inserts copies of every step (same channel, delays, subject, body, order) under the new campaign ID, with no `id` field so Postgres generates fresh UUIDs
- Returns the new campaign's ID
- On success, invalidates the campaigns query cache and navigates to the editor

No enrollments or step logs are copied -- the duplicate is a clean template.

### 2. UI change: `src/pages/crm/Campaigns.tsx`

Add a "Duplicate" menu item in the existing `DropdownMenu` for each campaign row, between "View Enrollments" and the Pause/Activate toggle. Uses the `Copy` icon from lucide-react. On click, calls the new mutation and navigates to `"/crm/campaigns/{newId}"` on success.

## Technical Decisions

- **Client-side orchestration, not a database function**: The operation is two simple inserts (one campaign row + a handful of step rows). There's no concurrency concern or atomicity requirement beyond what already exists. A database function would add maintenance overhead for no benefit. The existing `useSaveCampaignSteps` pattern already does multi-row step inserts from the client.

- **Starts paused**: A duplicate should never auto-send messages to anyone. Setting `is_active = false` is a safety default. You activate it deliberately after reviewing the steps.

- **Navigate to editor after duplication**: Rather than staying on the list page and making you find the new campaign, it takes you straight to editing. This matches the stated workflow: "duplicate, then edit the steps."

## Files Changed

- `src/hooks/crm/useCampaigns.ts` -- add `useDuplicateCampaign` mutation
- `src/pages/crm/Campaigns.tsx` -- add "Duplicate" dropdown menu item wired to the new hook

No database changes. No new tables or columns.
