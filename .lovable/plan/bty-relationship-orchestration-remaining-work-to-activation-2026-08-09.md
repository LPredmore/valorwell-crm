# BTY Relationship Orchestration — Remaining Work to Activation

## Verified current state (live checks, this repo + production DB)

The orchestration foundation from the specification is already built and applied to `ahqauomkgflopxgnlndd` (migrations `20260809164922_beyond_the_yellow_lifecycle_orchestration.sql` and `20260809165036_bty_orchestration_fk_indexes.sql`):

- Ledger and evidence tables exist: `relationship_activity_events`, `relationship_message_observations`, `relationship_meetings`, `relationship_reconciliation_issues`, plus private `relationship_google_connections`, `relationship_google_oauth_states`, `relationship_google_sync_state`, `relationship_calendar_channels`, `relationship_bty_auto_enrollment_idempotency`, `relationship_feature_flags`.
- Single application engine exists (`private.apply_relationship_activity`) with idempotency, terminal-state protection, status history, interactions, and BTY auto-enrollment (`private.auto_enroll_bty_opportunity`) behind the auto-enrollment flag.
- Resend was refactored, not replaced: `private.record_relationship_delivery_result` wraps the pre-BTY function and emits `outreach_sent`; the existing `relationship-resend-webhook` still verifies Svix signatures and now routes into `ingest_relationship_inbound_reply` / `ingest_relationship_provider_event`.
- Gmail path: `relationship-gmail-push` validates Pub/Sub OIDC (audience + push service account), whole-mailbox `users.history.list` with `messageAdded`, metadata-first fetch, full fetch only on confident match, HTTP 404 → bounded full reconciliation, watch renewal storing `historyId`/expiration.
- Calendar path: `relationship-calendar-webhook` validates channel id/resource id/token, incremental `events.list` with stored `syncToken`, `410 Gone` → token invalidation plus full resync, StreamYard + attendee matching in `ingest_relationship_calendar_event`.
- Cron already scheduled: `relationship-google-hourly-reconciliation` (`17 * * * *`) and `relationship-google-daily-watch-renewal` (`23 8 * * *`).
- UI exists: `/crm/business-development/orchestration` (connections, flags read-only, invariants, issue queue) and opportunity actions (mark interested, begin scheduling, decline, nurture, Recording completed, auto-enrollment retry).
- Live flags: `relationship_activity_capture_enabled = true`; mutation, auto-enrollment, Gmail observation, Calendar observation, reconciliation writes all `false`. BTY campaign follow-up steps 2 and 3 remain inactive.

Confirmed gaps (only these remain on the software side):

1. No way to change feature flags from the application — no `set`-flag RPC exists, so staged activation currently requires manual SQL.
2. `public.preview_relationship_bty_reconciliation` and `public.apply_relationship_bty_reconciliation` exist but are not reachable from the UI, so the Phase 11 dry run cannot be reviewed or applied by an operator.
3. No automated test coverage for the orchestration engine (only `relationship-enrollment-orchestration.test.ts` from the earlier pass).
4. Gmail/Calendar have never been connected in production, and the authenticated Pub/Sub push subscription plus `users.watch` bootstrap have not been executed.

## Plan

### 1. Flag administration (database)
Add one additive migration with a service/admin-authorized RPC pair:
- `public.list_relationship_feature_flags()` — returns flag name, enabled, updated_at for the tenant.
- `public.set_relationship_feature_flag(p_flag_name text, p_enabled boolean, p_reason text)` — admin-capability gated, writes `private.relationship_feature_flags`, and records a `relationship_activity_events` audit row (`source = 'operator'`) so activation itself is evidenced.
Guard rails inside the RPC: mutation cannot be enabled while any zero-tolerance invariant from `list_relationship_orchestration_integrity()` is non-zero; auto-enrollment cannot be enabled while mutation is off; Gmail/Calendar observation may be enabled independently.

### 2. Activation console (UI)
On `RelationshipOrchestrationPage`:
- Replace the read-only flag badges with switches wired to the new RPC, ordered per Phase 12 (mutation → auto-enrollment → Gmail effects → Calendar effects), each disabled with an explanatory reason when its precondition fails.
- Add a "Gmail / Calendar bootstrap" panel: buttons to run watch renewal and a manual reconciliation via `relationship-google-maintenance`, showing last sync, watch expiration, and sync-token presence.

### 3. BTY reconciliation workspace (UI)
New section (or `/crm/business-development/orchestration/reconciliation`):
- "Generate dry run" calls `preview_relationship_bty_reconciliation` and renders per-opportunity current status, proposed status, evidence, and reason.
- Explicit "Apply reviewed corrections" calls `apply_relationship_bty_reconciliation`, disabled unless `relationship_reconciliation_writes_enabled` is on; surfaces the `40001` concurrency error as "opportunity changed since dry run — regenerate".
- Add queues for unmatched/ambiguous Gmail, ambiguous Calendar, and auto-enrollment failures by grouping the existing issue list by `issue_type`.

### 4. Test coverage
Add Vitest suites for the pure/adapter layers reachable from the frontend: activity contract mapping, flag-gating rules for the activation switches, dry-run rendering and concurrency-error handling, and the operator-action guard that only allows "Recording completed" from `booked`. Database-level behavior stays covered by a SQL verification script under `supabase/verification/` (dry run, idempotent replay, terminal-state protection, duplicate-observation invariant).

### 5. Operator preflight (yours, outside Lovable)
Documented in `docs/` and surfaced as a checklist on the orchestration page; activation stays blocked until each is confirmed:
- Gmail, Calendar, Pub/Sub APIs enabled in `valorwell-relationships`.
- OAuth redirect exactly `https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/relationship-google-oauth-callback`.
- `relationship-pubsub-push@valorwell-relationships.iam.gserviceaccount.com` exists (no JSON key); Pub/Sub service agent holds `roles/iam.serviceAccountTokenCreator` on it.
- Authenticated push subscription `relationship-gmail-push-prod` created against the existing topic with the push endpoint as audience; unused pull subscription deleted; topic retained.
- Workspace Admin API access limited to `gmail.readonly` and `calendar.events.readonly`.
- Domain Restricted Sharing restored after bindings.

### 6. Staged activation
Connect Gmail (rejects any mailbox other than info@valorwell.org) and Calendar, run watch bootstrap, then hold in shadow mode: capture on, mutation off. Review the ledger against manual truth until Gmail false-positive imports, Gmail/Resend duplicates, and unrelated Calendar links are all zero and every integrity invariant reads zero. Then enable mutation, auto-enrollment, Gmail effects, Calendar effects in that order. BTY campaign steps 2 and 3 stay inactive throughout.

## Out of scope
No changes to clinical scheduling, patient CRM, billing, therapist/staff calendar models, or other repositories. No Gmail send scope, no Calendar write scope, no follow-up reactivation, no LLM in the human-vs-automated decision.

## Technical notes
- All database work is additive: one new migration for the flag RPCs; no changes to shared clinical tables.
- Flag RPCs are `security definer`, `search_path`-pinned, revoked from `anon`, granted to `authenticated` with a capability check inside, and to `service_role`.
- The Resend worker and webhook are refactored in place — no new delivery or webhook function is introduced.
