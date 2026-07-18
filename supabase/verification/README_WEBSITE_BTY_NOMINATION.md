# Beyond The Yellow nomination intake

Migration `20260718112222_website_bty_nomination_intake.sql` adds one narrow public wrapper, `submit_website_bty_nomination(jsonb)`. Apply it after `20260717225018_creator_community_interest_workflow.sql`; it relies on that migration's relationship-contact review contract. It does not replace the older broad BTY function.

## Contract and data ownership

The accepted object contains only `submission_key`, `nomination_type`, `subject_name`, `subject_link`, `subject_veteran_affiliated`, `first_name`, `last_name`, `email`, `phone`, `role_title`, `action`, `consent`, `source_page`, and `user_agent`. The server accepts at most 16 KB, requires true consent, requires an ASCII email with a dotted alphabetic TLD, and accepts only an optional HTTPS subject link. `nomination_type` is exactly `individual` or `organization`.

Each accepted event is preserved in `website_submissions` with:

- `source_system = valorwell_website_bty_nomination`
- `submission_type = bty_submission`
- `original_lane = nominate`
- `normalized_lane = bty_participation`

The nominator is matched by normalized email. A profile-linked or established-source contact may be linked to the raw event but is immutable to the anonymous form. Only blank fields on identity-free contacts from the approved Website interest/nomination or historical interest-migration sources can be enriched. The wrapper never creates Auth/profile rows and never sets or copies `relationship_contacts.profile_id`.

The nominated subject receives only the fixed canonical `bty_nominee` role. Individual nominees use `relationship_contact_roles`; organization nominees use `relationship_organization_roles`. The nominator receives no role. Ambiguous explicit-source/email matches are retained as `reviewing` raw events without a guessed canonical link.

An unselected veteran-affiliation checkbox is stored as unknown (`NULL`) for an organization, not as an evidence-backed negative. A later affirmative nomination for the same HTTPS-linked organization can promote unknown to true, but cannot overwrite an evidence-backed staff correction to false.

Exact retries reuse the original `submission_key` and return `{ "ok": true }` without another row. A reused key with a different payload is rejected with a generic error. After replay handling, the sixth distinct accepted nomination for one normalized email in a rolling hour is rejected. The wrapper exposes no identifiers or backend details.

## Security

`submit_website_bty_nomination(jsonb)` is `SECURITY DEFINER` because it is the sole validated anonymous write boundary across RLS-protected canonical tables. It uses an empty `search_path`, fully qualified objects, fixed source/lane/role values, transaction-scoped advisory locks, strict input validation, and generic exceptions. Default `PUBLIC` execution is revoked; only `anon` and `authenticated` receive `EXECUTE`. Anonymous privileges are explicitly removed from every canonical table used by the wrapper, and no internal helper is exposed.

The migration also closes pre-existing tenant gaps in the authenticated staff surface: organization and organization-role policies require tenant membership, organization roles require a same-tenant parent, and website-submission policies require every contact/organization subject reference to belong to the submission tenant. Restrictive owner guards allow only active staff/admin owners who belong to the organization tenant. Existing authenticated grants remain in place; RLS supplies authorization.

## Disposable verification

Use a new disposable PostgreSQL database. Never run the fixture against Supabase or a persistent database.

```powershell
psql -v ON_ERROR_STOP=1 -f supabase/verification/website_bty_nomination_fixture.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20260718112222_website_bty_nomination_intake.sql
psql -v ON_ERROR_STOP=1 -f supabase/verification/website_bty_nomination_workflow_test.sql
psql -v ON_ERROR_STOP=1 -f supabase/verification/website_bty_nomination_workflow_rollback.sql
```

The test covers anonymous and authenticated execution, direct-table denial, two-tenant organization and subject-reference isolation, valid/cross-tenant/nonstaff/inactive owner assignments, individual and organization routing, unknown-to-affirmative affiliation promotion and staff-false preservation, fixed subject-only roles, raw history, exact replay, payload mismatch, rolling rate limiting, strict validation, ambiguous matching, immutable profile-linked identities, approved blank-field enrichment, and Auth/profile non-interference.

## Rollback

Run `website_bty_nomination_workflow_rollback.sql` to revoke and remove the wrapper and its scoped rate index. This stops new intake without deleting accepted raw/canonical data. The rollback intentionally preserves `bty_nominee`, because it is a shared canonical role that already exists in production and can remain referenced by accepted records.

The rollback also intentionally preserves the tenant-policy hardening and anonymous table revocations. Stopping one public intake route is not a reason to restore cross-tenant staff access or direct anonymous canonical-table privileges.

Rollback must not delete submissions or relationship records, change `profile_id`, create or delete Auth users, reactivate legacy Auth-creating functions, or alter unrelated table/RLS grants. Reconcile accepted submission counts and Auth/profile fingerprints after any production rollback.
