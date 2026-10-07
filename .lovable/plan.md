# Newsletter Reliability: State Machine Consolidation

Goal: one authoritative newsletter lifecycle so no newsletter can get stuck at "Sending", every failure shows a clear reason in the CRM, and every Schedule button follows the same rules. No newsletter is in flight in production right now (1 completed, 1 draft), so this is a preventive repair with no recovery step needed.

## Findings confirmed against current code
- The Communications Control Plane page imports its own `scheduleNewsletter` / `cancelNewsletterSend`, which skip variable validation (Finding 1).
- The worker's direct `newsletterId` wake path skips `crm_claim_due_newsletters` and calls the recipient claim while the newsletter is still `scheduled` (Finding 7).
- When the worker finds an invalid template it logs `template_invalid` and continues, leaving the newsletter at `sending` (Finding 3).
- The worker never calls `crm_newsletter_recipient_send_guard` before sending through Resend (Finding 6).
- Findings 2, 4, 5 and 8 depend on the live function bodies and constraints. Step 0 re-reads them, and any finding that no longer holds is dropped.

## Phase 0: Verify live state (read-only)
Read the live definitions of `crm_schedule_newsletter`, `crm_claim_due_newsletters`, `crm_finalize_newsletter`, `crm_newsletter_recipient_send_guard`, `crm_newsletter_worker_status`, `crm_communications_observability`, the `crm_newsletters` and recipient status constraints, and the cron job names. Search the Clients, Staff, Billing, Onboarding and CRM projects for any reads of `crm_newsletters.status` so the new `failed` status can't break another app.

## Phase A: One client contract
- `communications-control-plane.ts` re-exports the newsletter operations (schedule, cancel, list, get, preview, trace, audience domains and labels) from `newsletter-control-plane.ts` instead of keeping its own copies.
- The Control Plane page then gets the same validation as Newsletter Management.

## Phase B + C: Authoritative backend preflight and a failure state (one migration)
- Additive: `crm_newsletters` gains the status `failed` plus nullable `failed_at`, `failure_code` and `failure_message`. The status check is widened, not replaced.
- New `private.crm_newsletter_template_preflight(newsletter_id)` checks subject, preheader, HTML and text for unknown, disallowed or malformed tags. It uses the same allow-list and aliases as the shared contract.
- `crm_schedule_newsletter` calls the preflight and rejects bad content with a clear message, so no caller can bypass it.
- `crm_finalize_newsletter` sets `completed` when at least one recipient was sent, and `failed` (code `all_recipients_failed`) when every recipient failed.
- New `crm_fail_newsletter(id, code, message)` (service role only) moves a newsletter to `failed` and stands down its pending recipients.

## Phase D + F: One claim path and recoverable `sending`
- `crm_claim_due_newsletters(p_limit, p_newsletter_id default null)` becomes the single claim path. Cron passes no id and the wake trigger passes one. Both take ownership atomically and move the newsletter from `scheduled` to `sending` only after the preflight passes. If the preflight fails, the newsletter goes straight to `failed`.
- A reconciliation step runs at the start of every worker invocation:
  - stale `processing` recipients are released back to `pending`, using the existing lease or an age threshold;
  - `sending` newsletters with no pending or processing recipients are finalized;
  - `sending` newsletters with zero recipients are failed with code `no_recipients`.
- The worker drops its hand-built direct-wake entry. If the worker's own template check still fails, it calls `crm_fail_newsletter` instead of `continue`.

## Phase E: Final send guard
- Before every Resend call, the worker calls `crm_newsletter_recipient_send_guard`. If it returns `allowed = false`, the worker skips the send, keeps the guard's recipient state change, and moves on.

## Phase G: Monitoring
- `crm_communications_observability` counts `processing` instead of the nonexistent `claimed`.
- `crm_newsletter_worker_status` joins `cron.job_run_details` to `cron.job` by `jobid`, uses the real job name, and adds `sending`, `stuckSending` (older than 30 minutes with no active work), `failed`, `processingRecipients` and `lastStatus`.
- Newsletter Management shows an error state when the worker status query fails, shows a red "Failed" badge with the failure reason, and shows the stuck count.
- Failed newsletters can be duplicated to a new draft (the existing clone action).

## Phase H: Lifecycle tests
- Vitest: extract the worker loop into a testable module that uses a fake database client and a fake Resend. Cover the report's cases: scheduling through both pages, the preflight variants, the state transitions (draft through completed, preflight failure, all failed, mixed results, cancel while scheduled or sending), crash recovery (stranded `sending`, stale `processing`), races (cancel, suppression or runtime pause after claim, already sent), retries (network, 429, 5xx, permanent 4xx, max attempts, same idempotency key), and the cron and wake paths sharing one claim.
- SQL contract test (`supabase/tests/newsletter_lifecycle_contract.sql`): the preflight rejects bad tags, finalize returns `failed` when all recipients fail, reconciliation completes a stranded `sending`, and the worker-status query runs.
- Run the full suite, typecheck and lint.

## Rollout
Apply the migration, then deploy `newsletter-send-worker`, then publish the CRM. Verify live with one real test newsletter to an internal mailbox (valid content: completed). Then schedule an invalid one by calling the backend directly: it should be rejected. Read the worker-status RPC.

## Out of scope
Audience and recipient building, Email Studio editing, and the other open monitoring findings.

## Technical notes
- All database changes are additive and limited to `crm_`-prefixed CRM objects. Function signatures only gain optional parameters, so existing callers keep working.
- `failed` is a new status value. Phase 0 confirms no other ecosystem app filters on an exhaustive status list before the migration ships.
