# CRM Backend Delivery Request

**Owner:** ValorWell CRM application (this repo)
**Target Supabase project:** `ahqauomkgflopxgnlndd`
**Contract version consumed:** `valorwell-crm-contracts@1.0.0+pending-supabase-hash`
(see `src/lib/crm/contracts/v1/index.ts`)
**CRM commit SHA at time of handoff:** `83afc019d7c094e3943f71ddd8f224dcaf31d07a`

This document lists every backend object the CRM directly consumes.
Nothing in this document may be marked "delivered" until it passes the
live verification suite in `§ Live verification suite` below.

Until every contract in `A1` is delivered, the CRM holds all affected UI
in `CONTRACT_NOT_DEPLOYED` fail-closed state and shows a structured
unavailable-contract banner (see `src/components/crm/canonical/SuppressionBanner.tsx`
and `src/components/crm/auth/CrmMutationGate.tsx`).

---

## Quick index — exact object names

**Canonical read view (1):**
- `public.v_client_canonical_state`

**Lifecycle / state RPCs (8):**
1. `public.crm_transition_lifecycle`
2. `public.crm_set_engagement`
3. `public.crm_set_contact_policy`
4. `public.crm_set_service_policy`
5. `public.crm_set_eligibility`
6. `public.crm_set_care_cadence`
7. `public.crm_assign_clinician`
8. `public.crm_close_client` (paired with `public.crm_reopen_client`; both count as item 8's close/reopen surface)

**Communication policy RPC (1):**
- `public.crm_evaluate_communication_policy`

**Activity event lockdown (1 table):**
- `public.crm_activity_events` (RLS + GRANT changes)

**A2 report read-model views (6):**
1. `public.v_crm_reports_funnel`
2. `public.v_crm_reports_engagement`
3. `public.v_crm_reports_closure`
4. `public.v_crm_reports_campaigns`
5. `public.v_crm_reports_tasks`
6. `public.v_crm_reports_exceptions`

---

## A1. Required for CRM launch

### A1.1 `public.v_client_canonical_state` — view

- **Object type:** SQL view (read model).
- **Purpose:** single authoritative read surface for canonical client state.
  CRM never reads `pat_status` or any legacy status column for business logic.
- **Required columns and semantics:**

| Column | Type | Authority | Notes |
|---|---|---|---|
| `client_id` | uuid | authoritative | PK from `clients` |
| `tenant_id` | uuid | authoritative | drives RLS scoping |
| `contract_version` | text | authoritative | must equal deployed contract hash |
| `lifecycle` | text (`LifecycleStage`) | authoritative | one of Lead, Registration, Intake, Matching, Matched, Scheduled, Early Care, Established Care, Closed |
| `engagement` | text (`EngagementState`) | authoritative | Normal / Unresponsive Warm / Unresponsive Cold / Went Dark |
| `at_risk` | jsonb (`AtRiskState`) | **derived** by backend rule engine | `{ at_risk, evaluated_at, recommended_next_action, event_version }` |
| `eligibility` | text (`EligibilityState`) | authoritative | Eligible / Coverage Issue / Manual Review / Unknown |
| `eligibility_manual_review` | jsonb / null | authoritative | `{ reason, owner, next_action, review_due_at }` |
| `contact_policy` | text | authoritative | Normal / Do Not Contact |
| `service_policy` | text | authoritative | Normal / Service Blocked |
| `care_cadence` | text | authoritative | `regular` / `as_needed` |
| `disposition_reason` | text / null | authoritative | closure reason enum |
| `disposition_at` | timestamptz / null | authoritative | closure timestamp |
| `assigned_therapist_id` | uuid / null | authoritative | current operational owner (clinician) |
| `next_appointment_at` | timestamptz / null | **derived** from `appointments` | next confirmed future appointment |
| `provider_demand_state` | text | **derived** from `client_provider_demand*` | `none` / `open` / `options_available` / `wait_active` / `resolved` |
| `concurrency_token` | text | authoritative | opaque token; supplied on every mutation |
| `updated_at` | timestamptz | authoritative | last canonical write |

  Fields marked **derived** are computed inside the view definition from
  the owning source tables. Fields marked **authoritative** are stored on
  the canonical `clients`/state tables and updated only by the RPCs in
  A1.2–A1.9.

- **Grants:** `GRANT SELECT ON public.v_client_canonical_state TO authenticated;`
- **Tenant isolation:** view definition MUST filter rows to
  `tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE user_id = auth.uid())`
  or equivalent using `crm_has_role(auth.uid(),'admin'|'staff', tenant_id)`.
- **CRM consumer:** `src/hooks/crm/useCanonicalClientState.ts`
  (`useCanonicalClientState`, `useCanonicalClientStates`); every
  `src/pages/crm/canonical/*` page; `src/components/crm/canonical/StateBadges.tsx`.
- **Frontend implemented:** yes.
- **Success response:** row with all columns above, correctly typed.
- **Authorization failure:** no row returned (empty set); no error leak.
- **Verification test:** `LV-01`, `LV-02` below.

### A1.2 `public.crm_transition_lifecycle` — RPC

- **Input signature:**
  `crm_transition_lifecycle(p_client_id uuid, p_to_stage text, p_reason text, p_disposition_reason text default null, p_concurrency_token text, p_idempotency_key uuid, p_contract_version text) returns jsonb`
- **Return shape:** `MutationResult` — `{ ok: boolean, error_code?: text, message?: text }` where `error_code ∈ { unauthorized, invalid_transition, concurrency_conflict, suppression_violation, contract_version_mismatch, unknown }`.
- **Required role:** authenticated user who is admin or staff of the client's tenant. Enforced via `crm_has_role(auth.uid(), ARRAY['admin','staff'], (SELECT tenant_id FROM clients WHERE id = p_client_id))`.
- **Tenant isolation:** cross-tenant call returns `{ ok:false, error_code:'unauthorized' }` and writes no rows.
- **Grants:** `GRANT EXECUTE ON FUNCTION public.crm_transition_lifecycle(...) TO authenticated;` — function is `SECURITY DEFINER` with `SET search_path = public`.
- **Idempotency:** repeated calls with same `p_idempotency_key` within 24h return original result; no additional audit rows written. Enforced via `public.crm_idempotency_keys`.
- **Events emitted:** one `lifecycle_changed` row in `crm_client_state_audit` with `{ prev, next, actor, source:'crm', correlation_id, reason }`.
- **Writes:** canonical lifecycle column read by `v_client_canonical_state`. MUST NOT write `pat_status`.
- **Success response:** `{ ok: true }`.
- **Authorization failure:** `{ ok:false, error_code:'unauthorized' }`.
- **Invalid transition failure:** `{ ok:false, error_code:'invalid_transition', message: '<from>→<to> not allowed' }`.
- **Concurrency failure:** `{ ok:false, error_code:'concurrency_conflict' }` when `p_concurrency_token` doesn't match current row token.
- **CRM consumer:** `src/hooks/crm/useCanonicalMutations.ts → useTransitionLifecycle`; consumed by canonical client detail page and (future) bulk transition.
- **Frontend implemented:** yes.
- **Verification test:** `LV-03`, `LV-04`, `LV-05`, `LV-06`, `LV-07`.

### A1.3 `public.crm_set_engagement` — RPC

- **Input:** `crm_set_engagement(p_client_id uuid, p_to_state text, p_reason text, p_concurrency_token text, p_idempotency_key uuid, p_contract_version text) returns jsonb`
- **Return:** `MutationResult`.
- **Role / tenancy / grants / idempotency / audit:** identical policy to A1.2; audit event type `engagement_changed`.
- **CRM consumer:** `useSetEngagement`.
- **Frontend implemented:** yes.
- **Verification test:** `LV-08`.

### A1.4 `public.crm_set_contact_policy` — RPC

- **Input:** `crm_set_contact_policy(p_client_id uuid, p_to_policy text, p_reason text, p_concurrency_token text, p_idempotency_key uuid, p_contract_version text) returns jsonb`
- **Return:** `MutationResult`.
- **Policy identical to A1.2**; audit event type `contact_policy_changed`.
- **Additional side effect:** setting `Do Not Contact` MUST cancel active `crm_campaign_enrollments` for the client and emit a `campaign_cancelled_by_policy` audit row per cancellation.
- **CRM consumer:** `useSetContactPolicy`; DNC toggle in `PolicyAwareComposer`.
- **Frontend implemented:** yes.
- **Verification test:** `LV-09`.

### A1.5 `public.crm_set_service_policy` — RPC

- **Input:** `crm_set_service_policy(p_client_id, p_to_policy, p_reason, p_concurrency_token, p_idempotency_key, p_contract_version) returns jsonb`
- Policy identical to A1.2; audit event type `service_policy_changed`.
- **CRM consumer:** `useSetServicePolicy`.
- **Frontend implemented:** yes.
- **Verification test:** `LV-10`.

### A1.6 `public.crm_set_eligibility` — RPC

- **Input:** `crm_set_eligibility(p_client_id, p_to_state, p_manual_review jsonb, p_reason, p_concurrency_token, p_idempotency_key, p_contract_version) returns jsonb`
- **Extra validation:** when `p_to_state='Manual Review'`, `p_manual_review` must contain `{ owner, next_action, review_due_at }`; else `{ ok:false, error_code:'invalid_transition' }`.
- Audit event type `eligibility_changed`.
- **CRM consumer:** `useSetEligibility`.
- **Frontend implemented:** yes.
- **Verification test:** `LV-11`.

### A1.7 `public.crm_set_care_cadence` — RPC

- **Input:** `crm_set_care_cadence(p_client_id, p_to_cadence, p_reason, p_concurrency_token, p_idempotency_key, p_contract_version) returns jsonb`
- Policy identical to A1.2; audit event type `care_cadence_changed`.
- **CRM consumer:** `useSetCareCadence`.
- **Frontend implemented:** yes.
- **Verification test:** `LV-12`.

### A1.8 `public.crm_assign_clinician` — RPC

- **Input:** `crm_assign_clinician(p_client_id uuid, p_staff_id uuid, p_reason text, p_concurrency_token text, p_idempotency_key uuid, p_contract_version text) returns jsonb`
- **Extra validation:** `p_staff_id` must resolve to a `staff` row in the same tenant; else `{ ok:false, error_code:'invalid_transition', message:'staff_not_in_tenant' }`.
- Audit event type `clinician_assigned` with `{ prev_staff_id, new_staff_id }`.
- **CRM consumer:** assign-clinician action on `CanonicalClientDetail`.
- **Frontend implemented:** yes (wired through generic canonical mutation gate).
- **Verification test:** `LV-13`.

### A1.9 `public.crm_close_client` + `public.crm_reopen_client` — RPCs

- **Inputs:**
  - `crm_close_client(p_client_id uuid, p_disposition_reason text, p_reason text, p_concurrency_token text, p_idempotency_key uuid, p_contract_version text) returns jsonb`
  - `crm_reopen_client(p_client_id uuid, p_reason text, p_concurrency_token text, p_idempotency_key uuid, p_contract_version text) returns jsonb`
- **Behavior:** close sets lifecycle to `Closed`, `disposition_reason`, `disposition_at=now()`; reopen restores lifecycle to prior stage (or `Registration` if unknown), clears disposition fields.
- Audit event types: `closed`, `reopened`.
- Policy otherwise identical to A1.2.
- **CRM consumer:** close/reopen buttons on `CanonicalClientDetail`.
- **Frontend implemented:** yes.
- **Verification test:** `LV-14`, `LV-15`.

### A1.10 `public.crm_evaluate_communication_policy` — RPC

- **Input signature:**
  `crm_evaluate_communication_policy(p_client_id uuid, p_channel text, p_message_class text) returns jsonb`
  where `p_channel ∈ {'email','sms'}` and `p_message_class` is one of the eight classes in `supabase/functions/_shared/suppression.ts (MessageClass)`.
- **Return shape:** matches `SuppressionDecision`:
  ```json
  {
    "allowed": true|false,
    "reason_code": "ok" | "contact_policy_dnc" | "service_policy_blocked"
                 | "unknown_canonical_state" | "class_never_permitted"
                 | "lifecycle_closed_no_active_care",
    "policy_version": "<contract_version>",
    "contact_policy": "Normal"|"Do Not Contact"|null,
    "service_policy": "Normal"|"Service Blocked"|null
  }
  ```
- **Policy evaluation order:**
  1. Row missing → `unknown_canonical_state`, `allowed=false`.
  2. `service_policy = 'Service Blocked'` → block all classes.
  3. `contact_policy = 'Do Not Contact'` AND message class ∈ `{ ordinary_promotional, ordinary_campaign_follow_up, wait_path_ordinary }` → block.
  4. `lifecycle = 'Closed'` AND class ∈ `{ ordinary_promotional, ordinary_campaign_follow_up, wait_path_ordinary, active_care }` → block with `lifecycle_closed_no_active_care`.
  5. Administrative exception: classes `clinical_safety_legal`, `transactional_account`, `billing_insurance`, `necessary_scheduling`, `active_care` (when lifecycle open) always allowed unless service-blocked.
  6. Campaign suppression is enforced by `crm_campaign_enrollments.state`; when a client is cancelled, `ordinary_campaign_follow_up` is blocked via reason `contact_policy_dnc` (backend inference).
- **Enforcement:** RESULT IS AUTHORITATIVE. Every sending backend
  (`helpscout-proxy`, `ringcentral-sms`, `campaign-scheduler`) MUST call
  this RPC immediately before dispatch and MUST NOT dispatch on
  `allowed=false`. Frontend `PolicyAwareComposer` calls it only as a UX
  pre-check; the backend is the enforcement point. A client-supplied
  `allowed=true` is never trusted.
- **Grants:** `GRANT EXECUTE ON FUNCTION public.crm_evaluate_communication_policy(uuid,text,text) TO authenticated, service_role;`
- **Tenant isolation:** reads must respect tenant scoping; cross-tenant query returns `unknown_canonical_state`.
- **Idempotency:** n/a (read-only evaluator).
- **Required audit rows (written by sending edge functions, not the RPC itself):**
  - On block: `email_suppressed` or `sms_suppressed` in `crm_activity_events` with `{ reason_code, policy_version, channel, message_class }`.
  - On allow: no extra audit row (regular send audit still applies).
  - On administrative override (future): `communication_override` with actor + justification.
- **CRM consumers:**
  - `src/components/crm/canonical/PolicyAwareComposer.tsx` — pre-check.
  - `supabase/functions/helpscout-proxy/index.ts` — every send branch (reply, create-conversation, bulk-send).
  - `supabase/functions/ringcentral-sms/index.ts` — every send branch (single, bulk, campaign step).
  - `supabase/functions/campaign-scheduler/index.ts` — before every scheduled step.
- **Frontend implemented:** yes. Edge-function helper (`_shared/suppression.ts`) currently reads the view directly; must switch to this RPC call once deployed.
- **Verification test:** `LV-16`, `LV-17`, `LV-18`, `LV-19`.

### A1.11 `public.crm_activity_events` — insert lockdown

- **Object type:** table + RLS policies + GRANT changes.
- **Protected event types:**
  `status_change, lifecycle_changed, engagement_changed, contact_policy_changed, service_policy_changed, eligibility_changed, care_cadence_changed, clinician_assigned, closed, reopened, email_suppressed, sms_suppressed, campaign_cancelled_by_policy, communication_override`.
- **Required GRANTs after change:**
  ```sql
  REVOKE ALL ON public.crm_activity_events FROM anon, authenticated;
  GRANT SELECT ON public.crm_activity_events TO authenticated;
  GRANT ALL ON public.crm_activity_events TO service_role;
  ```
- **Required RLS policies:**
  ```sql
  ALTER TABLE public.crm_activity_events ENABLE ROW LEVEL SECURITY;

  -- READ: tenant-scoped
  CREATE POLICY crm_activity_events_select_tenant
    ON public.crm_activity_events FOR SELECT TO authenticated
    USING (tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships WHERE user_id = auth.uid()
    ));

  -- INSERT: service_role only (canonical RPCs run as SECURITY DEFINER
  -- with owner service_role; edge functions use service key).
  -- No authenticated INSERT policy is created, so PostgREST refuses.

  -- UPDATE/DELETE: never allowed via PostgREST; no policies created.
  ```
- **Immutability:** rows are append-only. No UPDATE/DELETE policy exists;
  administrative correction (if needed) is performed via a separate
  future `crm_correct_activity_event` RPC that inserts a compensating
  row rather than editing.
- **No anon access.** No broad authenticated INSERT/UPDATE/DELETE.
- **CRM consumer:** activity timeline reads on `CanonicalClientDetail`.
  Writes are done exclusively by A1.2–A1.9 RPCs and the edge functions
  listed in A1.10.
- **Frontend implemented:** yes (read-only reads only).
- **Verification test:** `LV-20`, `LV-21`.

### A1.12 `public.crm_client_state_audit` — DELIVERED (CRM-owned)
### A1.13 `public.crm_tasks`, `public.crm_exceptions`, `public.crm_idempotency_keys`, `public.crm_client_canonical_meta` — DELIVERED (CRM-owned)

---

## A2. Reports read-model views (required for `CanonicalReports` page)

All views MUST filter to
`tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())`.
All views: `GRANT SELECT ... TO authenticated`.
All views should be materialized or use covering indexes on
`(tenant_id, bucket_start)`; refresh cadence ≤ 15 min.

### A2.1 `public.v_crm_reports_funnel`

- **Purpose:** lifecycle-stage conversion funnel.
- **Columns:** `tenant_id uuid, bucket_start date, bucket_end date,
  stage text, entered_count int, exited_count int, current_count int,
  median_days_in_stage numeric`.
- **Semantics:** `entered/exited` are **event-based** (from
  `crm_client_state_audit lifecycle_changed`); `current_count` is
  **current-state** from `v_client_canonical_state`.
- **CRM consumer:** funnel section in `CanonicalReports`.

### A2.2 `public.v_crm_reports_engagement`

- **Purpose:** engagement-state distribution and transitions.
- **Columns:** `tenant_id, bucket_start, bucket_end, engagement text,
  current_count int, entered_count int, avg_days_to_normal numeric`.
- **Semantics:** `current_count` current-state; `entered_count` event-based.

### A2.3 `public.v_crm_reports_closure`

- **Purpose:** closures by disposition reason.
- **Columns:** `tenant_id, bucket_start, bucket_end,
  disposition_reason text, closed_count int, reopened_count int,
  net_closed int`.
- **Semantics:** all event-based from `closed` / `reopened` audit rows.

### A2.4 `public.v_crm_reports_campaigns`

- **Purpose:** campaign performance per campaign per period.
- **Columns:** `tenant_id, bucket_start, bucket_end, campaign_id uuid,
  enrolled_count int, completed_count int, cancelled_count int,
  responded_count int, suppressed_count int, failed_count int`.
- **Semantics:** all event-based from `crm_campaign_step_logs` and
  `crm_campaign_enrollments`; `suppressed_count` counts
  `email_suppressed`+`sms_suppressed` audit rows tagged with the
  campaign step id.

### A2.5 `public.v_crm_reports_tasks`

- **Purpose:** task workload and SLA.
- **Columns:** `tenant_id, bucket_start, bucket_end, assignee_id uuid,
  open_count int, completed_count int, overdue_count int,
  median_hours_to_complete numeric`.
- **Semantics:** `open_count`/`overdue_count` current-state at bucket end;
  `completed_count` event-based.

### A2.6 `public.v_crm_reports_exceptions`

- **Purpose:** exception queue KPIs.
- **Columns:** `tenant_id, bucket_start, bucket_end, exception_type text,
  raised_count int, resolved_count int, open_count int,
  median_hours_to_resolve numeric`.
- **Semantics:** `raised`/`resolved` event-based; `open_count` current-state.

**CRM consumer for A2.1–A2.6:** `src/pages/crm/canonical/CanonicalReports.tsx`
via `src/repositories/supabase/reports.ts`. Frontend does NOT recompute these
metrics from raw rows.

**Verification test:** `LV-22`, `LV-23`.

---

## A3. Optional (not launch-blocking)

- `public.crm_bulk_enroll_campaign(p_client_ids uuid[], p_campaign_id uuid, p_reason text, p_idempotency_key uuid, p_contract_version text) → jsonb`
- `public.crm_bulk_transition_lifecycle(...)` — fan-out helper.
- `public.crm_reengage_client(...)`

## A4. Explicitly NOT a CRM blocker
(unchanged — see previous revision; all `staff_*`, provider lifecycle,
clinical, billing, payroll, practice-config, forms, ClickUp mirror
tables remain owned by other apps.)

---

## Frontend completion evidence (this handoff)

- **Commit SHA:** `83afc019d7c094e3943f71ddd8f224dcaf31d07a`
- **Files changed since prior handoff:** see git log; last batch removed
  47 legacy files (see earlier deletions), added `CrmMutationGate`,
  `SuppressionBanner`, canonical hook fail-closed classification,
  Settings gate wrapping, `CampaignStepEditor` mutation gating, and
  hardened `p09-legacy-assertions.test.ts`.
- **Build:** passes (Vite production build not blocked by any missing
  contract; `CONTRACT_NOT_DEPLOYED` states are handled at runtime).
- **Type-check:** `bunx tsgo --noEmit` clean.
- **Lint:** `bunx eslint src` reports 93 pre-existing `any`-cast errors
  in `src/repositories/supabase/*.ts`. These are intentional temporary
  casts on `supabase.from(...)` calls that reference views/RPCs not yet
  in the generated `types.ts`. They MUST be removed by regenerating
  types after backend delivery (post-delivery step 1); no other lint
  errors exist. No new lint errors were introduced by this handoff.
- **Unit/integration tests:** `bunx vitest run` — 3 files, 20/20 passing.
  Includes `src/test/p09-legacy-assertions.test.ts` which statically
  asserts:
  - no direct `.update({ pat_status | assigned_therapist_id | contact_policy | service_policy | care_cadence | at_risk })` write anywhere in `src/`;
  - no legacy `-legacy` routes;
  - no imports of the 21 removed legacy hooks/components/pages.
- **Protected canonical state:** confirmed not written directly by the
  frontend (test above enforces this).
- **`pat_status` authority:** confirmed no authoritative CRM workflow
  reads or writes `pat_status`. The generated `types.ts` still declares
  the column (owned by other apps) but CRM code never uses it.
- **Fail-closed:** unavailable mutations render the read-only fallback
  from `CrmMutationGate`; unavailable canonical reads render the
  `CONTRACT_NOT_DEPLOYED` state via `SuppressionBanner`.
- **ClickUp mirror:** obsolete; no CRM code path calls `clickup_client_mirror_state`
  or the ClickUp edge function. Confirmed via `rg "clickup_client_mirror_state|crm_clickup_" src/`.
- **No fabricated success:** no mock responses, no temporary RPCs, no
  direct-table fallbacks. Every canonical mutation goes through the RPC
  helper in `src/hooks/crm/useCanonicalMutations.ts`.
- **Distinguishing unavailable-backend vs. app errors:** canonical read
  hook classifies missing-relation errors as `CONTRACT_NOT_DEPLOYED`
  (structured state) and other errors continue to surface via toast.
  Mutation gate refuses submission when the caller lacks
  admin/staff role or when the mutation hook reports the RPC missing.

---

## Post-delivery CRM steps

1. Regenerate `src/integrations/supabase/types.ts`.
2. Update `CONTRACT_VERSION` to match the deployed contract hash.
3. Remove the pre-existing `any` casts in `src/repositories/supabase/*.ts`
   and `src/hooks/crm/useCanonicalMutations.ts`; re-run lint.
4. Switch `supabase/functions/_shared/suppression.ts` from view-read to
   `crm_evaluate_communication_policy` RPC call.
5. Run the live verification suite below.
6. Update this document's per-contract "Current blocker" line to
   "DELIVERED — verified via LV-##".

---

## Live verification suite

Every test below must be run against project `ahqauomkgflopxgnlndd`
using two distinct authenticated users in two distinct tenants
(call them `USER_A` in `TENANT_A`, `USER_B` in `TENANT_B`) plus one
`service_role` key. Tests are described so they can be executed
manually via the Supabase SQL editor or automated via a Deno test in
`supabase/functions/_shared/crm-live-verification_test.ts`.

| ID | Test | Expected result |
|---|---|---|
| LV-01 | `USER_A` selects from `v_client_canonical_state WHERE client_id = <A_client>` | 1 row, all columns present and typed |
| LV-02 | `USER_A` selects from `v_client_canonical_state WHERE client_id = <B_client>` | 0 rows |
| LV-03 | `USER_A` calls `crm_transition_lifecycle` on `<A_client>` with valid stage + fresh `concurrency_token` + new `idempotency_key` | `{ok:true}`, one `lifecycle_changed` audit row created |
| LV-04 | `USER_A` calls same RPC on `<B_client>` | `{ok:false, error_code:'unauthorized'}`, no audit row |
| LV-05 | `USER_A` calls same RPC with invalid transition (e.g. `Closed → Lead`) | `{ok:false, error_code:'invalid_transition'}` |
| LV-06 | `USER_A` calls same RPC with stale `concurrency_token` | `{ok:false, error_code:'concurrency_conflict'}` |
| LV-07 | `USER_A` replays LV-03 with same `idempotency_key` | identical `{ok:true}`; audit rows count unchanged |
| LV-08 | `USER_A` calls `crm_set_engagement` on `<A_client>` | `{ok:true}`, `engagement_changed` audit row |
| LV-09 | `USER_A` calls `crm_set_contact_policy` to `Do Not Contact` on `<A_client>` with active enrollment | `{ok:true}`, `contact_policy_changed` audit row, all active `crm_campaign_enrollments` cancelled, one `campaign_cancelled_by_policy` audit row per cancellation |
| LV-10 | `USER_A` calls `crm_set_service_policy` | `{ok:true}`, `service_policy_changed` audit row |
| LV-11 | `USER_A` calls `crm_set_eligibility` to `Manual Review` without `manual_review` payload | `{ok:false, error_code:'invalid_transition'}` |
| LV-12 | `USER_A` calls `crm_set_care_cadence` | `{ok:true}`, `care_cadence_changed` audit row |
| LV-13 | `USER_A` calls `crm_assign_clinician` with a `staff_id` from `TENANT_B` | `{ok:false, error_code:'invalid_transition', message:'staff_not_in_tenant'}` |
| LV-14 | `USER_A` calls `crm_close_client` | `{ok:true}`, lifecycle=`Closed`, `closed` audit row |
| LV-15 | `USER_A` calls `crm_reopen_client` | `{ok:true}`, lifecycle restored, `reopened` audit row |
| LV-16 | `USER_A` calls `crm_evaluate_communication_policy(<A_DNC_client>,'sms','ordinary_campaign_follow_up')` | `{allowed:false, reason_code:'contact_policy_dnc'}` |
| LV-17 | Same, but `message_class='clinical_safety_legal'` | `{allowed:true, reason_code:'ok'}` |
| LV-18 | `USER_A` calls RPC for `<A_service_blocked_client>` any class | `{allowed:false, reason_code:'service_policy_blocked'}` |
| LV-19 | `USER_A` calls RPC for `<B_client>` | `{allowed:false, reason_code:'unknown_canonical_state'}` |
| LV-20 | `USER_A` runs `INSERT INTO crm_activity_events (tenant_id, client_id, event_type, ...) VALUES (...)` via PostgREST | permission-denied / RLS error; no row inserted |
| LV-21 | Trigger LV-03 and observe `crm_activity_events` — verify audit row is present and rows are not editable by `USER_A` (UPDATE/DELETE also refused) | insert visible; UPDATE/DELETE refused |
| LV-22 | `USER_A` selects from each of the six `v_crm_reports_*` views | rows returned only for `TENANT_A`; column shape matches contract |
| LV-23 | `USER_B` selects same views | no `TENANT_A` rows visible |
| LV-24 | `helpscout-proxy` send to DNC client with `ordinary_campaign_follow_up` | HTTP 200 `{status:'suppressed'}`, no HelpScout API call made, `email_suppressed` audit row written |
| LV-25 | `ringcentral-sms` bulk send with a DNC recipient | that recipient reports `suppressed`, no RingCentral API call, `sms_suppressed` audit row |
| LV-26 | `campaign-scheduler` tick with a DNC-enrolled client | step logged as `suppressed`, enrollment auto-cancelled if terminal |
| LV-27 | Regenerate `types.ts`, then `bunx tsgo --noEmit` and `bunx eslint src` | both clean; no residual `as any` casts on canonical objects |
| LV-28 | Frontend smoke test: canonical client detail loads for `USER_A`, all badges render authoritative values | no `CONTRACT_NOT_DEPLOYED` banner |
| LV-29 | Frontend smoke test: `USER_B` (staff of TENANT_B) navigates to a URL with `<A_client>` id | canonical hook returns `empty`, page shows structured unavailable-record state, no data leak |
| LV-30 | Frontend smoke test: non-admin/non-staff user attempts a lifecycle change | `CrmMutationGate` renders read-only fallback; no RPC call issued |

A contract row in this document may be marked "DELIVERED — verified"
only after every referenced `LV-##` passes and the CRM types file has
been regenerated.
