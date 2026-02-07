

# Plan: End of Campaign Action - Automatic Status Change

## Overview

Add the ability for campaigns to automatically change a client's status upon completion. This feature integrates with the existing campaign scheduler edge function and requires schema changes, UI updates, and backend logic modifications.

---

## Technical Decision: Store Configuration on the Campaign, Execute in Edge Function

**Why this approach is correct:**

1. **Single source of truth**: The campaign table already stores all campaign behavior configuration (send windows, weekdays_only, timezone). Adding completion behavior here follows the established pattern.

2. **Edge function is the right execution point**: The `campaign-scheduler` edge function already handles the completion transition (lines 702-713). This is the natural place to apply side effects - it runs with service role permissions and already has access to all required data.

3. **Activity logging for auditability**: The system already logs `status_change` events in `crm_activity_events`. We'll use this same pattern but with metadata indicating the change was triggered by campaign completion - this maintains a clear audit trail.

4. **No new tables or complexity**: This is a simple additive change - two columns on an existing CRM table, matching the project constraint that CRM changes must be additive only.

---

## Database Changes

Add two columns to `crm_campaigns`:

```sql
ALTER TABLE crm_campaigns 
ADD COLUMN on_complete_action TEXT NOT NULL DEFAULT 'do_nothing';

ALTER TABLE crm_campaigns 
ADD COLUMN on_complete_status TEXT DEFAULT NULL;

-- Add constraint to validate action values
ALTER TABLE crm_campaigns 
ADD CONSTRAINT crm_campaigns_on_complete_action_check 
CHECK (on_complete_action IN ('do_nothing', 'change_status'));
```

