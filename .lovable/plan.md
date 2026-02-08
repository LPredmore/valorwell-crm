

# Implementation Plan: Prefer `pat_name_preferred` for `{{first_name}}` Variable

## Overview

This plan ensures the `{{first_name}}` personalization variable consistently uses the client's preferred name when available, falling back to their first name only if no preferred name exists.

## Current State

The campaign scheduler (`supabase/functions/campaign-scheduler/index.ts`) already implements the correct logic:
```typescript
const firstName = client.pat_name_preferred || client.pat_name_f || 'there';
```

However, two other edge functions that send messages (bulk email and bulk SMS) use only `pat_name_f`, creating inconsistency.

---

## Changes Required

### 1. Update HelpScout Proxy Edge Function (Bulk Email)

**File:** `supabase/functions/helpscout-proxy/index.ts`

**Current behavior (lines 178-218):** When fetching client recipients for bulk email, the query only selects `pat_name_f` and `pat_name_l`, then uses `pat_name_f` as the recipient's `firstName`.

**Change:**
1. Add `pat_name_preferred` to the SELECT query (line 188)
2. Use `pat_name_preferred || pat_name_f` for the firstName field (line 215)

```typescript
// Before (line 185-189):
clients!inner (
  id,
  email,
  pat_name_f,
  pat_name_l
)

// After:
clients!inner (
  id,
  email,
  pat_name_f,
  pat_name_l,
  pat_name_preferred
)

// Before (line 214-215):
firstName: clientData?.pat_name_f || '',

// After:
firstName: clientData?.pat_name_preferred || clientData?.pat_name_f || '',
```

---

### 2. Update RingCentral SMS Edge Function (Bulk SMS)

**File:** `supabase/functions/ringcentral-sms/index.ts`

**Current behavior (lines 204-227):** When fetching client recipients for bulk SMS, the query only selects `pat_name_f` and `pat_name_l` for the display name.

**Change:**
1. Add `pat_name_preferred` to the SELECT query
2. Use `pat_name_preferred || pat_name_f` when building the display name

```typescript
// Before (line 207-214):
client:client_id (
  id,
  phone,
  pat_name_f,
  pat_name_l
)

// After:
client:client_id (
  id,
  phone,
  pat_name_f,
  pat_name_l,
  pat_name_preferred
)

// Before (line 225):
name: `${(r.client as any)?.pat_name_f || ''} ${(r.client as any)?.pat_name_l || ''}`.trim() || 'Unknown',

// After:
name: (r.client as any)?.pat_name_preferred || 
      `${(r.client as any)?.pat_name_f || ''} ${(r.client as any)?.pat_name_l || ''}`.trim() || 
      'Unknown',
```

---

### 3. Update UI Display Function (Optional but Recommended)

**File:** `src/lib/crm/status-config.ts`

**Current behavior (lines 212-219):** The `getClientDisplayName()` function shows first + last name only, ignoring preferred name.

**Recommendation:** Keep this function as-is for now. The current behavior (showing legal name) is appropriate for administrative views like tables and lists. The preferred name is already shown separately in `ClientQuickProfile.tsx` and `ClientDetail.tsx` when relevant.

However, if you want the display name throughout the CRM to prefer the preferred name, update:

```typescript
// Before:
export function getClientDisplayName(client: {
  pat_name_preferred?: string | null;
  pat_name_f?: string | null;
  pat_name_l?: string | null;
}): string {
  const parts = [client.pat_name_f, client.pat_name_l].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Unknown Client';
}

// After (if preferred name should be shown in display):
export function getClientDisplayName(client: {
  pat_name_preferred?: string | null;
  pat_name_f?: string | null;
  pat_name_l?: string | null;
}): string {
  if (client.pat_name_preferred?.trim()) {
    return client.pat_name_preferred;
  }
  const parts = [client.pat_name_f, client.pat_name_l].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Unknown Client';
}
```

---

## Summary of Changes

| File | Change | Impact |
|------|--------|--------|
| `helpscout-proxy/index.ts` | Add `pat_name_preferred` to query + use it for firstName | Bulk emails use preferred name |
| `ringcentral-sms/index.ts` | Add `pat_name_preferred` to query + use it for name | Bulk SMS use preferred name |
| `status-config.ts` | (Optional) Update `getClientDisplayName()` | UI displays preferred name |

---

## Technical Notes

1. **No database changes required** - `pat_name_preferred` column already exists
2. **Backward compatible** - Falls back to `pat_name_f` when preferred name is null/empty
3. **Consistent with campaign-scheduler** - All three messaging systems will use identical logic
4. **Edge functions auto-deploy** - Changes will take effect automatically after file edits

---

## Testing Checklist

After implementation:
1. Send a test campaign message to a client with a preferred name set
2. Send a bulk email to a client with a preferred name set
3. Send a bulk SMS to a client with a preferred name set
4. Verify all three show the preferred name, not the first name
5. Test with a client who has NO preferred name to confirm fallback works

