
# Plan: Fix Campaign UI Refresh and Scheduler Tenant ID Bug

## Summary
This plan addresses three issues:
1. **UI Refresh Problem**: Campaigns sometimes don't appear without a manual refresh
2. **Cron Job Not Scheduled**: The 15-minute automated scheduler isn't running
3. **Next Step FK Error**: The scheduler uses wrong tenant_id when creating follow-up step logs

---

## Phase 1: Fix Scheduler Tenant ID Bug (Critical)

The campaign-scheduler Edge Function has a bug on line 747 where it uses `campaign_id` instead of `tenant_id` when inserting the next step log.

**File**: `supabase/functions/campaign-scheduler/index.ts`

**Changes**:
- Update the `scheduleNextStep` function to accept and use the correct `tenant_id`
- Pass `stepLog.tenant_id` to the function (available from the original step log record)
- Ensure the next step log insert uses the proper tenant_id value

---

## Phase 2: Improve UI Data Fetching Reliability

The campaigns list sometimes doesn't show data due to race conditions between auth loading and query execution.

**File**: `src/pages/crm/Campaigns.tsx`

**Changes**:
- Add a `refetch` function from the useCampaigns hook
- Implement `refetchOnWindowFocus: true` or explicit refetch on component mount
- Add loading state handling for when auth is still loading

**File**: `src/hooks/crm/useCampaigns.ts`

**Changes**:
- Add `refetchOnWindowFocus: true` to the query options
- Ensure staleTime is reasonable (e.g., 30 seconds)
- Consider adding `refetchOnMount: 'always'` for critical campaign data

---

## Phase 3: Cron Job Setup (Manual Step Required)

**You must run the following SQL in your Supabase SQL Editor** to enable automatic campaign scheduling every 15 minutes:

```sql
SELECT cron.schedule(
  'campaign-scheduler-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/campaign-scheduler',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFocWF1b21rZ2Zsb3B4Z25sbmRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwMTA2NjcsImV4cCI6MjA3OTU4NjY2N30.WGZoTjcJMSDxG5ss1Oe4T0bSBzhsiijfj-I3DnviWGU", "Content-Type": "application/json"}'::jsonb,
    body := '{"source": "cron"}'::jsonb
  ) AS request_id;
  $$
);
```

---

## Technical Details

### Scheduler Fix (Phase 1)

The current buggy code:
```typescript
// Line 747 - WRONG
tenant_id: campaign.id ? enrollment.campaign_id : enrollment.campaign_id
```

Will be fixed to:
```typescript
// Use the tenant_id from the original step log
tenant_id: tenantId  // Passed as parameter to scheduleNextStep
```

The function signature will change from:
```typescript
async function scheduleNextStep(
  supabase: ...,
  enrollment: CampaignEnrollment,
  currentStep: CampaignStep,
  campaign: Campaign
)
```

To:
```typescript
async function scheduleNextStep(
  supabase: ...,
  enrollment: CampaignEnrollment,
  currentStep: CampaignStep,
  campaign: Campaign,
  tenantId: string  // Added parameter
)
```

### UI Fix (Phase 2)

Add query options to ensure reliable data fetching:
```typescript
return useQuery({
  queryKey: ['crm-campaigns', tenantId],
  queryFn: async (): Promise<CrmCampaign[]> => { ... },
  enabled: !!tenantId,
  refetchOnWindowFocus: true,
  staleTime: 30000, // 30 seconds
});
```

---

## Verification

After implementation:
1. Navigate away from and back to the Campaigns page to verify consistent data loading
2. Manually trigger the campaign-scheduler to confirm next steps are created correctly
3. Verify the cron job is scheduled by querying `SELECT * FROM cron.job WHERE jobname LIKE '%campaign%'`

---

## Files Modified

| File | Changes |
|------|---------|
| `supabase/functions/campaign-scheduler/index.ts` | Fix tenant_id bug in scheduleNextStep |
| `src/hooks/crm/useCampaigns.ts` | Add refetchOnWindowFocus and staleTime |
