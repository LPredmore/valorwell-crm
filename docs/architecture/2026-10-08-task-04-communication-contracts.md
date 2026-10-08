# CRM Modernization — Task 04: Communications, campaigns, replies and newsletter contracts

**Audit date:** 2026-10-08. **Scope:** existing ValorWell CRM, Billing Hub `ahqauomkgflopxgnlndd`. Read-only source/SQL inspection; **no email sent, campaign activated, cron modified, mailbox accessed, or production send states reset**.

## Four distinct delivery domains currently exist
| Domain | UI/logic entry points | Production tables/RPCs/workers | Observed baseline |
|---|---|---|---|
| Clinical/client campaigns | `src/pages/crm/CampaignManagementPage.tsx`, canonical campaign pages, `src/repositories/supabase/campaigns.ts` | `crm_campaigns`, `crm_campaign_steps`, `crm_campaign_enrollments`, `crm_campaign_step_logs`, `supabase/functions/campaign-scheduler/` | 9 client campaigns; enrollment statuses include 390 responded, 26 completed, 23 cancelled, 6 active, 1 paused |
| Non-clinical relationship/BTY outreach | `src/pages/crm/business-development/campaigns/`, `src/repositories/supabase/relationships-campaigns.ts`, `relationships-enrollments.ts` | `relationship_campaigns`, `relationship_campaign_steps`, `relationship_campaign_enrollments`, `relationship_communications`, `relationship_replies`, `relationship_suppressions`, `supabase/functions/relationship-campaign-worker/` | 3 active relationship campaigns; 290 enrollments: 108 active, 163 completed, 10 responded, 9 suppressed; 595 communications |
| Provider applicant initial communication | Existing provider applicant lifecycle and background communication worker | `provider_applicants`, `crm_provider_applicant_communication_jobs`, `supabase/functions/provider-applicant-communication-worker/`, `crm_claim_provider_applicant_communication_jobs` | 35 provider applicants; dedicated cron every 5 minutes; distinct from cold-prospect campaign |
| Newsletters/direct email & staff email | `NewsletterManagementPage.tsx`, `EmailStudioPage.tsx`, `src/lib/crm/newsletter-control-plane.ts`, CRM communications inbox | `crm_newsletters`, `crm_newsletter_recipients`, `crm_newsletter_suppressions`, `crm_email_messages`, `crm_email_events`, `crm_resend_email_settings`, `supabase/functions/newsletter-send-worker/`, `crm-resend-email/` | 4 newsletters: 2 completed, 1 draft, 1 failed; 1 shared mailbox suppression currently present |

`crm_campaign_registry` contains 12 rows and `crm_campaign_concurrency_groups` contains 8: these are candidates for *management-plane aggregation*, not a reason to write all domains into a single enrollment/step-log table. Existing `crm_people` registry currently has zero rows. Code and previous design documents distinguish relationship campaigns from clinical client campaign enrollments.

## Operational controls and event evidence
- Scheduled jobs observed active: `campaign-scheduler-15min` (every 15 min), `campaign-trigger-worker` (every 5 min), `newsletter-send-worker-every-5-min` (every 5 min), `provider-applicant-communication-worker` (every 5 min), `relationship-campaign-worker` (every minute).
- In the sampled Oct 8 two-hour window, pg_cron metadata showed successful invocations of relationship, campaign and newsletter jobs. **Cron success means dispatch ran, not that email was delivered**. Delivery must be determined from communication/provider events.
- `relationship_communications` statuses: **516 delivered, 31 sent, 34 received, 9 bounced, 5 failed** (595 total). These are mail/communication outcomes; don't interpret received as proof of contact positive intent.
- `relationship_replies` 34, `relationship_communication_events` 2,234, `relationship_message_observations` 386, `crm_email_messages` 36 and `crm_email_events` 39. They are related but not necessarily one-to-one records.
- `supabase/functions/relationship-campaign-worker/index.ts`: worker authorization, `claim_relationship_campaign_work`, prepared communication/idempotency key, Resend send, retry/fail work completion and unsubscribe URL.
- `supabase/functions/relationship-resend-webhook/index.ts`: Resend Svix signature verification, inbound reply metadata and `ingest_relationship_inbound_reply`; existing code includes a tenant constant in this specific handler and warrants per-event attribution/tenant-safety tests before generalizing it.
- `supabase/functions/provider-applicant-communication-worker/index.ts`: dedicated service worker, Resend/RingCentral transport and tenant Resend settings, not a generic therapist prospect campaign.
- `supabase/functions/newsletter-send-worker/index.ts`: newsletter delivery renderer, `validateNewsletterTemplateContract`, stable provider idempotency keys, retry/failure classification, `List-Unsubscribe` and `List-Unsubscribe-Post` headers, scheduled recipient claims. For newsletter, runtime/missing merge tags and failed recipient handling are high-value regression tests.

