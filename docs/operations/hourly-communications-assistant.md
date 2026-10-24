# Hourly communications reconciliation — production record

**Scope:** Gmail and RingCentral SMS, CRM reconciliation, inbox review tasks, GLM-5.3-Flash aggregate health analysis. Excludes BTY video production.

## Architecture

- Existing Gmail Pub/Sub push and the established hourly Google-maintenance cron remain the **source ingest** and reconciliation path. Do not create a second independent Gmail cursor.
- Cron `valorwell-hourly-comms-audit` runs at minute 36 every hour and invokes `valorwell-hourly-comms-audit` with an `X-Cron-Secret` fetched from Supabase Vault. The Edge function authenticates before querying.
- The assistant invokes `valorwell-ringcentral-business-sms-reconcile` (up to 48h) and checks only **inbound messages addressed to the configured ValorWell business number**. The authoritative RingCentral message ID is unique in `crm_inbound_sms_logs`. It never guesses a client or applicant identity.
- `valorwell_hourly_comms_triage_v1` reads recent CRM inbound correspondence, creates a review case exactly once per source record, and creates an ordinary review task assigned to the CRM administrator. No direct relationship task writes are attempted: `private.crm_validate_relationship_task_subject` deliberately enforces an authorized user session.
- The assistant measures Gmail, RingCentral, outstanding CRM issues, and database cron health. **Only non-identifying aggregate metrics** are sent to OpenRouter `z-ai/glm-5.3-flash`. No SMS contents, email bodies, patient identifiers, phone numbers, or actual message IDs go to the AI provider.
- No automatic sends, invoice changes, claim submissions, or human identity guesses are permitted.

## Verified production acceptance (2026-10-23 Central)

- Cron #113 hourly GLM calls logged `status=ok`.  
- New inbox task workflow created 3 Gmail follow-ups; repeated run created 0 duplicate tasks.
- Inbound RingCentral provider source comparison identified 1 business-number SMS absent from CRM. The safe 7-day provider read-back imported it into `crm_inbound_sms_logs`. Duplicate replay showed `existing=1`, `imported=0`.
- Subsequent CRM triage created 1 SMS review task. Total verified review cases: 4.
- Hourly assistant `sync_probe` HTTP 200 with `ok=true`, no duplicate review tasks.
- RingCentral webhook callback `Validation-Token` challenge returned HTTP 200, echoing token and JSON content type.

## Unresolved provider configuration

RingCentral subscriptions API lists zero active event subscriptions. Registration returns `HTTP 403`, error `SUB-528`, missing application permission **`SubscriptionWebhook`**. The app owner must enable this scope in RingCentral Developer Console. Until then the hourly business SMS read-back is the fallback. The webhook token ledger persists only a SHA-256 digest of its verification tokens.

## Migration/source ownership

This branch mirrors production Edge functions and three database schema/function migrations. Remaining application-independent migrations (clinical billing/appointments/matching triggers, claim batch timezone gate, cron retention) are recorded in Supabase's version ledger and must be reconciled by the designated schema-owner repository. Do not replay the migration ledger blindly across Client/Staff/Billing/CRM repos. Align each migration version with the current Supabase ledger before CI/CD.

## Safeguards

- Production worker cutovers must retain recovery schedules until a real event-to-CRM acceptance test passes.
- Avoid direct sends or subject/person inference solely on AI model output.
- Error/exception reviews should be linked to authoritative evidence; an unmatched message ID alone does not justify guessing a relationship.
- Do not log any provider API token, email/SMS body, or phone number.

## Follow-up implementation (same deployment)

- `valorwell-hourly-comms-audit` v11 now invokes the business-number SMS reconciliation before triage, creates idempotent CRM follow-up tasks, and includes `valorwell_hourly_operations_health_v1` queue health with recent vs historical appointment failures differentiated.
- `valorwell-ringcentral-business-sms-reconcile` v5 invokes `valorwell_link_sms_unique_applicant_v1` only when exactly one applicant and no client matches an inbound business SMS. It calls the existing idempotent CRM RPC `staff_record_provider_applicant_response`; message contents stay in CRM. One recovered SMS was safely linked to exactly one applicant, with one recorded response event. The associated RingCentral CRM sync issue was marked resolved. The webhook permission issue remains open.
- `crm-applicant-email-recovery` v1 is CRM-owned, imports the existing source-verified Resend retry and reminder logic, and passed the authenticated empty-queue smoke test (200, zero failures). Previous cron #109 was unscheduled and replaced atomically with `crm-applicant-email-recovery-hourly` (job #114, minute 29). **The initial website invitation send remains immediate and website-owned; only retry/reminder dispatch moved to CRM.**
- The assistant's completed full model cycle returned HTTP 200 `status=ok` with `z-ai/glm-5.3-flash`, 1 additional CRM review task, and zero automated outbound sends. CRM tasks and review cases have duplicate-protected source IDs.
- Production-only changes beyond this PR remain tracked separately: appointment and billing event triggers, matching trigger, daily Claim.MD gate, cron-history retention, and ancillary cron schedules. Verify schema owner and migration history before syncing those into another repository.

### Known acceptance limits

Natural future user actions are needed to verify delivery of an applicant reminder and the complete clinical/appointment/matching path. Never send a synthetic applicant email, claim submission, or fake patient booking as an acceptance test. OpenRouter receives non-identifying aggregate signals only; actual message-body semantic analysis requires approved healthcare-data handling and additional privacy controls. The app's `SubscriptionWebhook` permission still requires RingCentral console authorization.
