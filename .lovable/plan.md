

# Plan: Auto-Cancel Campaign on Client Status Change

## The Decision: Database Trigger (Not Frontend, Not Edge Function)

The right solution is a **PostgreSQL trigger on the `clients` table** that fires whenever `pat_status` changes and automatically cancels any active campaign enrollment for that client.

Here's why this is the only correct approach:

**Why not frontend hooks (useUpdateClientStatus, useBulkUpdateStatus)?**
Status changes happen from the Client Portal, from the appointment trigger (`transition_client_status_on_appointment`), and potentially from other apps sharing this database. The CRM frontend isn't running during those events. A frontend-only solution would miss the majority of status changes.

**Why not an Edge Function on a schedule?**
The campaign-scheduler already runs every 15 minutes. Adding a "check for status changes" sweep would mean up to 15 minutes of delay where a client who already re-engaged could still receive an outreach message. That defeats the purpose.

**Why a database trigger?**
It fires instantly, on every `UPDATE` to `clients` where `pat_status` changes, regardless of what caused the change -- CRM UI, Client Portal, appointment trigger, direct SQL, any other connected app. Zero delay. Zero gaps. It respects the architecture constraint that this database serves multiple applications.

---

## What the Trigger Does

When `pat_status` changes on a client row:

1. Find any `crm_campaign_enrollments` row where `client_id` matches and `status = 'active'`
2. Set that enrollment's `status` to `'responded'` and `completed_at` to `NOW()`
3. Mark any pending `crm_campaign_step_logs` (status = `'scheduled'`) for that enrollment as `'skipped'` with reason `'client_status_changed'`
4. Insert an audit entry into `crm_activity_events` recording that a campaign was auto-cancelled due to the status change

The existing campaign-scheduler already checks `enrollment.status !== 'active'` before sending (line 450 of campaign-scheduler/index.ts), so even if the scheduler runs between the trigger firing and the step log cleanup, it will skip the enrollment.

Using `'responded'` as the enrollment status (rather than `'cancelled'`) is intentional -- it distinguishes "the client took action and we stopped" from "an admin manually cancelled the campaign." This is already defined in the `EnrollmentStatus` type.

---

## What Changes

### 1. New Database Migration

A single migration that creates:

- **Function**: `cancel_campaign_on_status_change()` -- the trigger function
- **Trigger**: `trg_cancel_campaign_on_status_change` on `clients`, firing `AFTER UPDATE` when `OLD.pat_status IS DISTINCT FROM NEW.pat_status`

The function uses `SECURITY DEFINER` with `search_path = 'public'` (matching existing patterns like `transition_client_status_on_appointment`) so it has the permissions to update CRM tables regardless of which role triggered the status change.

```text
Technical detail -- the trigger function logic:

1. IF OLD.pat_status IS NOT DISTINCT FROM NEW.pat_status THEN RETURN  (no-op if status didn't change)
2. SELECT id, tenant_id, campaign_id INTO enrollment FROM crm_campaign_enrollments
   WHERE client_id = NEW.id AND status = 'active' LIMIT 1
3. If no active enrollment found, RETURN (nothing to do)
4. UPDATE crm_campaign_enrollments SET status = 'responded', completed_at = NOW()
   WHERE id = enrollment.id
5. UPDATE crm_campaign_step_logs SET status = 'skipped', skip_reason = 'client_status_changed'
   WHERE enrollment_id = enrollment.id AND status = 'scheduled'
6. INSERT INTO crm_activity_events (tenant_id, client_id, event_type, metadata)
   with triggered_by = 'status_change_campaign_cancel', old_status, new_status, campaign_id
```

### 2. No Frontend Code Changes Required

The campaign-scheduler already respects enrollment status. The CRM UI already queries enrollment status for display. No hooks, no components, no edge functions need to change. The trigger handles everything at the data layer where it belongs.

### 3. No Table Schema Changes

No columns added, no tables modified. This only adds a function and a trigger -- fully additive, which respects the constraint that tables are shared across apps.

---

## Edge Cases Handled

| Scenario | What Happens |
|----------|-------------|
| Client Portal changes status | Trigger fires, enrollment cancelled instantly |
| CRM admin changes status manually | Trigger fires, enrollment cancelled instantly |
| Bulk status change from CRM | Trigger fires once per client row updated |
| Appointment trigger changes status | That trigger runs first (updates status), then this trigger fires on the resulting change |
| Campaign completion changes status | Campaign-scheduler sets enrollment to 'completed' first, then updates client status. Trigger fires but finds no 'active' enrollment -- no-op |
| Status changed to same value | `IS DISTINCT FROM` check prevents trigger from firing |
| Client has no active enrollment | Trigger fires but finds nothing to cancel -- no-op |

---

## Why This Matters for Your Use Case

You described wanting to send re-engagement campaigns that feel personalized. If a client logs in through the portal and their status changes from "Unresponsive" to "Active," the trigger immediately stops the campaign. They won't get a "Hey, we miss you!" email 15 minutes after they just booked an appointment. The system reacts in milliseconds, not minutes.

