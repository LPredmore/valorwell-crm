# Clear the 627 database security warnings

The shared database is used by the Clients, Staff, CRM, Billing and Onboarding apps. Many warnings point to things the apps use on purpose. If we "clear" those by removing access, those apps will break. So each group is either fixed for real or reviewed and marked as intended, not removed without checking.

## What the warnings are (live check today)

| # | Warning | Count | Action |
|---|---|---|---|
| 1 | Security Definer View (ERROR) | 3 | Fix: switch the views to run with the caller's permissions (`security_invoker = on`), after checking which apps read them |
| 2 | Function search path not set | 11 | Fix: add `SET search_path = public` to each one. Safe, and nothing changes for users |
| 3 | Extension in public schema | 1 | Move it to an `extensions` schema only if no app calls it by its `public.` name; otherwise mark as intended |
| 4 | Anyone (not signed in) can run a privileged function | 144 | Review each one. Take away anonymous access unless a public page uses it (website intake forms, the newsletter and relationship unsubscribe pages, webhooks). Keep those and mark them intended |
| 5 | Signed-in users can run a privileged function | 349 | Most of these are how the apps work (the CRM's buttons and actions call them). Take access away only from internal helpers that no app calls (for example cron, worker and `_`-prefixed helpers). Mark the rest intended |
| 6 | Tables with security on but no access rules | 118 | Intended for tables that only server code uses: nobody can read them from a browser. Confirm none of the apps reads them directly, then mark intended |
| 7 | Leaked password protection off | 1 | You turn this on in the Supabase Auth settings. I can't change it from here |

## Steps
1. List every flagged function, view and table, and search all five apps for any use of each one.
2. Write one forward-dated migration that only adds restrictions: views, search paths, removing access from functions nothing uses, and the extension move if it's safe. No tables or data change.
3. Apply it, run the CRM test suite and smoke checks, and look at the logs of the other apps' main actions.
4. Run the checker again. Mark the remaining intended items with a written reason for each.
5. Report the count before and after, plus what's left for you to do (the password setting).

## Expected result
The real risks go to zero: views, search paths, unused anonymous access and unused helpers. The rest are marked as intended with reasons, not deleted. The count won't literally reach 0 unless you accept that some app features will break.

## Technical details
- Removing access uses `REVOKE EXECUTE ... FROM anon` / `FROM authenticated`. `service_role` keeps access, so Edge Functions and cron keep working.
- Before removing access from any function, it gets checked against `.rpc('name')` calls and Edge Function code in all five apps.
- Rollback: the migration file includes the matching `GRANT` statements in a comment.
