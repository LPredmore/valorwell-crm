# Creator and community-interest database verification

The migration `20260717225018_creator_community_interest_workflow.sql` is the
source of truth for the anonymous Website intake contract and additive CRM
schema changes.

## Apply and verify

1. Apply the migration through the repository's established Supabase migration
   workflow.
2. Run `creator_community_interest_workflow_test.sql` in one privileged SQL
   session. It creates synthetic `example.invalid` records inside a transaction
   and always ends with `ROLLBACK`.
3. Run Supabase security and performance advisors and compare new findings with
   the pre-change baseline.
4. Confirm the production Website uses only the publishable/anonymous key and
   calls `submit_website_creator_interest`; it must not contain a service-role key.

The SQL verification covers anonymous execution, direct table denial, strict
input validation, required consent, payload size, exact state and role codes,
unsafe URLs, all-or-nothing failure, new contact/profile creation, null optional
fields, zero and multiple socials, normalized-email reuse, request-key
idempotency, raw-history preservation, role/social deduplication, nondecreasing
followers, the safe conflict response flag and staff conflict feed, conflict
review routing, no `profile_id`, no Auth users, staff updates,
interaction notes, composite note/contact tenant integrity, and staff tenant
isolation. It also verifies the five-distinct-submissions-per-email/hour database
rate limit, same-key replay precedence, the authenticated atomic contact/profile
correction RPC, unauthorized-tenant denial, and rollback when profile corrections
are invalid.

The public intake currently uses database-side rate limiting rather than CAPTCHA:
no approved CAPTCHA integration or production secret existed for this workflow.
The indexed limit applies only to `valorwell_website_interest` / `interest_submission`
rows and does not affect clinician, OCS, or BTY submissions.

For a syntax and integration check without touching Supabase, create an empty
disposable local PostgreSQL database, then run these files in order:

1. `creator_community_interest_workflow_fixture.sql`
2. `../migrations/20260717225018_creator_community_interest_workflow.sql`
3. `creator_community_interest_workflow_test.sql`

The fixture is deliberately minimal and must never be run against a real project.

## Roll back

First roll the Website back so it no longer calls the RPC. Then run
`creator_community_interest_workflow_rollback.sql`. That rollback removes only
the anonymous function. It intentionally retains canonical data, additive
columns, integrity constraints, indexes, and the tenant-aware RLS improvements.
No historical Therapist CRM rows are deleted or rewritten.
