# Creator, promoter, and community interest operations

## Purpose and ownership

The authenticated CRM owns staff review and outreach for creator, Beyond the Yellow promoter, storyteller, podcaster, connector, funder, supporter, and general community-interest records. The queue is available at `/crm/creator-community-interest`; each row opens the canonical `relationship_contacts` record and its related interest data.

This workflow deliberately does not create an application user or populate `relationship_contacts.profile_id`. A person who submits public interest remains a relationship contact unless a separate, explicitly authorized identity workflow is performed.

## Daily workflow

1. Open **Creator, Promoter & Community Interest** in the CRM sidebar.
2. Start with **Oldest unreviewed** and use review, outreach, owner, due-date, source, role, state, veteran, social, avatar, and platform filters to shape the work queue.
3. Open a record and compare the canonical contact/profile fields with the raw immutable website-submission history.
4. Correct canonical fields only when the source is demonstrably wrong. Raw `website_submissions.payload` values are history and are not edited.
5. Set one review state:
   - `review_needed`: staff decision has not been made.
   - `direct_outreach`: ready for individualized outreach.
   - `nurture`: retain for a future campaign or check-in.
   - `not_relevant`: legitimate submission outside this program.
   - `duplicate`: duplicate that should not be worked separately.
   - `invalid_spam`: invalid or abusive submission.
   - `managed`: review is complete and the record is actively managed.
6. Use the existing outreach lifecycle (`new`, `reviewing`, `contacted`, `engaged`, `waiting`, `closed`, `do_not_contact`) to record communication progress. Review state and outreach status answer different questions; do not substitute one for the other.
7. Assign an owner, record the next action and due time, and add internal interaction notes. Notes are stored in the existing `crm_notes` model through `relationship_contact_id`.
8. Add or remove a role only when the contact’s expressed interest supports it. Do not infer partner or engagement status.

## Security invariants

- The route is nested under `CrmLayout`, which redirects unauthenticated users to `/auth` and derives the active tenant and capabilities from the server-authoritative CRM operating context.
- Every read and mutation made by these screens includes the active `tenant_id`; detail reads also require the requested contact ID. Canonical contact/profile corrections use one allowlisted database RPC so both halves commit or fail together.
- Read-only CRM users can inspect records but cannot see active mutation controls. Every mutation hook independently fails closed unless the session has the `mutate` capability.
- Browser code uses the public Supabase client only. It never contains a service-role or secret key.
- Existing row-level security remains the final authorization boundary. UI capability checks are defense in depth, not a replacement for RLS.
- Staff owner options are obtained through tenant-filtered `staff` rows and their linked profile email. Global profile enumeration is not performed.
- Public submission payloads are displayed as escaped text through React/JSON serialization; they are never inserted as HTML.
- Source records and raw submissions are preserved for traceability. CRM corrections update canonical fields, not historical payloads.

## Data relationships

- `relationship_contacts`: identity-free canonical contact, owner, review state, outreach lifecycle, and next action.
- `relationship_influencer_profiles`: creator/promoter profile, mission, veteran connection, willingness, reach, avatar, and competition history.
- `relationship_contact_roles`: many-to-many program roles using the existing role catalog codes.
- `relationship_social_profiles`: platform, handle, link, follower count, and approval data.
- `website_submissions`: raw append-only submission evidence.
- `crm_notes.relationship_contact_id`: staff interaction notes in the existing notes model.

## Verification and monitoring

After a database or UI release:

1. Confirm an authorized operator can open the queue and only receives active-tenant rows.
2. Confirm a read-only account has no correction, workflow, role, or note controls.
3. Exercise every filter and sort, including missing avatar/social and overdue next action.
4. Open a historical creator and a new public submission; verify profile, roles, socials, source payloads, and notes reconcile with SQL counts.
5. Update owner/review/outreach/next action, add and remove a role, and add a note. Refresh and confirm persistence.
6. Confirm the contact’s `profile_id` remains null and no Auth user is created.
7. Review Supabase security and performance advisors after schema changes.

Monitor for spikes in `invalid_spam`, repeated source keys, RPC failures, queue query errors, and overdue unowned work. Investigate rather than deleting historical evidence.

## Rollback

The UI can be rolled back by redeploying pre-cutover CRM commit `7d0e3dd1f8ef0769e28b962f1236a8e993c085c2`. This hides the operating controls without altering stored relationship data.

The additive database fields should normally remain during an application rollback because they are backward-compatible and preserve staff work. If a full schema rollback is explicitly approved, first export affected `review_state` values and relationship notes, verify no other consumer uses them, then remove dependent indexes/policies followed by `crm_notes.relationship_contact_id` and `relationship_contacts.review_state`. Never drop canonical relationship tables or delete migrated contacts/submissions as part of this rollback.

If a release behaves incorrectly, stop public traffic to the new submit RPC or restore the prior website build before attempting data cleanup. Preserve source records, raw submissions, unrelated clinician/staff/client data, and Auth configuration throughout recovery.
