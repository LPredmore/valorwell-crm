
# Fix HelpScout Connection Test - Implementation Plan

## Problem Summary

The `testConnection` mutation in `useHelpScoutSettings.ts` contains dead code that fires a request without the required `action` parameter, causing a 400 error. The second request succeeds, masking the issue from the UI but polluting logs.

---

## Technical Decision: Standardize on Helper Function Pattern

**Decision:** Create a reusable `helpscoutApi` utility function that all HelpScout hooks will use.

**Why this is the right approach:**

1. **The edge function is query-parameter-based by design.** The `helpscout-proxy` function uses `?action=X` for routing, which is a valid REST-like pattern. Changing this now would require refactoring the entire edge function and all future hooks.

2. **`supabase.functions.invoke` doesn't handle query params cleanly.** The SDK is designed for RPC-style calls where everything goes in the body. Fighting this creates awkward code.

3. **Consistency matters more than ideology.** The Inbox feature (Phase 3B) will require 5+ additional API calls: `list-conversations`, `get-conversation`, `reply`, `create-conversation`, `search-customers`. All will need the same auth + URL construction + query params pattern. A helper function prevents copy-paste code.

4. **Centralized error handling.** A single helper can standardize how HelpScout API errors are parsed and reported across all hooks.

---

## Implementation

### Step 1: Create `helpscoutApi` Helper

Create `src/lib/crm/helpscout-api.ts`:

```text
+-----------------------------------------------+
|  helpscoutApi(action, params?, body?)         |
+-----------------------------------------------+
| 1. Get session from Supabase Auth             |
| 2. Build URL with action + query params       |
| 3. Make fetch request with auth header        |
| 4. Parse response and handle errors           |
| 5. Return typed result                        |
+-----------------------------------------------+
```

**Key features:**
- Typed action names (autocomplete + compile-time safety)
- Centralized URL (no hardcoding in hooks)
- Standardized error messages
- Automatic auth header injection

### Step 2: Fix `useHelpScoutSettings.ts`

Remove lines 43-48 (the dead `supabase.functions.invoke` call) and replace lines 50-67 with a single call to the new helper:

```typescript
// Before: 25 lines of duplicated code
// After: 1 line
const result = await helpscoutApi('test-connection');
```

### Step 3: Prepare for Phase 3B Hooks

The helper will be ready for upcoming hooks:

| Hook | Helper Call |
|------|-------------|
| `useConversations` | `helpscoutApi('list-conversations', { status, page })` |
| `useConversationDetail` | `helpscoutApi('get-conversation', { id })` |
| `useSendReply` | `helpscoutApi('reply', { id }, { text })` |
| `useComposeEmail` | `helpscoutApi('create-conversation', null, { subject, ... })` |

---

## File Changes

| File | Action |
|------|--------|
| `src/lib/crm/helpscout-api.ts` | **Create** - Reusable API helper |
| `src/hooks/crm/useHelpScoutSettings.ts` | **Edit** - Remove dead code, use helper |

---

## Helper Function Specification

```typescript
type HelpScoutAction = 
  | 'test-connection'
  | 'list-conversations'
  | 'get-conversation'
  | 'reply'
  | 'create-conversation'
  | 'search-customers';

interface HelpScoutApiOptions {
  params?: Record<string, string>;
  body?: unknown;
  method?: 'GET' | 'POST';
}

async function helpscoutApi<T>(
  action: HelpScoutAction, 
  options?: HelpScoutApiOptions
): Promise<T>
```

---

## Why Not Alternative Approaches

| Alternative | Why Not |
|-------------|---------|
| Move `action` to request body | Requires edge function refactor; query params are standard REST |
| Use `invoke('helpscout-proxy?action=X')` | Undocumented behavior; may break in SDK updates |
| Keep inline fetch in each hook | Copy-paste code; inconsistent error handling |

---

## Outcome

After implementation:
- Single request per test (no spurious 400 errors)
- Clean, reusable pattern for all HelpScout hooks
- Type-safe action names with autocomplete
- Centralized error handling
- Ready for Phase 3B (Inbox UI)
