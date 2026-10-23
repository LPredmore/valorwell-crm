# Gmail sync repair: restore missing database pieces, then recover missed mail

## Current state (checked 15:51 UTC, Oct 23)
- Gmail sync for info@valorwell.org has been failing for about 25 hours. Last success: Oct 22, 15:00:55 UTC. The error is still "missing function `record_relationship_gmail_retrieval_failure`". The history cursor is stuck at 3485910 and the watch is valid until Oct 30.
- All six required functions and the private receipts table are still missing in production.
- None of the four Oct 22 migrations (195806, 195848, 195938, 200829) is in the production ledger. The ledger now has 998 entries, newest 20261023152358, so newer work went out without these four.
- The four migration files exist in the repository. The incident repair file and `scripts/gmail-recovery/` from my last turn are gone from the repository. This matches the push error: a later GitHub push replaced that Lovable work.
- Root cause: the code that calls these functions was deployed. The migrations that create them were committed but never applied, while later migrations were.

## Approach
Apply the four reviewed migrations in their original order as new forward-only migrations, using their original contents. This does not edit history or fake any ledger entries. What each one does:
1. 195806: creates the private receipts table, the source-receipt writer, the exact-source check and anchored email-link reconciliation. Writers are restricted to the server.
2. 195848: updates the cleanup of email review tasks and organization-completion dispositions.
3. 195938: adds the retrieval-failure recorder, the recovery report and Gmail diagnostics.
4. 200829: changes how secondary To recipients are handled.

Migrations 2 and 4 change the behavior of the existing relationship review process beyond Gmail. They are included because the deployed code already expects them. Before each one is applied, I will show you its effect for approval.

## Steps
1. **Preflight (read-only):** check every object the four files reference against live production. Confirm no newer migration redefined the same functions, which would be overwritten. Check the other four apps (Clients, Staff, Billing, Onboarding) for any use of these functions. Save a receipt of the cursor and timestamps.
2. **Apply the migrations one at a time.** After each one, verify the function signatures, that execution is limited to the server, that ordinary signed-in users and anonymous visitors are denied, and that the fixed search path holds. Refresh the schema cache. Run the security advisor.
3. **Edge functions:** redeploy `relationship-gmail-push` and `relationship-google-maintenance` from the current source. Leave Calendar, OAuth and Pub/Sub untouched.
4. **Live verification:** trigger one bounded maintenance run. Confirm the real result: the error clears, the cursor advances, `last_successful_sync_at` moves forward naturally and new messages appear in the CRM. Never set these values by hand.
5. **Missed mail recovery:** the cursor is about 25 hours old, well within Gmail's history window. Replay history from 3485910 through the normal deduplicated ingestion. Report counts for messages recovered, skipped as duplicates and sent to review. Ambiguous matches go to review.
6. **Prevent recurrence:** add a source check that fails CI when edge function code calls an RPC that no migration defines. Add a predeploy production contract check, and keep the stale-sync alerts (60 minutes warning, 240 minutes critical) and the missing-function (PGRST202) alerts. Restore the lost incident documentation.

## Not done without your explicit say-so
- No test emails sent, no campaigns enabled, no changes to outreach.
- No ledger edits, no cursor resets.

## Known limitation
Signed-JWT tests on a fully isolated copy of the database aren't possible (the preview branch is broken). Access checks will run as role-switched SQL in production, inside rolled-back transactions.
