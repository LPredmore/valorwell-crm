
# Fix HelpScout Loading Flash - Implementation Plan

## Problem Statement

When the Inbox page loads, users briefly see a "HelpScout not connected" error card before the actual content appears. This happens because of a timing gap between authentication resolution and the HelpScout settings query.

## Root Cause Analysis

### The State Sequence (Current Behavior)

```text
Timeline:
T0: Page mounts
    - useCrmAuth: { isLoading: true, isAuthenticated: false, tenantId: '' }
    - useHelpScoutSettings query: DISABLED (enabled = false && false)
    - React Query returns: { isLoading: false, data: undefined }
    - settingsLoading = false (query is idle, not loading)
    - isConnected = false (settings is undefined)
    
T1: Auth check completes (~100-200ms)
    - useCrmAuth: { isLoading: false, isAuthenticated: true, tenantId: 'xxx' }
    - useHelpScoutSettings query: NOW ENABLED
    - React Query starts fetch: { isLoading: true, data: undefined }
    
T2: Settings fetch completes (~50-100ms)
    - settings = { connection_status: 'connected', ... }
    - isConnected = true
    - UI shows correct email view
```

### The Bug Location

**File: `src/pages/crm/Inbox.tsx` (lines 66-72)**
```typescript
if (settingsLoading) {
  return <Loader2 ... />;
}
```

This check fails because `settingsLoading` is `false` when the query is disabled (before auth completes). The UI proceeds to render, and since `isConnected` is `false`, it shows the error card.

### Why React Query Behaves This Way

React Query distinguishes between:
- `isLoading: true` = "I am actively fetching data"
- `isLoading: false` + `data: undefined` = "I haven't fetched yet / I'm disabled"

The `enabled` option prevents the query from running, but React Query reports this as "not loading" rather than "waiting to load."

## Technical Decision

**Add a composite loading state that accounts for auth resolution.**

The fix is to ensure the loading spinner shows until we have **both**:
1. Auth resolution completed (`useCrmAuth.isLoading === false`)
2. HelpScout settings query completed (if auth succeeded)

This is the correct approach because:
- It's semantically accurate: we're still "loading" the information needed to render
- It's minimal: no new hooks, no complex state machines
- It's explicit: the condition clearly states what we're waiting for
- It follows React Query best practices for dependent queries

## Implementation

### File: `src/hooks/crm/useHelpScoutSettings.ts`

**Change**: Expose the auth loading state so consumers can check if the query is pending due to auth.

```typescript
export function useHelpScoutSettings() {
  const { tenantId, isAuthenticated, isLoading: authLoading } = useCrmAuth();
  // ... existing code ...

  return {
    settings,
    isLoading,
    error,
    testConnection,
    updateSettings,
    isConnected: settings?.connection_status === 'connected',
    // NEW: True when we're waiting for auth OR waiting for settings
    isPending: authLoading || (isAuthenticated && !!tenantId && isLoading),
  };
}
```

**Why `isPending`?**
- `authLoading` = waiting for user/role/tenant check
- `isAuthenticated && !!tenantId && isLoading` = auth succeeded, now waiting for settings query
- Together, this covers the entire initialization window

### File: `src/pages/crm/Inbox.tsx`

**Change**: Use the new `isPending` flag instead of `isLoading`.

```typescript
export default function Inbox() {
  const { isPending, isConnected } = useHelpScoutSettings();
  
  // ... existing state declarations ...

  if (isPending) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Now we can trust isConnected because:
  // - Auth has completed
  // - Settings query has completed (or we're not authenticated)
  const showHelpScoutSetup = !isConnected && channelTab === 'email';
  
  // ... rest of component unchanged ...
}
```

## Alternative Approaches Considered

### Option A: Check auth state directly in Inbox.tsx
```typescript
const { isLoading: authLoading } = useCrmAuth();
const { isLoading: settingsLoading, isConnected } = useHelpScoutSettings();

if (authLoading || settingsLoading) {
  return <Loader2 />;
}
```

**Rejected because**: This duplicates the `useCrmAuth` hook call (it's already called inside `useHelpScoutSettings`), causing redundant auth checks and potential state sync issues.

### Option B: Use `fetchStatus` from React Query
```typescript
const { fetchStatus } = useQuery({ ... });
// fetchStatus === 'idle' when disabled
```

**Rejected because**: This requires understanding React Query internals and doesn't account for the auth loading state. The `isPending` abstraction is cleaner for consumers.

### Option C: Default the email tab to show a skeleton
```typescript
if (settingsLoading || !settings) {
  return <EmailSkeleton />;
}
```

**Rejected because**: This would show a skeleton even when auth fails (user not logged in), which is misleading. The correct behavior is to wait for the full state to resolve.

## File Changes Summary

| File | Action | Lines Changed |
|------|--------|---------------|
| `src/hooks/crm/useHelpScoutSettings.ts` | Modify | ~3 lines |
| `src/pages/crm/Inbox.tsx` | Modify | ~2 lines |

## Expected Behavior After Fix

```text
Timeline:
T0: Page mounts
    - isPending = true (authLoading = true)
    - UI shows spinner
    
T1: Auth completes
    - isPending = true (authLoading = false, but settings isLoading = true)
    - UI still shows spinner
    
T2: Settings fetch completes
    - isPending = false
    - isConnected = true
    - UI shows email view immediately (no flash)
```

## Testing

1. Hard refresh the Inbox page while logged in
2. Verify spinner appears immediately
3. Verify no "HelpScout not connected" flash occurs
4. Verify email conversations load correctly after spinner
5. Switch to SMS tab and back to Email - should work without flash
