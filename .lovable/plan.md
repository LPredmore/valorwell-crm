# Owner-only private applicant note (plan only)

## What was checked
- `website_submissions` row `fb094479…` exists, tenant `…0001`, submitted 2026-10-15. Table has `provider_applicant_id`, `contact_id`, `source_record_key`, `payload`.
- Profile `d2dc0624…` has `tenant_memberships.tenant_role = 'owner'` in that same tenant (no `user_id` column; membership is by `profile_id`).
- `provider_applicants` holds 39 rows, with no row yet for this person. Staff owns this table and the CRM only reads it through `staff_*` RPCs (AGENTS.md and the handoff doc).
- `tenants` has no owner column. The trustworthy "owner" signal is the membership role, not `crm_admin` capability.

## 1. Which record the note attaches to
- The note **anchors to the website submission id**, because that is the only record that exists today. It gets a nullable `provider_applicant_id` that is filled in only after Staff creates the real applicant record and links `website_submissions.provider_applicant_id`.
- The CRM never creates or edits a `provider_applicants` row. When the Staff link appears, the note shows on the applicant profile through that link. The note's own row does not change.
- No name or email matching. Identity comes from ids only.

## 2. Smallest safe backend (new CRM-owned objects only)
- Table `private.crm_owner_applicant_notes`. It lives in the non-exposed `private` schema, so PostgREST cannot reach it. Columns: `id`, `tenant_id`, `website_submission_id` (FK), `provider_applicant_id` (nullable FK), `author_profile_id`, `body`, `created_at`, `updated_at`, `version`.
- RLS is enabled with no policies. `revoke all` from public, anon, authenticated and service_role (`@no-data-api`). Only the owner-run SECURITY DEFINER functions can touch it.
- Three RPCs in `public`, each SECURITY DEFINER with `search_path=''`, `revoke execute from public, anon`, and `grant execute to authenticated` only:
  - `crm_owner_note_list(p_tenant, p_submission_id, p_applicant_id)`
  - `crm_owner_note_upsert(p_tenant, p_submission_id, p_body, p_expected_version, p_idempotency_key)`
  - `crm_owner_note_delete(p_tenant, p_note_id, p_expected_version)`
- Each RPC first checks that `auth.uid()` maps to a profile with `tenant_role='owner'` in `p_tenant`. It also checks that the submission belongs to that tenant.
- For anyone else, every RPC returns the **same empty result / generic "not available"** whether or not a note exists, so non-owners cannot even detect that a note exists. Lack of permission and "no note" look identical to non-owners.
- Audit: a metadata-free event (actor, action, note id, time) goes to a private audit table. Nothing goes to `crm_activity_events`, `crm_notes`, `provider_applicant_activity_events`, `application_data` or the timelines.
- Optional extra lock-down: a private allowlist row naming the owner profile. This holds even if someone else is later given the owner role. **The current owner-role check is my assumption; please confirm which you want.**

## 3. Where it appears in the CRM
- An "Owner private note" panel on the applicant detail view (`ApplicantHandoffPage` / pipeline card detail). It also appears on the website-interest submission view until the Staff link exists.
- The panel renders only when the list RPC returns data. There is no placeholder, badge or count for non-owners.
- Notes are excluded from search, exports, email merge fields, Quick Profile, AI Ops input builders and caches. The query key includes the user and tenant, and is cleared when the tenant or user switches.

## 4. Privacy tests
- Unit tests check that the UI hides the panel when the result is empty or there is an error, that query keys are isolated, and that no export or search code references the note.
- Static SQL contract test in `supabase/tests/`, read-only:
  - the table is in `private`
  - no grants exist
  - RLS is on
  - the RPCs have no PUBLIC/anon execute and have a fixed search_path
  - the owner check is present
  - no trigger writes to activity tables
- Signed-JWT acceptance on an isolated stack only, using synthetic users with real GoTrue-issued tokens. Expected results:
  - owner: CRUD allowed
  - other crm_admin: empty, the same as for a note that does not exist
  - operator/recruiter: empty
  - the applicant themselves (as a client/staff user): empty
  - anon: denied
  - owner of another tenant: empty
  - direct REST access to the table: unreachable
  - an update with a stale version: rejected
- No real personal details go into fixtures.

## 5. Staged rollout
1. Source only: the migration file is staged, not applied, together with the RPCs, UI behind a flag (default off) and tests.
2. Five-app impact review. The new objects are additive and only in `private` and new `public` functions, with no change to Staff-owned tables. Confirm no name collisions.
3. Signed-JWT acceptance on an isolated stack. Production is not touched.
4. With your explicit approval: apply to production, verify grants with read-only checks, then turn the flag on for the owner only.
5. You enter the note yourself in the UI. I never write the note content.

## 6. Can this be done safely under the shared-schema release rules?
Yes, if it stays additive. That means one new private table, new RPCs, no changes to `provider_applicants`, `crm_notes` or `website_submissions`, and no backfill. The production migration still needs the same release gates (your approval plus signed-JWT acceptance). Until then, the code changes are UI work behind a flag plus staged SQL.

## Open questions
- Owner-role check, or an explicit allowlist of one profile?
- Should the note stay visible after Staff creates the applicant record (my assumption: yes, through the link)?
