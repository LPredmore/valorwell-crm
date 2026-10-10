# Clinician recruitment sequences and inbound reply processing

## Deployment
The `/crm/recruitment/sequences` page is an **offline planning workspace**. It does not use existing sendable CRM campaigns. All records are stored separately in `crm_recruitment_draft_sequences` and `crm_recruitment_draft_steps`, with no activate, schedule, enroll, send, or SMS integration.

- Staff may save drafts containing 1–6 plaintext email steps with per-step delay days (0–90), optional state code and license type filtering.
- Server-side draft preview reports matching source counts, email quality, manually verified identity, technical eligibility, and **0 approved-for-sending**. It never creates recipients or schedules.
- Email address format and manual identity verification **are not** legal marketing consent. No recipients are approved merely by appearing in preview.

## Incoming clinician reply handling
Existing `crm_email_messages` ingestion from the authenticated/provider-managed `inbound_webhook` path is the source. The new database trigger handles INSERTs of `inbound/received` records only.

- Match exact, normalized valid sender email to **one** tenant prospect with an existing manual email identity review of `verified`. Duplicate or unverified source addresses cause no automatic match.
- Classify as `possible_interest`, `possible_decline`, `needs_review`, or `opt_out`. Interest and declines are **suggestions**, not autonomous prospect decisions.
- Create deduplicated `crm_recruitment_inbound_triage` entries linked to source message IDs. Add a review next action for an active prospect, without modifying an existing due date.
- Strict, unambiguous first-line opt-outs such as `Unsubscribe` create an email-scoped suppression and close/block the matched prospect immediately. Do not reopen an already closed or linked applicant for an ordinary reply.
- Reviewers see the pending queue and choose Confirmed Interested, Declined, Unsubscribe, or Not Relevant. Declines/opt-outs create lasting email suppression; interest advances recruitment progress and creates a follow-up. Decisions do not send any messages.
- Triage messages appear in the per-prospect communications timeline, with tenant-scoped authorization.
- Existing provider inbox integrations must continue ingesting messages. This trigger **does not** prove that every external reply reaches the CRM; live webhook and delivery validation is still required.

## Production hold and acceptance
All previously disabled campaign crons (17,22,36,99), CRM/registry/relationship campaign execution flags, triggers and active enrollments must remain disabled. Do **not** enable any or send tests without explicit authorization.

Acceptance:
1. Directory link to Recruitment Sequences & Replies works for CRM staff.
2. Create an internal draft with two steps. Save, reload, and preview; confirm `approvedForSending:0` and no message dispatched.
3. Without sending, confirm reply list empty until a manually verified unique sender receives a real provider-ingested reply.
4. Synthetic inbound messages can be tested only inside an explicit rolled-back DB transaction; ensure opt-outs suppress, duplicates do not create additional triage, and no real mail sends occur.
5. Test cross-tenant denial and unauthenticated access, then recheck all outbound kill switches.
