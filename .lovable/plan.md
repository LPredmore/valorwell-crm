

# Sync Status Filters with `pat_status_enum`

## Problem
The database `pat_status_enum` has 23 values, but the TypeScript code (`PatStatus` type and `STATUS_CONFIG`) only defines 20. Three statuses are missing from the code:

| Missing Status | Notes |
|---|---|
| `At Risk` | Set by `mark_at_risk_clients()` DB function — actively used |
| `Legacy - Has Therapist Available` | Legacy status, likely for historical data |
| `Legacy - No Therapist Available` | Legacy status, likely for historical data |

## Changes

### 1. `src/lib/crm/types.ts` — Add 3 missing values to `PatStatus` union type

### 2. `src/lib/crm/status-config.ts` — Add 3 entries to `STATUS_CONFIG`
- **At Risk**: category `inactive`, orange/amber color, `showInKanban: false`
- **Legacy - Has Therapist Available**: category `closed`, gray color, `showInKanban: false`
- **Legacy - No Therapist Available**: category `closed`, gray color, `showInKanban: false`

### 3. `src/lib/crm/campaign-types.ts` — Add `At Risk` to `SYSTEM_MANAGED_STATUSES`
Since `mark_at_risk_clients()` sets this status automatically, it should show the warning in the campaign trigger UI.

No other files need changes — `ClientFilters.tsx` already uses `ALL_STATUSES` from `status-config.ts`, so it will automatically pick up the new values.

