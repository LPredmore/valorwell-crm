

# RingCentral SMS Bulk Messaging - Complete Implementation Plan

## Overview

This plan implements SMS bulk messaging capability for the CRM using RingCentral's API, enabling staff and client outreach via text messages. The design exactly mirrors the established HelpScout bulk email architecture to ensure consistency, maintainability, and minimal cognitive overhead.

## Technical Decision: Parallel SMS Tables (Not Modifying Existing)

**The Definitive Choice**: Create separate `crm_bulk_sms_*` tables rather than adding a `channel` column to existing email tables.

**Why This Is Correct**:

1. **Database Constraint Compliance**: Your architecture mandate states changes must be "strictly additive only." Adding a `channel` column to `crm_bulk_send_logs` would violate this - it modifies an existing table. Creating new tables is purely additive.

2. **Multi-App Architecture Safety**: Multiple applications use this Supabase instance. Modifying `crm_bulk_send_logs` could break queries in other apps that don't expect the new column. Separate tables guarantee zero impact on existing integrations.

3. **Independent Channel Evolution**: Email and SMS have different characteristics:
   - Email has `subject` + `body_html`; SMS has only `body_text` (plain text, no HTML)
   - Email rate limits differ from SMS (150ms vs 2000ms)
   - Future SMS features (delivery receipts, MMS) won't pollute email logic

4. **Query Simplicity**: Separate tables mean simple, fast queries without WHERE clauses filtering by channel. Reporting stays clean.

## Critical Rate Limiting Implementation

Based on your RingCentral documentation showing **40 requests per 60 seconds**:

- **Delay between messages**: 2000ms (2 seconds) per your request
- **Result**: Maximum 30 messages per minute - well within the 40/min limit
- **Penalty for 429 errors**: 30-second cooldown before retry
- **For 1000 messages**: ~33 minutes total processing time

The edge function processes in the background after the initial request returns, so the UI remains responsive.

---

## Database Design

### Table 1: crm_bulk_sms_logs

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid | NO | Primary key, default gen_random_uuid() |
| tenant_id | uuid | NO | FK to tenants |
| created_by_profile_id | uuid | NO | FK to profiles |
| body_text | text | NO | SMS message content (plain text only) |
| recipient_count | integer | NO | Default 0 |
| sent_count | integer | NO | Default 0 |
| failed_count | integer | NO | Default 0 |
| status | text | NO | Default 'pending' (pending/sending/completed/failed) |
| recipient_type | text | NO | Default 'client' (client/staff) |
| created_at | timestamptz | NO | Default now() |
| completed_at | timestamptz | YES | Set when processing finishes |

### Table 2: crm_bulk_sms_recipients (for clients)

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid | NO | Primary key, default gen_random_uuid() |
| bulk_sms_id | uuid | NO | FK to crm_bulk_sms_logs |
| tenant_id | uuid | NO | FK to tenants |
| client_id | uuid | NO | FK to clients |
| status | text | NO | Default 'pending' |
| error_message | text | YES | Error details if failed |
| sent_at | timestamptz | YES | When message was sent |

### Table 3: crm_bulk_sms_staff_recipients (for staff)

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid | NO | Primary key, default gen_random_uuid() |
| bulk_sms_id | uuid | NO | FK to crm_bulk_sms_logs |
| tenant_id | uuid | NO | FK to tenants |
| staff_id | uuid | NO | FK to staff |
| status | text | NO | Default 'pending' |
| error_message | text | YES | Error details if failed |
| sent_at | timestamptz | YES | When message was sent |
| created_at | timestamptz | YES | Default now() |

### RLS Policies (Matching Email Pattern)

Each table gets three policies:
1. **SELECT**: Tenant members can view records where tenant_id matches their tenant
2. **INSERT**: Authenticated users can insert records for their tenant
3. **UPDATE**: Tenant members can update records in their tenant

---

## Edge Function: ringcentral-sms

### Processing Flow

```text
1. Receive bulkSmsId parameter
2. Exchange JWT for RingCentral access token
3. Update log status to 'sending'
4. Fetch pending recipients based on recipient_type
5. For each recipient:
   a. Skip if no phone number → mark 'failed' with "No phone number"
   b. Normalize phone to E.164 format (+1XXXXXXXXXX)
   c. If invalid format → mark 'failed' with "Invalid phone format"
   d. Send SMS via RingCentral API
   e. On 429 rate limit → wait 30 seconds, retry once
   f. Update recipient status to 'sent' or 'failed'
   g. Wait 2000ms before next request
6. Update final counts and status on log record
```

### Phone Number Normalization Logic

The database stores phone numbers in various formats. The edge function normalizes:

```text
Input formats accepted:
- "3528901843" → "+13528901843"
- "(352) 890-1843" → "+13528901843"
- "352-890-1843" → "+13528901843"
- "+13528901843" → "+13528901843" (already valid)
- "1-352-890-1843" → "+13528901843"

Validation rules:
1. Strip all non-numeric characters
2. If starts with "1" and has 11 digits, remove leading "1"
3. Must have exactly 10 digits
4. Prepend "+1" for E.164 format
5. Mark as failed if validation fails
```

### RingCentral Authentication Flow

```text
POST https://platform.ringcentral.com/restapi/oauth/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)

Body:
grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
assertion=JWT_TOKEN

Response:
{
  "access_token": "short-lived-token",
  "token_type": "bearer",
  "expires_in": 3600
}
```

### SMS API Call

```text
POST https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~/sms
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "from": { "phoneNumber": "+13074141355" },
  "to": [{ "phoneNumber": "+1XXXXXXXXXX" }],
  "text": "Message content"
}
```

