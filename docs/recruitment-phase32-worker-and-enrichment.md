# Phase 32 — Recruitment Delivery Worker (LOCKED OFF) and Contact Enrichment

## Delivery implementation
- New Supabase Edge Function `recruitment-delivery-worker`, protected by a service-role bearer token; it rejects ordinary CRM/browser JWTs.
- The worker has two independent execution guards: `RECRUITMENT_WORKER_EXECUTION=enabled` in its server environment AND `crm_recruitment_send_control.execution_enabled=true AND approved_test_only=true`. **Both database switches have immutable CHECK constraints requiring false** in this phase. There is **no cron or scheduled function invocation**.
- `action=status` safely reports these enabled/disabled flags; `action=run` returns `mode:disabled, claimed:0, sent:0` while they are off. Even a service role cannot claim mail while the database is locked off.
- Server-only SQL RPCs `crm_recruitment_worker_claim`, `crm_recruitment_worker_recheck`, `crm_recruitment_worker_finalize`, `crm_recruitment_worker_reap_expired` implement short leases, SKIP LOCKED, retained `crm_email_messages` rows, stable Resend idempotency keys, bounded attempts, and fail-closed recording.
- Claims require confirmed account-sender configuration, documented contact authority, staff-verified unique email identity, ready/not-contacted status, no replies, no suppression, and prior step acceptance before a follow-up.
- The worker checks eligibility immediately before the external network boundary. Unexpected network errors or 5xx are marked **uncertain** and never blindly retried. Provider-declared rate limiting can retry with the same stable idempotency key. Expired leases are likewise **uncertain**, not automatically retried. A future manual reconciliation process remains necessary for uncertain outcomes.
- Resend email payload uses the existing configured marketing sender and provider inbound address, a CRM-tagged reply-to, a physical postal address, and a recipient-specific opt-out link. External delivery is not invoked by the current locked-off configuration.
- `recruitment-unsubscribe` is a public token-verification endpoint; GET only displays confirmation, POST consumes an opaque hashed token and creates an email suppression and closed recruitment state. A one-click POST from the mail client is supported. Token values are never stored in plaintext in the database.
- Outbound replies are ingested through the existing `crm-resend-email` webhook and matched only to a unique, manually verified prospect. The existing Phase 31 cancellation and bounce reconciliation triggers remain in place.

## Evidence-based email enrichment
- `crm_recruitment_email_enrichment` stores staff proposals with HTTPS professional-directory source and detailed identity evidence.
- The prospect detail page shows **Therapist contact enrichment**, pending proposals and explicit reviewer Accept/Reject decisions.
- Accept updates the source email only if the prospect had no valid address, no duplicate address exists, the email is not suppressed, and the prospect is not blocked.
- The resulting email remains **unverified**, and any previously recorded contact authority is reset to `unknown`. It does not enroll, email, message, or automatically mark the prospect reachable for outreach.
- All APIs are tenant scoped and require actual staff membership and relationship management permissions. Sensitive tables have RLS enabled and no direct anonymous/authenticated grants.

## Verification performed
1. Under service_role impersonation, the locked-off claim returns `[]` and the lease reaper returns 0.
2. The authenticated/browser role is denied the worker claim RPC.
3. A staff-role, rollback-only test submitted a synthetic professional email, reviewed it, confirmed it remained unverified, and verified another tenant could not read the proposal.
4. A transaction-only test redeemed a token for the *original* recipient, stopped held work, suppressed the original address and verified a second redemption is idempotent.
5. Client-side unit tests check the independent delivery gates, ambiguous response handling, reply tags, HTML escaping and unsubscribe/footer content.
6. No test emails were sent; all synthetic rows and contacts were rolled back.

## Before any real email, still REQUIRED
- Explicit user authorization for named internal test recipient(s), recipient-domain allowlist, sender identity, and exact test content.
- Verified deployment and connectivity of the provider email sender, provider webhook and both Edge Functions, with test inbox access.
- An explicit future approval migration to remove the two CHECK constraints, with minimum-per-run limits, test allowlist, metrics and rollback procedure; runtime env switch enabled only after review. No such activation migration is included here.
- Provider acceptance/reconciliation and retries must be tested with *authorized internal addresses* before campaigning to therapists.
- Audit of professional recruitment consent and opt-out requirements with legal/compliance input. Public listings do not automatically authorize recruitment email.
- Final review of provider event/bounce detection and account sending limits. A Resend delivery ID alone is not evidence of inbox arrival.

## Browser QA
1. Open `https://crm.valorwell.org/crm/recruitment/prospects` and select a record lacking email.
2. Find **Therapist contact enrichment** and verify the proposal form is visible. No need to submit a fake email.
3. Find **Recruitment delivery safeguards**: no automatic permission approval or send button appears.
4. All email/SMS campaigns stay paused. The worker has no cron and cannot send.

The above is a partial *pre-activation* implementation, not an assertion that live provider dispatch has been tested.
