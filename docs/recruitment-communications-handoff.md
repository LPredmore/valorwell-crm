# ValorWell clinician recruitment: communications and handoff

## End-user workflow
1. Open `/crm/recruitment/prospects`, locate a prospect by name/state and open their detail page.
2. The **Recruitment communications timeline** displays: audited prospect changes, recruiter-logged activity, and available existing CRM email history **only when** the source identity is safely matched. Linked existing applicants also contribute email-status and applicant activity history.
3. To record an interaction that **already occurred**, choose channel (phone, LinkedIn, email, SMS, meeting, etc.), direction, outcome, and recruitment progress; describe what happened and click **Record activity (no sending)**. This is an internal database write, **not** a call/text/email.
4. Recruitment stages: Not yet contacted → Contact attempted → Responded → Interested → Application handoff discussed → Existing application linked; Closed is available for exits. The pipeline board reflects these stages without changing actual provider applicant statuses.
5. **Application handoff discussed** requires a recorded handoff activity; it is not proof an invitation was sent. The **Existing application linked** stage is assigned automatically **only** after the reviewer verifies and links an existing applicant matching a source email or phone.
6. If a clinician has not yet applied, use the established external application process; do not create a fake application or mark them applied. Actual application/email-invitation automation is **not** enabled here.

## Technical controls
- Private `crm_therapist_prospect_contact_events` is tenant-keyed, version-checked, append-only through an authorized RPC with unique client action IDs to guard duplicate requests.
- `crm_recruitment_log_contact` rejects stale prospect versions and unsupported stages; caller must have tenant staff membership + `edit_relationships` permission. No send, queue, campaign or enrollment calls exist in it.
- `crm_recruitment_communication_timeline` requires tenant staff membership + `view_relationships` permission. Returns at most 100 entries: activity, audit history, linked-applicant email/activity, and relationship emails matched to a **manually verified, unique** prospect email. Subject/sender/recipient and at most 900 characters of email text are surfaced; no arbitrary unverified name matching.
- Linked applicant association continues to enforce matching normalized valid email or phone, unique tenant FK and audited source link, then updates prospect progress to `applicant_linked`; it doesn't create or invite an applicant.
- Prospect board previews recent records; the full directory remains server-paged. Activity is an internal record, not evidence of marketing consent.

## Outbound lockout
All email/SMS campaign execution remains disabled until **explicit user approval**: CRM campaign/registry/trigger flags off, existing enrollments paused, relationship campaigns disabled, cron jobs 17/22/36/99 inactive. Don't alter routine clinical or transactional notifications.

## Acceptance checklist
- Logged-in authorized user can load timeline and see prior audit records.
- Log a clearly marked **test internal note** (channel Internal, direction Internal, outcome Internal note); refresh and confirm activity and audit appear and progress persists.
- Existing applicant matching: compare a real existing applicant; if no exact match, the interface correctly reports no applicant and never creates one.
- Attempted cross-tenant/read-only access must be denied, stale updates rejected, repeated client action ID handled idempotently.
- No outbound message sent, no campaign enabled. Testing real reply reception/sending requires separate explicit approval and verified internal recipients.

Deployment status must be checked independently of GitHub merge; this document does not assert web QA has passed.
