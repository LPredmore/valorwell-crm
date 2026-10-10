# Clinician recruitment review and campaign hold

## Scope
The source of truth remains `therapist_outreach_prospects`. Provider applications remain in `provider_applicants`. The CRM review overlay does not create clinical accounts or applications.

The candidate queue is `/crm/recruitment/prospects`; details are `/crm/recruitment/prospects/:id`. Tenant-scoped RPCs enforce authenticated staff + CRM relationship permissions. Direct grants on staging and review/event/link tables remain revoked.

## Working a prospect
1. Filter by stage, state, contact quality, owner, or next-action due date. Filters execute server-side **before** pagination.
2. Review the profile's source email/phone and quality warnings. A "possible match" is not an identity match; do not merge on name alone.
3. Record a next action, due date, internal notes, and a reason. Edits are version-checked and audited.
4. Verify email identity only after a human checks source evidence. Verification is **not** consent or delivery permission. Missing, malformed, and suppressed email cannot be marked verified.
5. Link to an existing applicant only when a matching normalized email or phone exists and human review confirms the identity. A link never creates an applicant or invitation. Source email/exclusion updates invalidate previous email verification.
6. Review the read-only campaign preview. `technicallyReady` is a pre-send technical readiness count, **not** a marketing consent determination or send instruction.

## Campaign hold (must stay disabled until explicit authorization)
During implementation, Billing Hub scheduled campaign workers 17, 22, 36 and 99 were disabled. `relationship_campaigns.execution_enabled`, `crm_campaign_registry.is_active`, `crm_campaigns.is_active`, and `crm_campaign_triggers.is_active` were disabled and five prior active CRM enrollments paused. Relationship campaign enrollment delivery flags remain false. Do not enable these systems for QA or start bulk mail/SMS.

Do not touch unrelated clinical, transactional or appointment notifications. The preview and qualification RPCs do not enqueue, enroll, send, or alter outbound communication. The CRM does not expose a campaign send control in this recruiter workspace.

## Readiness and known source quality
Historical staging: 1,279 prospects. 1,039 missing emails, 32 malformed placeholder emails, 2 duplicated valid-email rows, 206 unique valid-email records. Two source records are excluded. No existing applicant or relationship-contact records had exact matching source emails or phone numbers at the initial reconciliation. Do not treat `outreach_contactable=true` as legal consent.

## Next safety gate
An end-to-end test involving actual email or SMS delivery requires a **separate, explicit approval** and controlled internal test recipients. Before any sends, independently verify opt-outs, channel consent, sender configuration, reply linkage, bounce/unsubscribe ingestion, and campaign-trigger idempotence. Until then, Phase 29 remains unverified for real delivery.
