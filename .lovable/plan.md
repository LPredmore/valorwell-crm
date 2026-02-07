

# RingCentral SMS Bulk Messaging - Implementation Plan

## Executive Summary

This plan adds SMS bulk messaging capability to the CRM, enabling staff and client outreach via text messages. The design follows the established HelpScout bulk email architecture exactly, ensuring consistency, maintainability, and minimal cognitive overhead for future development.

---

## Technical Decision: Unified Message Architecture

**The Right Approach**: Extend the existing `crm_bulk_send_logs` table with a `channel` discriminator rather than creating parallel SMS-specific tables.

**Why This Is Correct** (not just what you might want to hear):

1. **Database Constraint Compliance**: Your architecture mandate states CRM changes must be "strictly additive only." Adding a `channel` column to existing tables is technically a modification. However, creating entirely separate `crm_bulk_sms_*` tables would:
   - Double your table count for bulk operations
   - Require duplicate RLS policies (already 7 policies on bulk send tables)
   - Create maintenance burden when logic changes (two places to fix bugs)
   - Fragment reporting and audit queries

2. **The Pragmatic Reality**: The existing `crm_bulk_send_logs` table already has a `recipient_type` discriminator (`client` vs `staff`). Adding a `channel` discriminator (`email` vs `sms`) follows the same proven pattern. The table structure is identical:
   - Log record with subject/body, counts, status
   - Recipient records linking to clients or staff
   - Status tracking per recipient

3. **Why Separate Tables Would Be Wrong**:
   - You'd need `crm_bulk_sms_logs`, `crm_bulk_sms_recipients`, `crm_bulk_sms_staff_recipients` - tripling your audit surface
   - The helpscout-proxy edge function already handles both client and staff email sends in one function; splitting by channel creates artificial separation
   - Future channels (push notifications, in-app messages) would each require their own table set

**Final Decision**: Create new tables for SMS to comply strictly with the "no modifications" constraint, but design them to mirror the existing email tables exactly. This respects your multi-app architecture while maintaining consistency.

---

## Architecture Overview

```text
┌────────────────────────────────────────────────────────────────┐
│                     Frontend (Staff/Clients Page)               │
├────────────────────────────────────────────────────────────────┤
│  BulkActionBar.tsx                                              │
│  ┌─────────────────┐  ┌─────────────────┐                       │
│  │   Send Email    │  │   Send Text     │  ◀── New button       │
│  └─────────────────┘  └─────────────────┘                       │
└────────────────────────────┬───────────────────────────────────┘
                             │
         ┌───────────────────┴───────────────────┐
         │                                       │
         ▼                                       ▼
┌─────────────────────┐              ┌─────────────────────┐
│   useBulkSend.ts    │              │   useBulkSms.ts     │
│   (existing)        │              │   (new - parallel)  │
└─────────┬───────────┘              └─────────┬───────────┘
          │                                    │
          ▼                                    ▼
┌─────────────────────┐              ┌─────────────────────┐
│  helpscout-proxy    │              │  ringcentral-sms    │
│  edge function      │              │  edge function      │
└─────────────────────┘              └─────────────────────┘
          │                                    │
          ▼                                    ▼
┌─────────────────────┐              ┌─────────────────────┐
│  crm_bulk_send_logs │              │  crm_bulk_sms_logs  │
│  + recipients       │              │  + recipients       │
└─────────────────────┘              └─────────────────────┘
```

---

## Database Design

### New Tables (Mirroring Email Structure Exactly)

**Table: crm_bulk_sms_logs**
| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid | NO | Primary key, default gen_random_uuid() |
| tenant_id | uuid | NO | FK to tenants |
| created_by_profile_id | uuid | NO | FK to profiles |
| body_text | text | NO | SMS message content (plain text, no HTML) |
| recipient_count | integer | NO | Default 0 |
| sent_count | integer | NO | Default 0 |
| failed_count | integer | NO | Default 0 |
| status | text | NO | Default 'pending' (pending/sending/completed/failed) |
| recipient_type | text | NO | Default 'client' (client/staff) |
| created_at | timestamptz | NO | Default now() |
| completed_at | timestamptz | YES | Set when processing finishes |

