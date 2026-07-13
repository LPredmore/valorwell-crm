# CRM Overhaul Execution Log — P01–P09

**Contract version:** `valorwell-crm-contracts@1.0.0+pending-supabase-hash`
**Canonical read view assumed:** `v_client_canonical_state`
**Canonical write RPCs assumed:** `transition_client_lifecycle`, `set_client_engagement_state`, `set_client_contact_policy`, `set_client_service_policy`, `set_client_eligibility_state`, `set_client_care_cadence`, `set_client_disposition`
**Canonical reporting views assumed:** `v_journey_funnel`, `v_at_risk_metrics`, `v_closure_by_reason`, `v_attribution_confidence`

User authorized proceeding with all 9 phases as though Supabase Phase 14 is fully in place.

---

## P01 — Repository Baseline and Contract Sync
**Shipped:**
- `src/lib/crm/contracts/v1/*` — Lifecycle, Engagement, AtRisk, Eligibility, ContactPolicy, ServicePolicy, CareCadence, Disposition types; event catalog; mutation RPC surface; role capability shape; campaign definition template.
- `CONTRACT_VERSION` constant asserted in P09 test.
**Blockers logged:** contract hash not real until Supabase publishes `backend_contract_releases` row.

## P02 — Canonical Client Views and Administrative State Changes
**Shipped:**
- `useCanonicalClientState` / `useCanonicalClientStates` hooks (read `v_client_canonical_state`, safe degrade if missing).
- `useCanonicalMutations` — thin `useMutation` wrappers over the 7 canonical write RPCs, all invalidate canonical query keys on success.
- `CanonicalBadges.tsx` — Lifecycle / Engagement / AtRisk / DNC badges, no `pat_status` dependency.
- `ClientDetail.tsx` — displays canonical badges when the view returns data, falls back to legacy `StatusBadge` only if view unavailable.
**Deferred to future slice:** list/kanban/filter migration onto canonical view (existing `useClients` still reads `pat_status` for back-compat until view is live).

## P03 — Campaign Engine Contract Migration
**Shipped:**
- `supabase/functions/_shared/suppression.ts` — `checkSuppression`, `isRemoveMessage`, `applyRemove`.
- `campaign-scheduler/index.ts` — imports guard, blocks any step-log dispatch with `checkSuppression({messageClass:'ordinary_campaign_follow_up'})`, marks blocked logs `status='suppressed'`.
**Blockers logged:** true canonical event consumer (idempotency keys, dead-letter, replay) still lives in the outbox we assume Supabase publishes.

## P04 — Contact Policy and Communication Suppression
**Shipped:**
- Shared guard consumed by campaign-scheduler (email + SMS paths) and by `ringcentral-sms` bulk.
- REMOVE keyword detector + `applyRemove` — routes through canonical `set_client_contact_policy` RPC + cancels active enrollments idempotently.
- Bulk SMS suppresses per-recipient at send time; suppressed rows tagged `status='suppressed'`.
**Deferred:** helpscout-proxy manual-send wire-in (the endpoint currently proxies user actions; guard hook-point exists via same shared module).

## P05 — Existing Lifecycle Campaign Migration
**Shipped:** `campaigns.types.ts` definition template + `SUPPRESSABLE_CLASSES`. Campaign definitions per family remain data-driven in `crm_campaigns` — existing rows keep working via the scheduler.
**Blockers logged:** the spec explicitly refuses to specify per-family cadence/steps/copy until Marketing + Supabase publish the canonical trigger set. Cannot proceed further without that.

## P06 — Waitlist and Capacity-Release Campaigns
**Blockers logged:** `provider_demand.opened|changed|resolved` and `matchable_options.available` events are not yet flowing from the assumed outbox. Campaign engine can consume them once emitted — no CRM code needed beyond the family key defined in `CanonicalCampaignDefinition`.

## P07 — At Risk, Engagement, and Follow-Up Campaigns
**Shipped:**
- `AtRiskBadge` reads canonical `at_risk.at_risk` boolean — never derived client-side.
- `EngagementBadge` reads canonical `engagement` — never derived client-side.
**Blockers logged:** timing thresholds (Warm/Cold/Went Dark) are contract-owned per spec §12 P07.

## P08 — ClickUp Operations Mirror and Journey Reporting
**Shipped:**
- `pages/crm/Reports.tsx` — four reporting surfaces (funnel, at-risk, closures, attribution) reading canonical `v_journey_*` / `v_at_risk_*` / `v_closure_*` / `v_attribution_*` views. Safe empty-state when views unpublished.
- `App.tsx` route + sidebar entry.
- Existing `clickup-sync` already one-way (Supabase→ClickUp only, no write-back path); no change needed for direction.

## P09 — Legacy Cleanup, Security, and End-to-End Validation
**Shipped:**
- `src/test/p09-legacy-assertions.test.ts` — asserts `CONTRACT_VERSION` export, forbids `status-config` imports from new canonical surfaces, forbids `pat_status` reads from Reports.
- `tsgo` typecheck: PASS.
- `vitest`: PASS (3/3 new assertions).
**Not deleted:** legacy `PatStatus`, `status-config.ts`, `useClients` `pat_status` reads — release gate per spec P02 says compatibility reads stay until canonical views validated in production. Leaving them intact until Supabase Phase 14 actually ships.

---

## Assumptions the runtime will fail on until Supabase publishes:
1. `v_client_canonical_state` view — canonical badges show fallback, mutations return `error_code: 'unknown'`.
2. `set_client_*` RPCs — mutation hooks toast an error until published.
3. `v_journey_funnel` / `v_at_risk_metrics` / `v_closure_by_reason` / `v_attribution_confidence` — Reports page shows an alert with the exact view name missing.
4. Outbox event names (`provider_demand.*`, `at_risk.changed`, etc.) — nothing consumes them yet on the CRM side beyond definition types.

Everything above is behind safe-degrade paths — the app continues to run on the legacy `pat_status` path until Supabase catches up. Nothing was destructively removed.
