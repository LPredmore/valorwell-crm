# BTY orchestration activation runbook

## Operator preflight (Google Cloud / Workspace — outside Lovable)

Activation stays blocked until every item is confirmed:

- Gmail API, Google Calendar API, and Pub/Sub API enabled in `valorwell-relationships`.
- OAuth redirect URI exactly `https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/relationship-google-oauth-callback`.
- Service account `relationship-pubsub-push@valorwell-relationships.iam.gserviceaccount.com` exists with **no** JSON key.
- Pub/Sub service agent holds `roles/iam.serviceAccountTokenCreator` on that service account.
- Authenticated push subscription `relationship-gmail-push-prod` on the existing topic, push endpoint `https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/relationship-gmail-push`, audience equal to that endpoint.
- Unused pull subscription deleted; topic retained.
- Workspace Admin API access limited to `gmail.readonly` and `calendar.events.readonly`.
- Domain Restricted Sharing restored after the IAM bindings are in place.

## Connect and bootstrap

1. Open `/crm/business-development/orchestration`.
2. **Connect Gmail** — any mailbox other than `info@valorwell.org` is rejected by `store_relationship_google_connection`.
3. **Connect Calendar** — read-only, observes BTY recording events.
4. Watch registration and incremental sync run on the existing schedules: `relationship-google-daily-watch-renewal` (`23 8 * * *`) and `relationship-google-hourly-reconciliation` (`17 * * * *`). The connections panel shows last sync, watch expiration, and last full reconciliation.

## Shadow validation

Hold with `relationship_activity_capture_enabled = true` and every other switch off. Review the activity ledger against manual truth until all of the following are zero:

- Gmail false-positive imports (unmatched/ambiguous issues resolved, no wrong-opportunity links).
- Gmail/Resend duplicate canonical communications (`duplicateCanonicalCommunication` invariant).
- Calendar events linked to unrelated opportunities.
- Every other zero-tolerance invariant on the orchestration page.

Run `supabase/verification/bty_orchestration_activation_test.sql` (transaction + rollback) to capture the evidence.

## Staged activation order

Each switch requires a typed reason; the change is written to `relationship_activity_events` as a `legacy_reconciliation` / `crm` operator record with the previous and new value.

1. `relationship_activity_mutation_enabled` — blocked by the database while any invariant is non-zero.
2. `relationship_bty_auto_enrollment_enabled` — blocked until mutation is enabled.
3. `relationship_gmail_observation_enabled`.
4. `relationship_calendar_observation_enabled`.
5. `relationship_reconciliation_writes_enabled` — only for the legacy correction pass; blocked until mutation is enabled.

BTY campaign follow-up steps 2 and 3 remain inactive throughout.

## Legacy reconciliation

`/crm/business-development/orchestration/reconciliation`:

1. **Generate dry run** — `preview_relationship_bty_reconciliation`, read-only, shows current status, proposed status, and the evidence flags behind each proposal.
2. Review every proposal. Applying is disabled unless `relationship_reconciliation_writes_enabled` is on and at most 100 items are pending.
3. **Apply reviewed corrections** — `apply_relationship_bty_reconciliation` routes every correction through `apply_relationship_activity`. If any opportunity changed since the dry run the batch aborts (`40001`) and the console asks for a fresh dry run.
4. Turn `relationship_reconciliation_writes_enabled` back off once the pass is complete.

## Not in scope

No Gmail send scope, no Calendar write scope, no follow-up reactivation, no LLM in the human-versus-automated reply decision, and no changes to clinical scheduling, patient CRM, billing, or the staff calendar models.
