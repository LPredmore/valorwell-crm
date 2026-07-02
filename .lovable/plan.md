
# Security & Reliability Hardening: Critical + High Findings

Address the 8 red/orange findings from the audit. Grouped by system layer so related changes ship together and share test surface.

---

## 1. XSS in Rendered Email Bodies (Critical)

**Problem:** `ThreadMessage.tsx` renders HelpScout email HTML via `dangerouslySetInnerHTML` with no sanitization. A malicious inbound email can execute arbitrary JS in the CRM's origin — session hijack, tenant data theft.

**Decision: Sanitize with DOMPurify on the client, at render time, using a strict allowlist.**

Why this over alternatives:
- **Server-side sanitize on ingest:** rejected. We'd have to rewrite stored HTML, and any past-stored payloads remain dangerous. Client-side sanitize covers historical data automatically and defends even if a new ingest path is added later.
- **iframe sandbox:** rejected. Breaks inline images/signatures, complicates height sizing, and still needs sanitization for `srcdoc`. Not worth the UX cost.
- **Strip to text:** rejected. Users need formatted email.

DOMPurify is the industry standard, actively maintained, ~20KB, and battle-tested. Apply the same sanitizer to any other `dangerouslySetInnerHTML` sites (signature preview, campaign step preview) via a shared `sanitizeEmailHtml()` util so we have one policy.

---

## 2. RingCentral Webhook Signature Verification (Critical)

**Problem:** `ringcentral-sms` accepts inbound webhook posts with no signature check. Anyone with the URL can forge inbound SMS → fake "received" events, auto-pause campaigns, poison `last_contact_at`, spoof client replies.

**Decision: Validate the `Verification-Token` header against a stored `RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN` secret on every inbound POST.**

RingCentral's webhook model uses a per-subscription verification token (set when the subscription is created and echoed on the handshake). We already handle the handshake echo; we just don't check the token on subsequent deliveries. Reject with 401 if missing/mismatched. Fail closed — no "skip if secret absent" fallback (that's what bit us with HelpScout).

---

## 3. HelpScout Webhook Secret Must Be Required (Critical)

**Problem:** Current code logs a warning and continues if `HELPSCOUT_WEBHOOK_SECRET` is unset. Signature validation silently skipped → identical forgery risk as #2.

**Decision: Fail closed. If the secret is missing, return 500 and refuse to process. Never accept unsigned webhooks.**

Convert the warning-and-continue branch to a hard error. The secret is already configured in prod, so no operational impact; this only closes the "someone deletes the secret" foot-gun.

---

## 4. Campaign Scheduler Public Endpoint (Critical)

**Problem:** `campaign-scheduler` deploys with `verify_jwt = false` and has no auth check. Anyone can hit the URL and force immediate campaign dispatch — duplicate sends, denial-of-wallet, timing manipulation.

**Decision: Require a shared secret in the `Authorization` header, validated in-code. Use a dedicated `CRON_SECRET` used by pg_cron; reject everything else.**

Why not `verify_jwt = true`:
- pg_cron doesn't mint user JWTs; it can only send a static header. `verify_jwt = true` would require embedding a service-role JWT in cron SQL (worse — full DB access if leaked).
- A dedicated cron secret is minimum-privilege: leak only lets you trigger scheduler runs, not read data.

Update the existing pg_cron job to send `Authorization: Bearer $CRON_SECRET`. Same pattern applies to any other cron-triggered function (audit while we're in there).

---

## 5. Missing `service_role` Grants on New Tables (High)

**Problem:** Recent migrations created public-schema tables without `GRANT ALL ... TO service_role`. Edge functions using the service-role key fail with permission errors on those tables (or will, next time they're touched).

**Decision: Sweep migration to add the missing grants across all `crm_*` tables added in the last ~30 days.**

Query `information_schema.role_table_grants` to identify gaps, then emit a single idempotent migration. Also add the standard `authenticated` grants where policies expect them. This is mechanical — no policy changes.

---

## 6. N+1 Query in Client Table Render (High)

**Problem:** Client table triggers a per-row query for tag/last-contact enrichment when the base query already has the columns. Wastes a request per visible row (~50) on every filter change.

**Decision: Consolidate into the existing `useClients` select. Drop the per-row hooks; add the columns to the base query's `select()` string.**

The data is already on `clients` (post last-contact migration). This is pure code deletion — remove the child hooks and let the parent query return everything.

---

## 7. Campaign Scheduler Race Condition (High)

**Problem:** Two overlapping scheduler invocations (e.g., cron overlap after a slow run) can both select the same pending step and send it twice. No row-level lock.

**Decision: Use `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction, wrapped in an RPC.**

Why this over alternatives:
- **Advisory lock on the whole function:** rejected. Serializes all tenants; slow tenant blocks fast ones.
- **`processing` status flag with timestamp:** rejected. Requires stuck-row recovery logic; `SKIP LOCKED` is atomic and standard for job queues.
- **Unique constraint on (enrollment_id, step_order) in `crm_campaign_step_logs`:** keep as belt-and-suspenders — insert log row *before* send, and let the unique constraint be the last line of defense.

Create `claim_pending_campaign_steps(limit int)` RPC that atomically selects + marks. Scheduler calls the RPC instead of raw select.

---

## 8. Bulk Send Stuck in `'sending'` on Crash (High)

**Problem:** If `helpscout-proxy` or `ringcentral-sms` crashes mid bulk-send, `crm_bulk_send_logs.status` stays `'sending'` forever. UI shows perpetual progress bar; no retry path.

**Decision: Add a `heartbeat_at` timestamp updated per recipient, plus a reconciliation cron that marks `sending` rows with stale heartbeats (>10 min) as `'failed'`.**

Why not just wrap in try/finally:
- Deno edge functions can be killed by wall-clock timeout (150s) without running finally blocks reliably.
- Heartbeat + reconciler works even for hard kills, OOMs, and deploys mid-flight.

Reconciler is a small edge function on a 5-minute cron, uses same `CRON_SECRET` pattern from #4.

---

## Technical Details

### Files touched
- `src/components/crm/inbox/ThreadMessage.tsx` — sanitize
- `src/lib/sanitize.ts` (new) — shared DOMPurify config
- `src/components/crm/settings/SignaturePreview.tsx`, `src/components/crm/campaigns/CampaignStepPreview.tsx` — use shared sanitizer
- `supabase/functions/ringcentral-sms/index.ts` — verification token check
- `supabase/functions/helpscout-proxy/index.ts` — remove warning-fallback
- `supabase/functions/campaign-scheduler/index.ts` — CRON_SECRET check, use claim RPC
- `supabase/functions/reconcile-bulk-sends/index.ts` (new)
- `src/hooks/crm/useClients.ts` + `src/components/crm/clients/ClientTable.tsx` — merge queries
- Migration: grants sweep, `claim_pending_campaign_steps` RPC, `heartbeat_at` column, update pg_cron jobs

### Secrets required (user must add)
- `RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN` — from RingCentral subscription
- `CRON_SECRET` — auto-generated

### Rollout order
1. Grants sweep (#5) — unblocks anything else that touches new tables
2. Sanitizer (#1) — pure frontend, zero risk
3. Webhook validation (#2, #3) — coordinated with re-registering webhooks
4. Scheduler auth + race fix (#4, #7) — deploy together, update cron in same migration
5. Bulk send reconciliation (#8)
6. Client table N+1 (#6) — last, isolated cleanup

### Out of scope (deferred to next batch)
Findings 9–15 (medium): CORS wildcard tightening, signature URL sanitization at storage time, waterfall query on focus, index audits, etc.