---

## Frontend Architecture

### New Files

| File | Purpose |
|------|---------|
| supabase/functions/ringcentral-sms/index.ts | Edge function for SMS processing |
| src/hooks/crm/useBulkSms.ts | Hook to create bulk SMS job and trigger edge function |
| src/hooks/crm/useBulkSmsStatus.ts | Hook to poll SMS job status (2-second interval) |
| src/lib/crm/ringcentral-api.ts | Helper function to call ringcentral-sms edge function |
| src/components/crm/bulk/SmsComposeDialog.tsx | SMS composition modal (text input + character counter) |
| src/components/crm/bulk/SmsProgressModal.tsx | SMS progress tracking modal |

### Modified Files

| File | Changes |
|------|---------|
| supabase/config.toml | Add ringcentral-sms function entry with verify_jwt=false |
| src/components/crm/clients/BulkActionBar.tsx | Add `onSendSms` prop and "Send Text" button |
| src/pages/crm/Staff.tsx | Add SMS dialog state, progress modal, wire useBulkSms hook |
| src/pages/crm/Clients.tsx | Same changes as Staff.tsx |
| src/hooks/crm/useStaff.ts | Add `prov_phone` to SELECT query |
| src/lib/crm/staff-types.ts | Add `prov_phone: string \| null` to CrmStaff interface |

### Data Already Available

- **Clients**: `phone` column already fetched in `useClients.ts` (line 28)
- **Staff**: `prov_phone` column exists in database but not fetched - will add to `useStaff.ts`

---

## Component Details

### SmsComposeDialog.tsx

Similar to BulkComposeDialog but for SMS:
- No subject field (SMS doesn't have subjects)
- Single textarea for message body
- Character counter showing current length
- Visual indicator at 160 characters (SMS segment boundary)
- Warning text if over 160 chars: "Message will be split into multiple segments"
- Recipient count display

### SmsProgressModal.tsx

Identical structure to BulkProgressModal:
- Shows pending/sending/completed/failed states
- Progress bar based on (sent + failed) / total
- Sent count with green checkmark
- Failed count with red X (if any)
- Different icons (MessageSquare instead of Mail)
- Different text ("Sending Texts..." instead of "Sending Emails...")

### BulkActionBar Changes

Add new button alongside existing "Send Email":

```text
Current:
[Send Email] [Clear]

After:
[Send Email] [Send Text] [Clear]
```

Props added:
- `onSendSms?: () => void`

---

## Implementation Sequence

### Phase 1: Database & Edge Function
1. Create database migration with 3 tables and RLS policies
2. Create `ringcentral-sms` edge function with full JWT auth flow
3. Update `supabase/config.toml` with function entry
4. Deploy edge function
5. Test edge function directly with curl

### Phase 2: Data Layer
6. Create `src/lib/crm/ringcentral-api.ts` helper
7. Create `src/hooks/crm/useBulkSms.ts` hook
8. Create `src/hooks/crm/useBulkSmsStatus.ts` hook
9. Update `src/hooks/crm/useStaff.ts` to include `prov_phone`
10. Update `src/lib/crm/staff-types.ts` with phone field

### Phase 3: UI Components
11. Create `SmsComposeDialog.tsx`
12. Create `SmsProgressModal.tsx`
13. Update `BulkActionBar.tsx` with Send Text button
14. Update `Staff.tsx` with SMS integration
15. Update `Clients.tsx` with SMS integration

### Phase 4: Testing & Verification
16. Test end-to-end with 1-2 staff members
17. Verify SMS delivery on recipient phone
18. Check edge function logs for errors
19. Test with clients
20. Test error handling (missing/invalid phone numbers)

---

## Error Handling Matrix

| Scenario | Behavior |
|----------|----------|
| No phone number | Mark recipient 'failed', error: "No phone number" |
| Invalid phone format | Mark recipient 'failed', error: "Invalid phone format" |
| RingCentral 429 | Wait 30s, retry once, then mark 'failed' if still 429 |
| RingCentral 401 | Log error, mark 'failed', error: "Authentication failed" |
| RingCentral 5xx | Mark 'failed', error: "RingCentral service error" |
| Network timeout | Mark 'failed', error: "Request timeout" |
| All recipients fail | Set log status to 'failed' |
| Partial success | Set log status to 'completed' with accurate counts |

---

## Files Summary

### New Files (6)
1. supabase/functions/ringcentral-sms/index.ts
2. src/hooks/crm/useBulkSms.ts
3. src/hooks/crm/useBulkSmsStatus.ts
4. src/lib/crm/ringcentral-api.ts
5. src/components/crm/bulk/SmsComposeDialog.tsx
6. src/components/crm/bulk/SmsProgressModal.tsx

### Modified Files (6)
1. supabase/config.toml
2. src/components/crm/clients/BulkActionBar.tsx
3. src/pages/crm/Staff.tsx
4. src/pages/crm/Clients.tsx
5. src/hooks/crm/useStaff.ts
6. src/lib/crm/staff-types.ts

### Database Migration
- Create `crm_bulk_sms_logs` table with RLS
- Create `crm_bulk_sms_recipients` table with RLS
- Create `crm_bulk_sms_staff_recipients` table with RLS

---

## Secrets Verification

All 5 required secrets are already configured:
- RINGCENTRAL_CLIENT_ID
- RINGCENTRAL_CLIENT_SECRET
- RINGCENTRAL_JWT_TOKEN
- RINGCENTRAL_SERVER_URL (https://platform.ringcentral.com)
- RINGCENTRAL_FROM_NUMBER (+13074141355)

