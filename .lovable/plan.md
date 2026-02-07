

# Campaign System - Implementation Plan (Refined)

## Summary

A multi-step campaign system for automated email and SMS outreach with:
- Timezone-aware scheduling with configurable send windows
- Weekday-only option
- Basic personalization (first name, therapist name)
- Auto-pause when client responds via any channel
- One campaign per client enforcement
- Skip steps when contact info is missing

---

## Database Schema

### 4 New Tables (all prefixed with `crm_`)

#### `crm_campaigns`
Core campaign configuration.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| tenant_id | uuid | Multi-tenant isolation |
| name | text | Campaign name for display |
| description | text | Optional notes |
| is_active | boolean | Enable/disable campaign |
| weekdays_only | boolean | Skip Saturday/Sunday |
| send_window_start | time | Earliest send time (e.g., 09:00) |
| send_window_end | time | Latest send time (e.g., 17:00) |
| default_timezone | text | Fallback TZ (default: America/Chicago) |
| created_by_profile_id | uuid | Who created it |
| created_at, updated_at | timestamptz | Timestamps |

#### `crm_campaign_steps`
Individual messages in sequence.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| campaign_id | uuid | FK to crm_campaigns |
| tenant_id | uuid | Multi-tenant isolation |
| step_order | integer | Sequence (1, 2, 3...) |
| delay_days | integer | Days after previous step |
| delay_hours | integer | Additional hours |
| channel | text | 'email' or 'sms' |
| email_subject | text | For email steps |
| email_body_html | text | For email steps |
| sms_body_text | text | For SMS steps (160 char warning in UI) |
| is_active | boolean | Skip this step if disabled |
| created_at, updated_at | timestamptz | Timestamps |

#### `crm_campaign_enrollments`
Links clients to campaigns.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| campaign_id | uuid | FK to crm_campaigns |
| tenant_id | uuid | Multi-tenant isolation |
| client_id | uuid | FK to clients (unique per tenant) |
| current_step | integer | Which step they're on |
| status | text | active, paused, completed, cancelled, responded |
| enrolled_at | timestamptz | When added |
| enrolled_by_profile_id | uuid | Who added them |
| paused_at | timestamptz | When auto-paused |
| pause_reason | text | email_response, sms_response, manual |
| completed_at | timestamptz | When finished all steps |
| created_at, updated_at | timestamptz | Timestamps |

**Unique constraint**: (tenant_id, client_id) - enforces one campaign per client

#### `crm_campaign_step_logs`
Audit trail of all sends.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| enrollment_id | uuid | FK to enrollments |
| step_id | uuid | FK to steps |
| tenant_id | uuid | Multi-tenant isolation |
| client_id | uuid | For quick lookups |
| scheduled_for | timestamptz | When it should send |
| sent_at | timestamptz | When actually sent |
| status | text | scheduled, sent, failed, skipped |
| skip_reason | text | missing_email, missing_phone, etc. |
| error_message | text | If failed |
| channel | text | email or sms |
| helpscout_conversation_id | text | For email tracking |
| created_at | timestamptz | Timestamp |

---

## Edge Functions

### 1. `campaign-scheduler` (New)
Cron-triggered processor running every 15 minutes.

**Logic:**
1. Query step_logs where status='scheduled' and scheduled_for <= NOW()
2. For each pending message:
   - Verify enrollment is still 'active'
   - Check weekday rule (skip weekends if enabled)
   - Calculate client's local time using their timezone (or campaign default)
   - If within send window: send message with personalization
   - If outside window: reschedule to next valid window
   - If missing contact info: mark as 'skipped' with reason
3. After send: calculate next step's scheduled time and create new step_log
4. If no more steps: mark enrollment as 'completed'

**Personalization:**
```typescript
function personalizeContent(content: string, client: Client): string {
  const firstName = client.pat_name_preferred || client.pat_name_f || 'there';
  const therapistName = client.primary_staff?.prov_name_for_clients 
    || `${client.primary_staff?.prov_name_f} ${client.primary_staff?.prov_name_l}`.trim()
    || 'your therapist';
  
  return content
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{therapist_name\}\}/gi, therapistName);
}
```

**Rate limiting:**
Uses existing 2-second delay pattern from ringcentral-sms for SMS sends.

### 2. `helpscout-proxy` (Modify)
Add new `webhook` action for inbound email detection.

**Logic:**
1. Receive HelpScout webhook payload (customer reply event)
2. Extract customer email from payload
3. Look up client by email (case-insensitive)
4. Check for active campaign enrollment
5. If found: update status to 'responded', set paused_at and pause_reason

### 3. `ringcentral-sms` (Modify)
Add new `inbound` action for SMS response detection.

**Logic:**
1. Receive RingCentral webhook payload
2. Normalize incoming phone number to E.164
3. Look up client by phone
4. Check for active campaign enrollment
5. If found: update status to 'responded', set paused_at and pause_reason