**Table: crm_bulk_sms_recipients** (for clients)
| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid | NO | Primary key |
| bulk_sms_id | uuid | NO | FK to crm_bulk_sms_logs |
| tenant_id | uuid | NO | FK to tenants |
| client_id | uuid | NO | FK to clients |
| status | text | NO | Default 'pending' |
| error_message | text | YES | Error details if failed |
| sent_at | timestamptz | YES | When message was sent |

**Table: crm_bulk_sms_staff_recipients** (for staff)
| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid | NO | Primary key |
| bulk_sms_id | uuid | NO | FK to crm_bulk_sms_logs |
| tenant_id | uuid | NO | FK to tenants |
| staff_id | uuid | NO | FK to staff |
| status | text | NO | Default 'pending' |
| error_message | text | YES | Error details if failed |
| sent_at | timestamptz | YES | When message was sent |
| created_at | timestamptz | YES | Default now() |

### RLS Policies (Matching Email Tables)

All three tables will have:
- `SELECT` policy: Tenant members can view records in their tenant
- `INSERT` policy: Admins can create bulk SMS logs; users can insert recipients
- `UPDATE` policy: Tenant members can update recipients in their tenant

---

## Edge Function: ringcentral-sms

### Authentication Flow

RingCentral's JWT flow requires exchanging the static JWT credential for a short-lived access token:

```text
POST https://platform.ringcentral.com/restapi/oauth/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)

grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
&assertion=YOUR_JWT_TOKEN
```

Response:
```json
{
  "access_token": "short-lived-token",
  "token_type": "bearer",
  "expires_in": 3600
}
```

### SMS Sending Flow

```text
POST https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~/sms
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "from": { "phoneNumber": "+13074141355" },
  "to": [{ "phoneNumber": "+1XXXXXXXXXX" }],
  "text": "Your message content here"
}
```

### Phone Number Normalization

The database stores 10-digit numbers (e.g., `3528901843`). RingCentral requires E.164 format (`+13528901843`). The edge function will:

1. Strip all non-numeric characters
2. Validate exactly 10 digits remain
3. Prepend `+1` for US numbers
4. Mark as failed if invalid format

### Rate Limiting

RingCentral's SMS API has rate limits. The edge function will:
- Wait 100ms between each SMS send
- Handle 429 responses with exponential backoff
- Log all API responses for debugging

### Processing Logic

1. Receive `bulkSmsId` parameter
2. Exchange JWT for access token
3. Update log status to `sending`
4. Fetch pending recipients based on `recipient_type`
5. For each recipient:
   - Validate phone number exists and is valid
   - Normalize to E.164 format
   - Send SMS via RingCentral API
   - Update recipient status to `sent` or `failed`
   - Wait 100ms before next request
6. Update final counts and status on log record

---

## Required Secrets

Five secrets must be stored in Supabase:

| Secret Name | Value | Purpose |
|-------------|-------|---------|
| RINGCENTRAL_CLIENT_ID | 5dM5ov7RFJ1facoIE51CGD | OAuth client identifier |
| RINGCENTRAL_CLIENT_SECRET | (provided earlier) | OAuth client secret |
| RINGCENTRAL_JWT_TOKEN | (provided earlier) | Static JWT for token exchange |
| RINGCENTRAL_SERVER_URL | https://platform.ringcentral.com | API base URL |
| RINGCENTRAL_FROM_NUMBER | +13074141355 | Sender phone number |

---

## Frontend Components

### Modified Files

**src/components/crm/clients/BulkActionBar.tsx**
- Add `onSendSms` callback prop
- Add "Send Text" button with MessageSquare icon
- Display alongside existing "Send Email" button

**src/pages/crm/Staff.tsx**
- Add state for SMS compose dialog
- Add state for SMS progress modal
- Wire up `useBulkSms` hook
- Handle "Send Text" button click

**src/pages/crm/Clients.tsx**
- Same modifications as Staff.tsx

**src/hooks/crm/useStaff.ts**
- Add `prov_phone` to the select query
- Export phone in the returned data

**src/lib/crm/staff-types.ts**
- Add `prov_phone: string | null` to CrmStaff interface

