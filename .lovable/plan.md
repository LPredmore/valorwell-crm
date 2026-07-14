## CRM-Only Re-scope and Completion Plan

This plan drops platform-wide items (clinical, claims, ERA, payroll, provider lifecycle, billing execution) from the CRM blocker list and finishes every CRM-side task that does not require a missing backend contract. Unavailable CRM-required contracts stay fail-closed with a structured `CONTRACT_NOT_DEPLOYED` state — no simulations, no fallbacks to `pat_status`, no direct protected-table writes.

---

### A. CRM-only required contract list

Grouped by launch-criticality. Each entry ties to a real CRM consumer file.

**A1. Required for CRM launch**

| # | Contract | Kind | Signature | CRM consumer | Grants | Caller role | RLS | Idempotent | Emits | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `v_client_canonical_state` | view | columns per `CanonicalClientState` (contract v1) | `useCanonicalClientState(s)`, kanban, client detail, badges | SELECT to `authenticated` | admin/staff of tenant | tenant scoped | n/a | n/a | **MISSING** |
| 2 | `crm_transition_lifecycle` | rpc | `(client_id uuid, to_stage text, reason text, idempotency_key uuid, contract_version text) → MutationResult` | `useTransitionLifecycle` | EXECUTE to `authenticated` | admin/staff | callee checks `crm_has_role` + tenant | yes | audit: `lifecycle_changed` | **MISSING** |
| 3 | `crm_set_engagement` | rpc | `(client_id, to_state, reason, idempotency_key, contract_version)` | `useSetEngagement` | EXECUTE authenticated | admin/staff | yes | yes | `engagement_changed` | **MISSING** |
| 4 | `crm_set_contact_policy` | rpc | `(client_id, policy, reason, idempotency_key, contract_version)` | `useSetContactPolicy`, DNC toggle | EXECUTE authenticated | admin/staff | yes | yes | `contact_policy_changed` | **MISSING** |
| 5 | `crm_set_service_policy` | rpc | same shape | `useSetServicePolicy` | " | admin/staff | yes | yes | `service_policy_changed` | **MISSING** |
| 6 | `crm_set_eligibility` | rpc | `(client_id, state, manual_review jsonb, reason, idempotency_key, contract_version)` | `useSetEligibility` | " | admin/staff | yes | yes | `eligibility_changed` | **MISSING** |
| 7 | `crm_set_care_cadence` | rpc | `(client_id, cadence, reason, idempotency_key, contract_version)` | `useSetCareCadence` | " | admin/staff | yes | yes | `care_cadence_changed` | **MISSING** |
| 8 | `crm_assign_clinician` | rpc | `(client_id, staff_id, reason, idempotency_key, contract_version)` | assign action | " | admin/staff | yes | yes | `clinician_assigned` | **MISSING** |
| 9 | `crm_close_client` / `crm_reopen_client` | rpc | `(client_id, disposition_reason, reason, idempotency_key, contract_version)` | close/reopen actions | " | admin/staff | yes | yes | `closed`/`reopened` | **MISSING** |
| 10 | `crm_evaluate_communication_policy` | rpc | `(client_id, channel, message_class) → { allowed, reason, code }` | `PolicyAwareComposer`, `useBulkSend`, `useBulkSms`, campaign-scheduler | EXECUTE authenticated + service_role | admin/staff | tenant scoped read | n/a | n/a | **MISSING (server-side authority)** |
| 11 | `helpscout-proxy` edge fn (send path must call #10) | edge | existing | `useReplyToConversation`, bulk email | n/a | admin/staff JWT | n/a | send-time guard | `email_suppressed` on block | **PARTIAL — needs suppression call server-side** |
| 12 | `ringcentral-sms` edge fn (send path must call #10) | edge | existing | `useBulkSms`, campaign step SMS | n/a | admin/staff JWT | n/a | send-time guard | `sms_suppressed` on block | **PARTIAL — same** |
| 13 | `crm_activity_events` insert via edge fn only | policy | no direct client insert of protected event types | activity timeline | INSERT to `service_role` only for protected classes | n/a | tenant scoped read | n/a | n/a | **NEEDS lockdown** |
| 14 | `crm_client_state_audit` | table | already CRM-owned | audit displays | already granted | admin read | tenant scoped | n/a | n/a | DELIVERED |
| 15 | `crm_tasks`, `crm_exceptions`, `crm_idempotency_keys`, `crm_client_canonical_meta` | tables | CRM-owned | tasks/exceptions pages | already granted | admin/staff | tenant scoped | n/a | n/a | DELIVERED |

**A2. Required only for a later CRM feature (not launch-blocking)**

- `crm_bulk_enroll_campaign` rpc — bulk enrollment tooling; today enrollment goes through existing enrollment edge fn.
- `v_crm_reports_funnel`, `v_crm_reports_engagement`, `v_crm_reports_closure`, `v_crm_reports_campaigns`, `v_crm_reports_tasks`, `v_crm_reports_exceptions` — read models for Reports page. Reports can ship with "requires backend view" empty states.
- `crm_reengage_client` rpc — optional re-engagement helper.

**A3. Not a CRM blocker (owned by other apps)**

Removed from CRM blocker list — these appeared in the global register but no CRM file consumes them:

- All `staff_*` credentialing tables (licenses, malpractice, CAQH, education, work history, certifications, disclosures, payer enrollments)
- Provider lifecycle: `provider_*`, `vaccn_*`
- Clinical: `appointment_clinical_notes`, `client_treatment_plans`, `client_safety_plans`, all assessments (`client_phq9_*`, `gad7`, `pcl5`), `client_history_*`
- Insurance/eligibility internals: `client_insurance*`, `eligibility_checks` details, `client_diagnoses`
- Billing/RCM: `claims`, `claim_*`, `era*`, `payment_allocations`, `client_charges`, `client_payments`, `client_payment_links`, `client_payment_methods`
- Payroll: all `payroll_*`
- Practice config: `practice_info`, `practice_locations`, `services`, `cpt_codes`, `place_of_service`
- Scheduling internals: `appointments`, `appointment_series`, `appointment_exceptions`, calendar sync tables
- Forms platform: `form_*`, `consent_templates`
- Backend contract registry itself: `backend_contract_*`
- Cross-app mirrors: `clickup_client_mirror_state`, `crm_clickup_*` (UI already retired)

These stay in the shared backend and are out of scope for CRM completion.

---

### B. Contracts removed from CRM blocker list

Everything in A3 above. Rationale: no file under `src/pages/crm/**`, `src/components/crm/**`, `src/hooks/crm/**`, `src/hooks/canonical/**`, `src/repositories/**`, or CRM-owned edge functions (`helpscout-proxy`, `ringcentral-sms`, `campaign-scheduler`) reads or writes those tables. They belong to `valorwell-clients`, `valorwell-staff`, `valorwell-billing`, and `valorwell-credentialing`.

---

### C. CRM work already completed despite backend blockers

- Canonical domain model, contracts v1, and mock provider (WS1–2).
- Supabase repositories for clients, tasks, exceptions, staff, audit, campaigns, communications, reports (WS3–10) — fail-closed when canonical view/RPCs missing.
- CRM-owned tables + RLS + grants: `crm_tasks`, `crm_exceptions`, `crm_client_canonical_meta`, `crm_client_state_audit`, `crm_idempotency_keys`.
- ClickUp UI + edge function retirement.
- Contract version constant wired through every canonical hook.
- Unit tests green (17/17).
- Shared suppression helper (`supabase/functions/_shared/suppression.ts`).

---

### C-next. CRM work to execute in this pass (no missing backend needed)

1. **Route cutover to canonical pages.** Point `/crm/clients`, `/crm/clients/:id`, `/crm/campaigns`, `/crm/inbox`, `/crm/reports`, `/crm/staff`, `/crm/tasks` (new), `/crm/exceptions` (new) at the Canonical* pages in `App.tsx`. Retire legacy pages by re-exporting canonical.
2. **Kill `pat_status` reads/writes in CRM code paths.**
   - `useClients` / `useClientsByStatus`: drop `pat_status` filter/order; use canonical batch read for status column.
   - `ClientKanban*`, `ClientTable`, `StatusBadge`, `useUpdateClientStatus`, `useBulkUpdateStatus`: switch to `useTransitionLifecycle` and canonical lifecycle labels.
   - Delete `useUpdateClientStatus`/`useBulkUpdateStatus` legacy paths that update `clients.pat_status` directly; replace with lifecycle RPC calls that render `CONTRACT_NOT_DEPLOYED` toast until RPC ships.
3. **At Risk read-only enforcement.** Remove any UI that toggles `at_risk`; render as computed badge from canonical state only.
4. **DNC / suppression presentation.** Add unified `SuppressionBanner` and gate composer send buttons on `crm_evaluate_communication_policy` result; fail closed with clear reason when RPC missing.
5. **Server-side suppression enforcement.** Update `helpscout-proxy` and `ringcentral-sms` send handlers to invoke suppression evaluation (via shared helper) before dispatch and to persist `suppressed` audit event on block. No client-side-only guard.
6. **Authorization-aware UI.** Hide/disable mutating controls when `useCrmAuth().role` is not `admin`/`staff`; show read-only variants otherwise.
7. **Contract-version handling.** Surface active contract version in Settings → About; block mutations when server returns `contract_version_mismatch`.
8. **Loading / error / empty states.** Every canonical hook renders skeleton → error card with `CONTRACT_NOT_DEPLOYED` code → empty state, replacing silent `null` fallbacks currently in `useCanonicalClientState(s)`.
9. **Audit displays.** Wire `crm_client_state_audit` reader to the client detail Activity tab; group by correlation id.
10. **Reports.** Keep page mounted; each panel shows "Backend view pending: <view name>" empty state until A2 views ship. No fake numbers.
11. **Direct protected-table writes.** Remove any remaining `supabase.from('clients').update(...)` calls on protected columns (`pat_status`, `assigned_therapist_id`, `contact_policy`, `service_policy`, `care_cadence`, `at_risk`, eligibility). Grep-verify zero matches under `src/`.
12. **Tests.** Extend Vitest suite: mock-provider canonical flow, legacy-assertion guard (no `pat_status` string in CRM src), authorization gating, suppression fail-closed. All must pass against currently delivered contracts.
13. **Retire dead code.** Delete legacy `Clients.tsx`, `ClientDetail.tsx`, `Campaigns.tsx`, `Inbox.tsx`, `Reports.tsx`, `Staff.tsx` after canonical routes are live and referenced.
14. **Deliver A CRM-specific backend delivery request** (`docs/crm-backend-delivery-request.md`) containing the A1/A2 tables above with signatures, grants, RLS, idempotency, events, consumer file, verification test, and current blocker detail.

---

### D. CRM files/actions that will remain blocked after this pass

Blocked strictly on A1 backend delivery (`v_client_canonical_state` + `crm_*` RPCs + `crm_evaluate_communication_policy`):

- `src/hooks/crm/useCanonicalClientState.ts` — returns fail-closed until view ships.
- `src/hooks/crm/useCanonicalMutations.ts` — all six mutation hooks fail-closed.
- `src/components/crm/canonical/PolicyAwareComposer.tsx` — send disabled until policy RPC ships.
- `src/pages/crm/canonical/CanonicalReports.tsx` — panels blocked until A2 views ship.
- `supabase/functions/helpscout-proxy` and `ringcentral-sms` — final send-path enforcement requires policy RPC.
- Authenticated E2E RLS proofs — require live RPCs + a signed-in admin/staff session (external Supabase, sandbox cannot mint).

Nothing else remains CRM-blocked.

---

### E. Commit SHA + F. Build/type/lint/test results

Reported at end of the execution pass — not available until code changes land. Plan mode produces no commits.

---

### Execution order once approved

1. Route cutover + legacy page retirement.
2. `pat_status` and protected-column write removal (grep-clean).
3. Fail-closed hook states + `SuppressionBanner` + composer gating.
4. Auth-aware UI gating + contract version surface.
5. Server-side suppression enforcement in `helpscout-proxy` + `ringcentral-sms`.
6. Audit reader wiring + Reports empty states.
7. `docs/crm-backend-delivery-request.md`.
8. Extend Vitest suite; run typecheck + lint + tests.
9. Report commit SHA + results.

No shared backend migrations. No changes to other Lovable projects. No temporary substitutes.
