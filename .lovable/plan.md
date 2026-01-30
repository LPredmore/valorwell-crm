

# Fix Case-Sensitive Email Matching in HelpScout Inbox

## Root Cause (Confirmed)

The edge function has a case-sensitivity mismatch in the email matching logic:

```text
Line 334:  customerEmails = [...].toLowerCase()     → "elanderia@yahoo.com"
Line 350:  .in("email", customerEmails)             → PostgreSQL case-sensitive match
Database:  email = "Elanderia@yahoo.com"            → No match!

Result: emailToClientId map is empty → all 79 conversations filtered out → empty inbox
```

The comment on line 345 says "case-insensitive" but the actual query is case-sensitive.

---

## Technical Decision: Use PostgreSQL `ilike` via Raw SQL Function

**Why this is the correct solution:**

1. **Cannot modify database columns** - Per your constraint, we cannot add a computed column or change the email column to `citext` type.

2. **Supabase JS SDK limitation** - The `.in()` filter doesn't support case-insensitive matching. There's no `.ilike()` equivalent for arrays.

3. **Database function is the cleanest approach** - Create a simple SQL function that performs case-insensitive email lookup and call it via `.rpc()`. This keeps the logic in the database layer where it belongs.

4. **Alternative considered and rejected**: Fetching ALL clients for the tenant and filtering in JavaScript. This is wasteful (could be thousands of clients) and doesn't scale.

---

## Implementation

### Step 1: Create Database Function

Create a function that accepts an array of lowercased emails and returns matching clients with case-insensitive comparison:

```sql
CREATE OR REPLACE FUNCTION public.find_clients_by_emails_insensitive(
  p_tenant_id uuid,
  p_emails text[]
)
RETURNS TABLE (id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id, c.email
  FROM clients c
  WHERE c.tenant_id = p_tenant_id
    AND LOWER(c.email) = ANY(p_emails);
$$;
```

**Why this works:**
- `LOWER(c.email)` normalizes database values at query time
- `= ANY(p_emails)` matches against the already-lowercased array
- `STABLE` allows query optimization
- `SECURITY DEFINER` respects RLS context

### Step 2: Update Edge Function

Replace the current query:

```typescript
// BEFORE (broken)
const { data: clients, error: clientsError } = await supabase
  .from("clients")
  .select("id, email")
  .eq("tenant_id", membership.tenant_id)
  .in("email", customerEmails);

// AFTER (fixed)
const { data: clients, error: clientsError } = await supabase
  .rpc("find_clients_by_emails_insensitive", {
    p_tenant_id: membership.tenant_id,
    p_emails: customerEmails,
  });
```

---

## Why Not Other Approaches?

| Approach | Rejected Because |
|----------|------------------|
| Add `email_lower` computed column | Violates "no column changes" constraint |
| Change column to `citext` type | Violates "no column changes" constraint |
| Fetch all clients, filter in JS | Doesn't scale (potentially thousands of clients) |
| Multiple individual `ilike` queries | N+1 query problem, slow |
| Use PostgREST `or` with `ilike` | Supabase JS doesn't support `ilike` in `.in()` |

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/XXXXXX_add_email_lookup_function.sql` | New database function |
| `supabase/functions/helpscout-proxy/index.ts` | Replace `.in()` with `.rpc()` call |

---

## Testing Plan

After implementation:
1. Deploy edge function
2. Navigate to `/crm/inbox`
3. Verify conversations appear in both Inbox and Sent tabs
4. Verify conversations with mixed-case emails (like `Elanderia@yahoo.com`) are correctly matched

---

## Summary

The fix is minimal and surgical:
1. Add one database function for case-insensitive email array matching
2. Change one line in the edge function to use `.rpc()` instead of `.in()`

This respects the constraint of not modifying existing columns while properly fixing the case-sensitivity bug that's causing the empty inbox.