## Communications ownership contract (recommended)
1. **One visible Campaigns area**, with explicit domain/source selectors: Relationship Outreach, Therapist Recruitment (a relationship/prospect variant after eligibility reconciliation), Client Campaigns, Newsletters, Staff Broadcasts. Preserve underlying ownership and permissions.
2. **One visible Communications area** provides navigable index/timeline, but write/read stays source-scoped. Link only verified message IDs, campaign IDs, enrollment IDs and related contact/org/applicant identities. Do not duplicate communication events when aggregating them into a view.
3. **Cold therapist prospects are not equivalent to provider applicants**. Initial recruitment sequence should use approved marketing eligibility and likely relationship campaign mechanism after Task 25 reconciliation, never auto-enroll raw `therapist_outreach_prospects` rows.
4. **Suppression must be checked at actual send time** as well as enrollment: relationship `relationship_suppressions`, mailbox `crm_newsletter_suppressions`, bounce/complaint/unsubscribe, and existing per-client communication policies are distinct mechanisms. Do not overwrite the narrow domain-specific suppression rules with a global booleans table.
5. **Reply stops follow-up sequence** only through the authoritative provider-message→communication→enrollment correlation and backend state transition; use idempotent, tenant-safe processing with manual exception queue for ambiguous replies.
6. **Template validation before queueing**: reject unknown merge tags; provide clear, terminal or recoverable failed states; enforce no permanently stuck sending. Validate all sequences with internal test mailbox and confirm newsletter, client and BTY paths still work.

## End-to-end trace contracts and checks to preserve
**Relationship outreach:** UI/editor → relationship campaign + steps → validated audience/enrollment & suppression → claimed work item → Resend with idempotency key → provider status event → `relationship_communications` / `relationship_communication_events` → inbound webhook `relationship_replies` / enrollment stop/action.

**Client campaigns:** CRM management → `crm_campaigns` / `crm_campaign_enrollments` → scheduler/trigger worker → clinical transport → CRM message and event store → per-client reply/stop policy. No relationship-domain table mutations by default.

**Provider applicant first contact:** actual provider applicant onboarding trigger → provider applicant communication jobs → worker claim/idempotent email or SMS → applicant activity/history. Do not use raw cold-prospect staging in this path.

**Newsletter:** Email Studio draft/template → `crm_newsletters` → audience preview, suppression and recipient snapshot → scheduling → claimed recipients → per-recipient render/merge-tag validation → Resend with stable idempotency key → event ledger/finalize/fail state; subscriber mailbox unsubscribe persists correctly.

## Task 04 acceptance
- **PASS:** identified entry pages, tables, workers, cron intervals, observed aggregate states and provider reply/suppression ownership.
- **PASS:** specified a contract for proposed therapist campaigns and an explicit plan to preserve current engines during navigation redesign.
- **NOT EXECUTED:** live delivery/reply test (would send or use real mailboxes); queue failure injection, newsletter unknown-tag E2E, RBAC negative tests. Those are the dedicated Task 28–29/33/35 testing gates; no live sends authorized by this audit.
- **Risk:** a completed cron invocation is not evidence that a recipient was delivered; use per-message provider IDs/events.