**Design notes:**
- `on_complete_action` defaults to `'do_nothing'` for backward compatibility with existing campaigns
- `on_complete_status` is nullable - only used when action is `'change_status'`
- No foreign key to a statuses table because `pat_status` is stored as TEXT in the clients table (it's an application-level enum, not a database enum)

---

## Files to Modify

### 1. `src/lib/crm/campaign-types.ts`

Add types and constants for the completion action:

```typescript
// Add to CrmCampaign interface
export interface CrmCampaign {
  // ... existing fields ...
  on_complete_action: 'do_nothing' | 'change_status';
  on_complete_status: string | null;
}

// Add to CampaignFormData interface
export interface CampaignFormData {
  // ... existing fields ...
  on_complete_action: 'do_nothing' | 'change_status';
  on_complete_status: string | null;
}

// Add constant for dropdown options
export const COMPLETION_ACTION_OPTIONS = [
  { value: 'do_nothing', label: 'Do Nothing' },
  { value: 'change_status', label: 'Change Client Status' },
] as const;
```

### 2. `src/pages/crm/CampaignEditor.tsx`

Add a "Completion Settings" card in the left column (after Schedule Settings):

**State changes:**
- Initialize `on_complete_action: 'do_nothing'` and `on_complete_status: null` in `formData`
- Load existing values from campaign when editing

**UI additions:**
- New Card with title "Completion Settings"
- Select dropdown for action type (Do Nothing / Change Client Status)
- Conditional: When "Change Client Status" is selected, show a second dropdown with all PatStatus values from `ALL_STATUSES`
- Helper text explaining when the action triggers

### 3. `src/hooks/crm/useCampaigns.ts`

Update mutations to include new fields:

**`useCreateCampaign`:**
```typescript
.insert({
  // ... existing fields ...
  on_complete_action: formData.on_complete_action,
  on_complete_status: formData.on_complete_status,
})
```

**`useUpdateCampaign`:**
```typescript
.update({
  // ... existing fields ...
  on_complete_action: formData.on_complete_action,
  on_complete_status: formData.on_complete_status,
})
```

### 4. `supabase/functions/campaign-scheduler/index.ts`

Modify the `scheduleNextStep` function to apply status changes on completion:

**Update Campaign interface (line 57-65):**
```typescript
interface Campaign {
  id: string;
  name: string;
  is_active: boolean;
  weekdays_only: boolean;
  send_window_start: string;
  send_window_end: string;
  default_timezone: string;
  on_complete_action: string | null;
  on_complete_status: string | null;
}
```

**Modify completion logic (after line 712):**
```typescript
if (!nextStep) {
  // No more steps - mark enrollment as completed
  console.log(`Enrollment ${enrollment.id} completed all steps`);
  await supabase
    .from('crm_campaign_enrollments')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      current_step: currentStep.step_order,
    })
    .eq('id', enrollment.id);

  // Apply completion action if configured
  if (campaign.on_complete_action === 'change_status' && campaign.on_complete_status) {
    // Get current client status for activity log
    const { data: clientData } = await supabase
      .from('clients')
      .select('pat_status')
      .eq('id', enrollment.client_id)
      .single();

    const oldStatus = clientData?.pat_status || null;
    const newStatus = campaign.on_complete_status;

    // Only update if status is actually different
    if (oldStatus !== newStatus) {
      // Update client status
      const { error: updateError } = await supabase
        .from('clients')
        .update({ pat_status: newStatus })
        .eq('id', enrollment.client_id);

      if (updateError) {
        console.error(`Failed to update client status on campaign completion:`, updateError);
      } else {
        // Log activity event for audit trail
        await supabase
          .from('crm_activity_events')
          .insert({
            tenant_id: tenantId,
            client_id: enrollment.client_id,
            event_type: 'status_change',
            old_value: oldStatus,
            new_value: newStatus,
            created_by_profile_id: null, // System-triggered, no user
            metadata: {
              triggered_by: 'campaign_completion',
              campaign_id: campaign.id,
              campaign_name: campaign.name,
            },
          });

        console.log(`Changed client ${enrollment.client_id} status from "${oldStatus}" to "${newStatus}" on campaign "${campaign.name}" completion`);
      }
    }
  }

  return;
}
```

**Also update the campaign query in `processCampaignMessages` (line 428-431):**
Add `on_complete_action, on_complete_status` to the select query for campaigns.

---

## UI Wireframe

The Campaign Editor will have a new card in the left column:

```
+-------------------------------------------+
| Completion Settings                       |
| What happens when a client finishes       |
| all campaign steps                        |
+-------------------------------------------+
| When campaign completes:                  |
| [v] Do Nothing                            |
|     -------------------------             |
|     | Do Nothing            |             |
|     | Change Client Status  |             |
|     -------------------------             |
|                                           |
| (If "Change Client Status" selected:)     |
|                                           |
| Set status to:                            |
| [v] Unresponsive - Cold                   |
|     -------------------------             |
|     | Interested            |             |
|     | New                   |             |
|     | Matching              |             |
|     | ... (all statuses)    |             |
|     -------------------------             |
+-------------------------------------------+
```

---

## Data Flow

```text
1. User creates/edits campaign in CampaignEditor
2. Selects "Change Client Status" and picks target status
3. Campaign saved with on_complete_action + on_complete_status

4. Client enrolls in campaign
5. Campaign scheduler processes steps over time
6. Final step completes -> scheduleNextStep() called
7. No next step found -> enrollment marked "completed"
8. If on_complete_action === 'change_status':
   a. Fetch client's current status
   b. Update clients.pat_status
   c. Insert crm_activity_events record with campaign metadata
9. Activity shows in client's timeline as system-triggered status change
```

---

## Summary

| Component | Change |
|-----------|--------|
| Database | Add `on_complete_action` and `on_complete_status` columns to `crm_campaigns` |
| `campaign-types.ts` | Add fields to interfaces + `COMPLETION_ACTION_OPTIONS` constant |
| `CampaignEditor.tsx` | Add "Completion Settings" card with dropdowns |
| `useCampaigns.ts` | Include new fields in create/update mutations |
| `campaign-scheduler` | Apply status change + log activity when campaign completes |

---

## Why This Is The Right Approach

1. **Follows existing patterns**: Status changes already log to `crm_activity_events` with old/new values. Campaign settings already live on the campaign table. Edge function already handles completion.

2. **Additive-only database change**: Two new columns on a CRM table. No modification to shared production tables.

3. **Auditable**: The activity log captures the trigger source (`campaign_completion`) so it's clear this wasn't a manual change. The campaign ID and name are preserved in metadata.

4. **Backward compatible**: Defaults to `'do_nothing'`, so existing campaigns continue to work unchanged.

5. **Fail-safe**: If the status update fails, the enrollment still completes successfully - we log the error but don't break the flow.