---

## Cron Job Setup

```sql
SELECT cron.schedule(
  'campaign-scheduler-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/campaign-scheduler',
    headers := '{"Authorization": "Bearer [ANON_KEY]", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

---

## UI Components

### Campaign List Page (`/crm/campaigns`)
- Table: Name, Status (active/inactive), Steps count, Active enrollments count
- Actions: Create, Edit, Toggle active, Delete (with confirmation)
- Link in CRM sidebar

### Campaign Editor (`/crm/campaigns/new` and `/crm/campaigns/:id`)
```
+------------------------------------------+
| Campaign Name: [________________]        |
| Description:   [________________]        |
+------------------------------------------+
| SCHEDULE SETTINGS                        |
| [x] Weekdays only                        |
| Send window: [09:00] to [17:00]          |
| Default timezone: [America/Chicago  v]   |
+------------------------------------------+
| STEPS                                    |
| +--------------------------------------+ |
| | Step 1: Email                   [x]  | |
| | Delay: 0 days, 0 hours (immediate)   | |
| | Subject: [____________________]      | |
| | Body: [rich text editor]             | |
| +--------------------------------------+ |
| | Step 2: SMS                     [x]  | |
| | Delay: 2 days, 4 hours after Step 1  | |
| | Message: [____________] 45/160       | |
| +--------------------------------------+ |
| [ + Add Step ]                           |
+------------------------------------------+
| Variables: {{first_name}}, {{therapist_name}}
+------------------------------------------+
| [Cancel]                    [Save]       |
+------------------------------------------+
```

### Enrollment Management (`/crm/campaigns/:id/enrollments`)
- Table: Client name, Status, Current step, Enrolled date, Pause reason
- Filters: Status (all, active, paused, responded, completed)
- Actions: Remove from campaign, Resume (for paused), Manual advance

### Client Integration Points

**Quick Profile Sheet:**
- Show current campaign enrollment (if any)
- Quick action: "Remove from campaign"

**Clients Table - Bulk Actions:**
- "Enroll in Campaign" button when clients selected
- Opens campaign selector dialog

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/pages/crm/Campaigns.tsx` | Campaign list page |
| `src/pages/crm/CampaignEditor.tsx` | Create/edit campaign form |
| `src/pages/crm/CampaignEnrollments.tsx` | Manage enrollments for a campaign |
| `src/components/crm/campaigns/CampaignStepEditor.tsx` | Step form component |
| `src/components/crm/campaigns/EnrollmentTable.tsx` | Enrollments list |
| `src/components/crm/campaigns/EnrollInCampaignDialog.tsx` | Bulk enrollment modal |
| `src/hooks/crm/useCampaigns.ts` | CRUD hooks for campaigns |
| `src/hooks/crm/useCampaignSteps.ts` | Hooks for step management |
| `src/hooks/crm/useCampaignEnrollments.ts` | Enrollment hooks |
| `supabase/functions/campaign-scheduler/index.ts` | Cron processor |

## Files to Modify

| File | Change |
|------|--------|
| `src/components/crm/layout/CrmSidebar.tsx` | Add Campaigns nav link |
| `src/App.tsx` | Add campaign routes |
| `src/components/crm/clients/ClientQuickProfile.tsx` | Show campaign status |
| `src/components/crm/clients/BulkActionBar.tsx` | Add enroll action |
| `supabase/functions/helpscout-proxy/index.ts` | Add webhook action |
| `supabase/functions/ringcentral-sms/index.ts` | Add inbound action |
| `supabase/config.toml` | Add campaign-scheduler function |

---

## Implementation Phases

### Phase 1: Database Schema
Create all 4 tables with RLS policies requiring tenant membership.

### Phase 2: Campaign CRUD
- Campaign list page with create/edit/delete
- Step builder with drag-and-drop reorder
- Sidebar navigation

### Phase 3: Enrollment System
- Enrollment management page
- Bulk enroll from clients table
- Quick profile integration
- Unique constraint enforcement (one campaign per client)

### Phase 4: Campaign Execution Engine
- `campaign-scheduler` edge function
- Personalization logic
- Timezone-aware scheduling
- Rate-limited sending
- pg_cron setup

### Phase 5: Response Detection
- HelpScout webhook handler
- RingCentral inbound handler
- Auto-pause logic

---

## Manual Setup Required (Post-Implementation)

You will need to configure webhooks in external services:

1. **HelpScout**: Settings > Webhooks > Add webhook pointing to:
   `https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/helpscout-proxy?action=webhook`

2. **RingCentral**: Developer Portal > Webhooks > Subscribe to inbound SMS events pointing to:
   `https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/ringcentral-sms?action=inbound`

I'll provide detailed setup instructions when we reach Phase 5.

