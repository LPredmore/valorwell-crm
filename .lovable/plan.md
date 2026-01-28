
# Add Authentication Page for CRM Access

## Problem Identified

The CRM authentication flow is correctly implemented in `useCrmAuth.ts` - it checks for:
1. A valid Supabase auth session
2. Admin or staff role in `user_roles` table
3. Tenant membership in `tenant_memberships` table

However, when authentication fails, users are redirected to `/` which shows "Welcome to Your Blank App" - there's no actual login page.

## Solution

Create a dedicated login page at `/auth` that allows admin and staff users to sign in, then update the CRM redirect to point there instead of the root page.

---

## Implementation Steps

### Step 1: Create Authentication Page

Create `src/pages/Auth.tsx` with:
- Email/password login form using shadcn/ui components
- Error handling for invalid credentials
- Automatic redirect to `/crm/clients` on successful login
- Clean, professional styling that matches the CRM design

### Step 2: Update CRM Layout Redirect

Modify `src/components/crm/layout/CrmLayout.tsx`:
- Change redirect from `/` to `/auth` when not authenticated
- This ensures unauthenticated users see the login page

### Step 3: Update Root Page

Modify `src/pages/Index.tsx`:
- Check if user is already authenticated
- If authenticated with CRM access, redirect to `/crm/clients`
- If not authenticated, redirect to `/auth`
- This prevents users from seeing the blank placeholder

### Step 4: Add Route Configuration

Update `src/App.tsx`:
- Add `/auth` route pointing to the new Auth page
- Ensure proper route ordering

---

## Technical Details

### Auth Page Features
- Email input with validation
- Password input with secure handling
- Sign in button with loading state
- Error messages for failed attempts
- "Forgot password" link (future enhancement)
- Responsive design

### Security Considerations
- Uses Supabase Auth (existing integration)
- No client-side role storage
- Server-side validation via RLS policies
- Proper error handling without exposing sensitive info

### File Changes
```text
src/
  pages/
    Auth.tsx                 -- NEW: Login page
    Index.tsx                -- MODIFY: Add redirect logic
  components/
    crm/
      layout/
        CrmLayout.tsx        -- MODIFY: Redirect to /auth
  App.tsx                    -- MODIFY: Add /auth route
```

---

## User Flow After Implementation

```text
1. User visits /crm/clients (or any CRM route)
         ↓
2. CrmLayout checks authentication via useCrmAuth
         ↓
3a. If authenticated + has role + has tenant → Show CRM
3b. If not authenticated → Redirect to /auth
         ↓
4. User enters credentials on /auth page
         ↓
5. On success → Redirect to /crm/clients
6. On failure → Show error message
```

---

## Notes

- This uses your existing Supabase Auth setup
- Users must already exist in your database with:
  - An entry in `auth.users` (Supabase Auth)
  - A matching entry in `profiles`
  - A role in `user_roles` (admin or staff)
  - A tenant membership in `tenant_memberships`
- No signup flow is included (admin-only user creation is assumed)
