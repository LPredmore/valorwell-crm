# Recruitment Phase 31 — Delivery Planning and Hard Hold

## Scope and safety
This implementation prepares **HELD** email delivery plans from draft recruitment sequences, connects them to the existing `crm_email_messages` and `crm_email_events` provider ledgers, and automatically stops unsent followups in response to inbound replies, unsubscribes, invalid contact status, suppressions, and relevant bounces/complaints.

**It intentionally does not send email, call Resend, invoke a campaign worker, create a cron, activate a campaign, enroll recipients in CRM campaigns, or send SMS.** This is the approved safe boundary until an explicit separate live-delivery authorization.

`crm_recruitment_send_control.execution_enabled` has a CHECK constraint requiring `false`. There is no public send/claim endpoint. Backend RPC responses report `canSend:false`. The *existing* CRM/relationship campaign workers and enrollments were not altered.

## Data model
- `crm_recruitment_contact_permissions`: explicit human-recorded outreach authorization basis/evidence; missing entries are `unknown`. The form is **not** an opt-in collection mechanism.
- `crm_recruitment_delivery_plans`: immutable identity/recipient snapshot per tenant, sequence and prospect; unique key prevents duplicate plans.
- `crm_recruitment_delivery_steps`: snapshot of each draft step, cumulative relative delay due date, event linkage to `crm_email_messages`, state and error metadata. All new steps begin `held`.
- `crm_recruitment_delivery_attempts`: future per-step retry/idempotency audit slots, no active worker. Attempts are uniquely keyed on tenant + step + attempt number AND tenant + idempotency key; the provider sender is **not** live.
- `crm_recruitment_send_control`: forced-off hard guard.
All tables have RLS enabled and direct anonymous/authenticated grants revoked. Authenticated browser RPCs require staff tenant membership plus appropriate CRM relationship permissions. Internal triggers are in privileged functions and are not callable by browser roles.

## Eligibility preflight
Individual gate verifies: source membership and tenant, unique valid email, human identity verification, explicit documented email contact permission, correct Ready/Not Contacted stage, non-excluded source, draft state/license targeting, existing applicant/contact matches, prior outbound sends, any inbound reply, bounce or complaint history, existing plans, and active global/email/newsletter/contact suppressions.

A passing gate allows **creating a held plan only**, never sending. Re-run server gate at staging under source row and contact permission locks. Plans snapshot text from their original draft; editing a draft doesn't mutate held steps.

## Automatic stops and provider reconciliation
- `crm_recruitment_inbound_triage` insert cancels every HELD follow-up for that prospect.
- Workflow changes away from Ready, Not Contacted or verified identity stop held steps.
- Source address or exclusion changes, consent revocation, or incoming global/email suppressions stop held steps.
- For any real `crm_email_events` attached to a staged recruitment step via `email_message_id`, mirror sent/delivered/bounced/complained/failed outcomes. Bounces and complaints cancel held follow-ups and register email suppression. **Do not** mark a held item as sent merely because a stray event refers to its message ID.
- Explicit authenticated-provider inbound unsubscribe or a provider bounce for a known prospect email also records email-scoped suppression even if identity verification is incomplete. These safeguards do not send messages.
- All provider/reply event processing is transaction-safe and idempotent through provider event uniqueness, plan uniqueness, and existence checks. No polling/sending worker is enabled.

## Test/acceptance boundaries
Verified in synthetic **rolled-back transactions**: default gate denial, permission evidence required, eligible HELD staging, two-step relative timing, duplicate plan prevention, automatic cancellation following verified reply, event-ledger bounce reconciliation, bounced-address suppression, and unverified explicit opt-out blocking. No test sent mail and no production sample contact permission was persisted.

The next explicit approval milestone is a controlled provider-to-internal-recipient delivery test. Before that, a sender adapter and its authorization/lease/retry implementation require additional review and a separate activation migration; actual Resend sending and live webhook reachability have **not** been tested by this Phase 31 work. Real consent and list enrichment remain unfinished.

## Browser smoke tests
1. Visit `https://crm.valorwell.org/crm/recruitment/sequences`, select an existing saved draft and inspect **Delivery planning and event reconciliation**. Timing should show each step and zero held steps unless you explicitly documented a verified contact and staged a plan. The banner should state delivery is disabled.
2. Visit any prospect detail page and look for **Recruitment delivery safeguards**. Select a sequence: the full list of ineligibility reasons should appear. Do not mark permission Approved without genuine documentary evidence.
3. Confirm campaign configuration/worker controls remain disabled before and after. Do not send an email or SMS as part of this UI test.