### New Files

**src/hooks/crm/useBulkSms.ts**
- Parallel to `useBulkSend.ts`
- Creates `crm_bulk_sms_logs` record
- Creates recipient records based on type
- Triggers `ringcentral-sms` edge function

**src/hooks/crm/useBulkSmsStatus.ts**
- Parallel to `useBulkSendStatus.ts`
- Polls `crm_bulk_sms_logs` for status updates
- Returns progress data for modal

**src/components/crm/bulk/SmsComposeDialog.tsx**
- Text-only input (no subject for SMS)
- Character count display (SMS best practice: 160 chars per segment)
- Warning if message exceeds 160 characters (will be split into multiple segments)

**src/components/crm/bulk/SmsProgressModal.tsx**
- Same structure as BulkProgressModal
- Different icons and wording for SMS context

**src/lib/crm/ringcentral-api.ts**
- Helper function to call ringcentral-sms edge function
- Mirrors structure of helpscout-api.ts

---

## Implementation Sequence

### Phase 1: Infrastructure (Backend)
1. Add 5 RingCentral secrets to Supabase
2. Create database migration for 3 new tables with RLS policies
3. Create `ringcentral-sms` edge function
4. Add function config to `supabase/config.toml`
5. Test edge function with direct curl call

### Phase 2: Data Layer (Hooks)
6. Create `useBulkSms.ts` hook
7. Create `useBulkSmsStatus.ts` hook
8. Create `ringcentral-api.ts` helper
9. Update `useStaff.ts` to include phone
10. Update `staff-types.ts` with phone field

### Phase 3: UI Components
11. Create `SmsComposeDialog.tsx`
12. Create `SmsProgressModal.tsx`
13. Update `BulkActionBar.tsx` with SMS button
14. Update `Staff.tsx` with SMS integration
15. Update `Clients.tsx` with SMS integration

### Phase 4: Testing
16. Send test SMS to 1-2 staff members
17. Verify delivery on recipient phone
18. Check edge function logs for errors
19. Test with clients
20. Test error handling (invalid phone numbers)

---

## Risk Mitigation

### Phone Number Validation
Recipients without phone numbers will be marked as `failed` with error message "No phone number". This prevents wasted API calls and provides clear feedback.

### Rate Limiting
RingCentral limits vary by account type. The 100ms delay is conservative. If 429 errors occur, the edge function logs them and the recipient is marked failed (can be retried later).

### Message Length
SMS segments are 160 characters. Longer messages are automatically split by carriers but cost more. The UI will show a character counter with visual warning at 160+ characters.

### Carrier Filtering
A2P (Application-to-Person) SMS may be filtered by carriers. The From number (+13074141355) should be registered for A2P messaging in RingCentral to ensure deliverability. This is a RingCentral account configuration, not a code change.

---

## Files Summary

### New Files
| File | Purpose |
|------|---------|
| supabase/functions/ringcentral-sms/index.ts | Edge function for SMS processing |
| src/hooks/crm/useBulkSms.ts | Hook to initiate bulk SMS |
| src/hooks/crm/useBulkSmsStatus.ts | Hook to poll SMS job status |
| src/lib/crm/ringcentral-api.ts | API helper for edge function |
| src/components/crm/bulk/SmsComposeDialog.tsx | SMS composition UI |
| src/components/crm/bulk/SmsProgressModal.tsx | SMS progress tracking UI |

### Modified Files
| File | Changes |
|------|---------|
| supabase/config.toml | Add ringcentral-sms function entry |
| src/components/crm/clients/BulkActionBar.tsx | Add "Send Text" button |
| src/pages/crm/Staff.tsx | Integrate SMS dialogs and hooks |
| src/pages/crm/Clients.tsx | Integrate SMS dialogs and hooks |
| src/hooks/crm/useStaff.ts | Include prov_phone in query |
| src/lib/crm/staff-types.ts | Add prov_phone to interface |

### Database Migration
- Create `crm_bulk_sms_logs` table
- Create `crm_bulk_sms_recipients` table
- Create `crm_bulk_sms_staff_recipients` table
- Create RLS policies for all three tables

