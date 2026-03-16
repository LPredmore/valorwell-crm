

# Fix: Enroll in Campaign dialog not showing campaigns

## Root cause

`useCrmAuth()` is a standalone `useState`/`useEffect` hook, not a shared context. Every component and hook that calls it spins up an independent instance, each making 3 sequential Supabase requests (getUser → check role → get tenant membership). There are 21 files doing this independently.

When the `EnrollInCampaignDialog` mounts (whether from BulkActionBar on the Clients page or from inside the ClientQuickProfile Sheet), its internal `useCampaigns()` hook calls `useCrmAuth()` which starts with `tenantId = ""`. The query is disabled (`enabled: !!tenantId`). TanStack Query may or may not have cached data from a prior `useCampaigns` call on a different page — but crucially, when the dialog opens from the Clients page (not the Campaigns page), there may be no cached campaign data at all. The auth resolution delay creates a brief window where the Select dropdown has no items.

Additionally, when the dialog is opened from inside the `ClientQuickProfile` Sheet, there is a Radix portal stacking problem: Sheet portal → Dialog portal → Select portal. The Select dropdown can render behind the Dialog overlay due to identical z-index values.

## Decision: Convert `useCrmAuth` to a React Context provider

The correct fix is to make `useCrmAuth` a context that resolves once at the `CrmLayout` level and is consumed by all 21 downstream files. This is the right approach because:

1. It eliminates ~20 redundant auth resolution cycles (3 network requests each) on every page load
2. It guarantees `tenantId` is available synchronously to every hook and component inside the CRM route tree — no more race conditions
3. The `CrmLayout` component already gates rendering on auth completion (`isLoading` / `isAuthenticated` checks), so by the time any child component mounts, auth is resolved
4. This matches the pattern already described in the project's own memory notes about "composite isPending state" — the auth should resolve once, not per-consumer

A prop-drilling or "just add a loading state to the dialog" approach would be a band-aid that leaves 20+ redundant auth cycles in place and doesn't prevent the same class of bug from recurring in every new feature.

## Implementation plan

### 1. Create `CrmAuthContext` provider

**New file:** `src/contexts/CrmAuthContext.tsx`

- Move the auth resolution logic from `useCrmAuth` into a `CrmAuthProvider` component
- Export a `useCrmAuth()` hook that reads from context (same API, drop-in replacement)
- Throw a clear error if `useCrmAuth()` is called outside the provider

### 2. Wire provider into `CrmLayout`

**File:** `src/components/crm/layout/CrmLayout.tsx`

- Wrap the layout's children with `<CrmAuthProvider>`
- Keep the existing loading/redirect logic, but source it from the provider
- All children (pages, hooks, dialogs) inherit the resolved auth state instantly

### 3. Update all 21 consumer files

**Files:** All files currently importing from `src/hooks/crm/useCrmAuth.ts`

- Change import path from `@/hooks/crm/useCrmAuth` to `@/contexts/CrmAuthContext`
- No other code changes needed — the hook signature (`useCrmAuth()` returning `CrmAuthContext`) stays identical

### 4. Fix the Sheet → Dialog portal stacking issue

**File:** `src/components/crm/clients/ClientQuickProfile.tsx`

- Remove the `EnrollInCampaignDialog` render from inside the Sheet
- Instead, expose the enrollment intent via a callback prop (`onEnrollInCampaign`)
- The parent (`Clients.tsx`) already renders its own `EnrollInCampaignDialog` at the page level — use that single instance for both bulk and quick-profile enrollment flows
- This eliminates the triple-nested portal problem entirely

### 5. Delete the old standalone hook file

**File:** `src/hooks/crm/useCrmAuth.ts` — delete or convert to a re-export from the context for backward compatibility.

## What this fixes

- Campaign list appears immediately when the Enroll dialog opens (auth is already resolved)
- Select dropdown is never trapped behind a Dialog overlay (no more nested portals)
- ~60 redundant network requests eliminated per CRM page load
- Every future feature that needs `tenantId` gets it synchronously with zero risk of this bug class

