
# ValorWell CRM Overhaul — Master Execution Plan (Phases P01–P09)

## Ground rules I will follow

- Treat the uploaded spec (`ValorWell_Overhaul_CRM_AI_IDE_Master_Implementation_Spec.md`) as the controlling brief; the CRM repo (this project) is the only surface I modify.
- **Supabase is out of scope.** All Phase 14 canonical views, RPCs, event tables, contract package, and role interface are assumed live in project `ahqauomkgflopxgnlndd`. I will not run migrations from this repo. If a contract is missing at runtime I stop that phase and record a blocker in its report — I do not stub around it.
- Regenerate `src/integrations/supabase/types.ts` from the live DB once at P01 start; re-check after any contract change signal.
- No changes to existing shared table columns. Any new CRM-only persistence needed (e.g., UI prefs) uses the `crm_` prefix — but I don't expect any in this program.
- One Phase Completion Report per phase (spec §14 template), delivered inline at the end of each phase's work, before starting the next. I run all 9 phases in one continuous pass.
- Stop-and-report if a phase's Acceptance Criteria cannot be met with the live contracts.

## Phase-by-phase execution

### P01 — Repository Baseline and Contract Sync
- Regenerate Supabase types; wire the versioned contract package + role interface into `src/lib/crm/` as the single source for client-state reads.
- Audit and remove legacy client-status coupling (`PatStatus` enum, `status-config.ts`, direct `clients.pat_status` reads) — replace with canonical Lifecycle / Engagement / At Risk / Eligibility / Contact Policy / Service Policy / Care Cadence / Disposition reads from the contract package.
- Harden CI (`.github/workflows/ci.yml`): typecheck, lint, unit tests, contract-version assertion.
- Deliverable: P01 completion report + green CI.

### P02 — Canonical Client Views and Administrative State Changes
- Replace `useClients`, `ClientTable`, `ClientKanban`, `ClientFilters`, `ClientDetail`, `ClientQuickProfile`, `StatusBadge` reads with canonical view/RPC calls.
- Route every admin state mutation through the canonical write RPCs (no direct `clients` UPDATE from the app).
- Update Kanban config + filters to the new Lifecycle × Engagement model.

### P03 — Campaign Engine Contract Migration
- Migrate `campaign-scheduler` edge function and `useCampaigns*` hooks to the canonical enrollment/step/trigger contracts and the shared outbox.
- Replace status-based auto-enroll/auto-cancel triggers with Lifecycle/Engagement/At-Risk driven enrollment.
- Preserve existing tenant-scoped, single-active-campaign, 15-min pg_cron dispatch semantics.

### P04 — Contact Policy and Communication Suppression
- Enforce the Communication + Suppression contract in every send path: `helpscout-proxy`, `ringcentral-sms`, bulk email/SMS, campaign scheduler.
- Implement REMOVE rule + send-time recheck as a shared guard used by all edge functions before dispatch.
- Update inbox and bulk composers to reflect suppression state and per-class eligibility.

### P05 — Existing Lifecycle Campaign Migration
- Port the current lifecycle campaigns (New/Interested/Scheduled/Early Sessions/Established/etc.) onto canonical triggers and templates.
- Reconcile personalization variables against the canonical client projection.

### P06 — Waitlist and Capacity-Release Campaigns
- Implement Waitlist and capacity-release campaign definitions from spec §6 / §12-P06 using the canonical enrollment engine and contact policy guard.

### P07 — At Risk, Engagement, and Follow-Up Campaigns
- Implement At-Risk, Engagement recovery, and Follow-Up campaigns; wire the At-Risk signal from the canonical view (not from `clients.pat_status`).

### P08 — ClickUp Operations Mirror and Journey Reporting
- Convert `clickup-sync` into a strictly one-way mirror driven by the canonical event stream / outbox; no CRM→Supabase writes from ClickUp.
- Keep the existing background `crm_clickup_sync_runs` pattern for sync observability; add the required health/lag surfacing panel.
- Build the Journey / Historical / Attribution reporting screens under `/crm/reports` reading canonical reporting views only.

### P09 — Legacy Cleanup, Security, and End-to-End Validation
- Delete every legacy path deprecated by P01–P08 (dead hooks, `status-config`, direct table reads, unused edge branches).
- Security pass: RLS-consumer sanity checks, error handling (§8.3), logging/analytics (§8.4), prohibited-exposure audit (§8.2).
- Execute the §12-P09 Workstream D end-to-end scenario matrix via Playwright against the published site.
- Cross-system regression checklist (§Workstream E), release identity + deployment notes (§Workstream B/F), all required signoffs.

## Verification per phase

For each phase I will:
1. Run `tsgo` + vitest + the phase's targeted Playwright scenarios against `http://localhost:8080` (authenticated with the injected Supabase session).
2. Verify against the phase's Acceptance Criteria + Release Gate verbatim.
3. Produce the spec §14 Phase Completion Report (phase id, release identity, contract identity, reconciliation notes, changes, tests, data reconciliation, security/privacy, production validation, blockers, rollback, next-phase readiness).

## Assumptions I am locking in (call out now if any is wrong)

1. All canonical Supabase views, RPCs, event tables, outbox, and the versioned contract package + role interface exist and are queryable from the anon/authenticated roles the CRM uses.
2. `crm.valorwell.org` is the deployment target; publishing happens via Lovable after each phase's green build.
3. I own only files under this repo. Anything requiring a Supabase migration becomes a blocker on that phase's report, not a stub.
4. Existing background patterns kept intact where the spec doesn't replace them (ClickUp sync runs, campaign scheduler cadence, bulk send pacing).

On approval I begin P01 immediately and run straight through to P09, posting each Completion Report inline as I finish that phase.
