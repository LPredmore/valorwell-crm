

# Side-Effect Analysis: Auto-Enroll Campaign Triggers

## Every Place a Client's `pat_status` Can Change

There are **6 sources** of status changes that would fire the new auto-enroll trigger:

| Source | Mechanism | Location |
|--------|-----------|----------|
| 1. CRM UI (single client) | `useUpdateClientStatus` | `src/hooks/crm/useUpdateClientStatus.ts` |
| 2. CRM UI (bulk) | `useBulkUpdateStatus` | `src/hooks/crm/useBulkUpdateStatus.ts` |
| 3. Campaign completion | `scheduleNextStep` in campaign-scheduler | `supabase/functions/campaign-scheduler/index.ts` (line 788) |
| 4. Appointment scheduled | DB trigger `transition_client_status_on_appointment()` | Changes Unscheduled → Scheduled |
| 5. Appointment documented | DB trigger `transition_early_to_established()` | Changes Scheduled → Early Sessions → Established |
| 6. At-risk cron | DB function `mark_at_risk_clients()` | Changes active statuses → At Risk |
| 7. Client Portal / external | Any direct `UPDATE clients SET pat_status = ...` | Various |

**All of these** fire the `AFTER UPDATE` trigger on `clients`, meaning all will trigger the new auto-enroll function.

## What Could Break or Cause Unexpected Behavior

### 1. Infinite Loop Risk (Campaign Completion → Status Change → New Campaign)
- Campaign completes → changes status to X → cancel trigger fires (no-op, enrollment already `completed`) → **enroll trigger fires** → enrolls in new campaign triggered by X
- **This is actually the desired behavior per your requirements**, but it means a chain reaction is possible: Campaign A completes → status X → Campaign B starts → Campaign B completes → status Y → Campaign C starts...
- **Risk**: If someone misconfigures two campaigns that point at each other's completion statuses, it creates an infinite enrollment loop (though each campaign has finite steps, so it would eventually terminate when the scheduler runs).

### 2. Appointment Triggers Causing Unexpected Enrollments
- `transition_client_status_on_appointment()` changes `Unscheduled → Scheduled` when an appointment is booked
- `transition_early_to_established()` changes `Scheduled → Early Sessions` and `Early Sessions → Established` when appointments are documented
- If someone sets up a trigger on "Scheduled" or "Early Sessions", **every client who books an appointment or has one documented** would auto-enroll in a campaign
- **Risk**: High volume of unintended enrollments from routine appointment operations

### 3. `mark_at_risk_clients()` Bulk Status Changes
- This function bulk-updates multiple clients to "At Risk"
- If a campaign trigger is set on "At Risk", every client flagged at-risk would auto-enroll simultaneously
- The DB trigger fires per-row so it should work, but could create a large burst of enrollments and scheduled step logs

### 4. The Cancel Trigger Marks as `responded`, Not `cancelled`
- `cancel_campaign_on_status_change()` sets enrollment status to `responded`
- The auto-enroll trigger checks `status = 'active'` — this is fine since `responded` ≠ `active`
- **No issue**, but worth noting: `responded` is used for both "client actually responded" and "system auto-cancelled due to status change"

### 5. Campaign Completion Status Change Timing
- In `campaign-scheduler` (line 764-771), enrollment is marked `completed` **before** the status update (line 788-791)
- The status update fires `cancel_campaign_on_status_change` → finds no `active` enrollment → no-op ✓
- Then `enroll_campaign_on_status_change` fires → checks for active enrollment → none → enrolls ✓
- **This ordering is correct and safe**

### 6. Bulk Status Updates Could Create Mass Enrollments
- `useBulkUpdateStatus` updates multiple clients to the same status
- Each row fires the trigger independently — could create dozens of enrollments at once
- The one-campaign-at-a-time check in the trigger prevents duplicates, but this is still a volume concern

### 7. `client_status_history` Table
- The existing `track_client_status_change()` trigger also fires on status change and writes to `client_status_history`
- **No conflict** — it runs independently and just logs

## UI Components Affected

- **CampaignEditor.tsx** — needs new trigger configuration section
- **Campaigns list page** — should show which campaigns have auto-triggers configured
- **ClientInfoCard.tsx** — status dropdown changes fire the trigger; users should be aware a campaign might auto-start
- **ClientKanban** — drag-and-drop status changes also fire this

## Files That Need Changes

| File | Change |
|------|--------|
| New migration | `crm_campaign_triggers` table + `enroll_campaign_on_status_change()` function + trigger |
| `src/lib/crm/campaign-types.ts` | Add trigger type to form data |
| `src/hooks/crm/useCampaigns.ts` | Load/save trigger data |
| `src/pages/crm/CampaignEditor.tsx` | Add trigger status selector UI |
| `campaign-scheduler/index.ts` | No changes needed (completion flow is already correct) |

## Recommendation

The biggest practical risk is **appointment-related triggers** silently enrolling clients. Consider adding a UI warning when selecting statuses like "Scheduled", "Early Sessions", or "Established" that says something like: "This status is set automatically by the system when appointments are booked/documented. Clients will be auto-enrolled without manual action."

