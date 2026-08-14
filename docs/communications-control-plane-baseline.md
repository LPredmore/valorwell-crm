# Communications control plane — Phase 0-4 baseline and foundation

Recorded against Supabase project `ahqauomkgflopxgnlndd` at the time of implementation.

## Phase 0 — baseline

Population counts before any control-plane work:

| Domain | Records |
| --- | --- |
| Clients | 658 |
| Relationship contacts | 259 |
| Provider applicants | 34 |
| Identity-bearing source records (all four domains) | 970 |
| Campaigns (client engine) | 9 |
| Campaigns (relationship engine) | 1 |
| Existing enrolments visible in the unified participation view | 520 |

Implementation switches (`private.crm_control_plane_flags`, all seeded **off**):

- `communications_control_plane_enabled`
- `campaign_trigger_engine_enabled`
- `client_trigger_cutover_enabled` (blocked until the trigger engine is on)
- `bty_trigger_cutover_enabled` (blocked until the trigger engine is on)
- `staff_campaigns_enabled`
- `donor_campaigns_enabled`
- `universal_newsletters_enabled`
- `newsletter_mailbox_suppression_enabled`

Read with `public.list_crm_control_plane_flags()`; changed with
`public.set_crm_control_plane_flag(flag, enabled, reason)` — a reason is mandatory and every change is written to
`public.crm_activity_events` as `communications_control_plane_flag_changed`.

## Phase 1 — provider applicant worker extraction

Provider applicant recruiting outreach was removed from `campaign-scheduler` and now lives in
`supabase/functions/provider-applicant-communication-worker`. Behaviour is unchanged: the same claim RPC
(`crm_claim_provider_applicant_communication_jobs`), the same Resend idempotency key (`provider-applicant/<job id>`),
the same transport-acceptance and completion RPCs, the same terminal-status and content-version guards, and the same
exponential retry schedule.

Scheduling:

- `campaign-scheduler-15min` — client campaign steps only.
- `provider-applicant-communication-worker` — every 5 minutes, authenticated with the vault `cron_secret`.

## Phase 2 — canonical person identity

- `public.crm_people` — one row per real person (display name, primary email, primary phone).
- `public.crm_person_identities` — the email/phone identifiers that resolve to a person, unique per tenant.
- `public.crm_person_records` — which domain record (client, relationship contact, provider applicant, staff) belongs
  to which person, unique per tenant and record.
- `public.crm_person_source_records` — read-only projection of all four domains with normalised email and phone.
- `public.crm_reconcile_person_identities(p_dry_run)` — deterministic only: it links records that share an exact
  normalised email or E.164 phone and never guesses on names. Dry run reports without writing.
- `public.crm_person_identity_overview()` — coverage per domain plus the count of people appearing in more than one
  domain.

Reads are limited to CRM tenant members; writes are backend-only.

## Phase 3 — campaign registry

`public.crm_campaign_registry` lists every campaign with its domain, engine, name, status and active state, kept in
step by triggers on `crm_campaigns` and `relationship_campaigns` and backfilled for all existing campaigns.

## Phase 4 — cross-domain participation

`public.crm_campaign_participation_v` unions client and relationship enrolments, resolving each to the registry entry
and, where already linked, the canonical person. `public.crm_campaign_participation(...)` filters that projection by
person, domain, campaign and status.

## Operator surface

`/crm/communications-control-plane` shows the switches (with mandatory reason), person-directory coverage with a
preview-then-apply reconciliation action, the campaign registry, and recent cross-domain participation.

## Not done in this phase

No trigger engine, no staff or donor campaigns, no newsletter model, and no change to how any campaign currently
sends. The person directory backfill is intentionally left to be run from the console (dry run first).
