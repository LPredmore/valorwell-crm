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

**Lifecycle / state RPCs (9):**
1. `public.crm_transition_lifecycle`
2. `public.crm_set_engagement`
3. `public.crm_set_contact_policy`
4. `public.crm_set_service_policy`
5. `public.crm_set_eligibility`
6. `public.crm_set_care_cadence`
7. `public.crm_assign_clinician`
8. `public.crm_close_client`
9. `public.crm_reopen_client`

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
  A1.2–A1.9 (nine lifecycle RPCs).

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

### A1.9a `public.crm_close_client` — RPC

- **Input:** `crm_close_client(p_client_id uuid, p_disposition_reason text, p_reason text, p_concurrency_token text, p_idempotency_key uuid, p_contract_version text) returns jsonb`
- **Return:** `MutationResult`.
- **Behavior:** sets lifecycle to `Closed`, sets `disposition_reason`, sets `disposition_at=now()`.
- **Audit event type:** `closed`.
- Role / tenancy / grants / idempotency policy identical to A1.2.
- **CRM consumer:** close button on `CanonicalClientDetail` (via `useCanonicalMutations`).
- **Frontend implemented:** yes.
- **Verification test:** `LV-14`.

### A1.9b `public.crm_reopen_client` — RPC

- **Input:** `crm_reopen_client(p_client_id uuid, p_reason text, p_concurrency_token text, p_idempotency_key uuid, p_contract_version text) returns jsonb`
- **Return:** `MutationResult`.
- **Behavior:** restores lifecycle to the prior non-Closed stage recorded on the last `closed` audit event (or `Registration` if unknown), clears `disposition_reason` and `disposition_at`.
- **Audit event type:** `reopened`.
- Role / tenancy / grants / idempotency policy identical to A1.2.
- **CRM consumer:** reopen button on `CanonicalClientDetail`.
- **Frontend implemented:** yes.
- **Verification test:** `LV-15`.

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
  Writes are done exclusively by A1.2–A1.9 (nine lifecycle RPCs) RPCs and the edge functions
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

- **CRM frontend code baseline SHA (frozen):** `83afc019d7c094e3943f71ddd8f224dcaf31d07a`.
  This is the pinned frontend baseline. This handoff document itself is
  a docs-only update on top of that baseline and produces a subsequent
  SHA solely for the doc change; no code files were modified.
- **Files changed in this handoff:** `docs/crm-backend-delivery-request.md` only.
- **Production build:**
  - Command: `bun run build` (`vite build`)
  - Exit code: `0`
  - Result: built successfully in ~7.3s; `dist/index.html`, `dist/assets/index-*.css` (69.22 kB / 12.07 kB gz), `dist/assets/index-*.js` (1,238.27 kB / 371.81 kB gz).
  - Warnings: (a) Vite chunk-size advisory — main bundle > 500 kB; cosmetic, does not affect runtime, chunking, dependency resolution, env vars, or deployment. (b) `caniuse-lite` data 13 months old — cosmetic; no runtime impact. No warnings affect deploy correctness.
- **Type-check:** `bunx tsgo --noEmit` — clean, no errors.
- **Lint:** `bunx eslint src --max-warnings=0` — 93 pre-existing
  `@typescript-eslint/no-explicit-any` errors, all in
  `src/repositories/supabase/*.ts` and `src/hooks/crm/useCanonicalMutations.ts`.
  Every one is a deliberate `(supabase as any)` cast against a view or
  RPC that is not yet in generated `types.ts`. Per §5 of this document
  these MUST NOT be cleared by inventing local types; they clear
  automatically when types are regenerated post-deployment (LV-27).
  No new lint errors were introduced.
- **Unit/integration tests:** `bunx vitest run` — 3 files, 20/20 passing.
  Includes `src/test/p09-legacy-assertions.test.ts` which statically
  asserts:
  - no direct `.update({ pat_status | assigned_therapist_id | contact_policy | service_policy | care_cadence | at_risk })` write anywhere in `src/`;
  - no legacy `-legacy` routes;
  - no imports of the 21 removed legacy hooks/components/pages.
- **Working tree:** clean at the doc-write SHA; no untracked or modified files outside `docs/`.
- **Protected canonical state:** confirmed not written directly by the
  frontend (test above enforces this).
- **`pat_status` authority:** confirmed no authoritative CRM workflow
  reads or writes `pat_status`. Generated `types.ts` still declares the
  column (owned by other apps); CRM code never uses it.
- **Fail-closed:** unavailable mutations render `CrmMutationGate`'s
  read-only fallback; unavailable canonical reads render the
  `CONTRACT_NOT_DEPLOYED` state via `SuppressionBanner`.
- **ClickUp mirror:** obsolete; no CRM code path calls
  `clickup_client_mirror_state` or the ClickUp edge function
  (`rg "clickup_client_mirror_state|crm_clickup_" src/` → 0 matches).
- **No fabricated success:** no mock responses, no temporary RPCs, no
  direct-table fallbacks. Every canonical mutation flows through
  `src/hooks/crm/useCanonicalMutations.ts`.
- **Distinguishing unavailable-backend vs. app errors:** canonical read
  hook classifies missing-relation / PGRST20{1,2} errors as
  `CONTRACT_NOT_DEPLOYED`; other errors surface via toast. Mutation
  gate refuses submission when caller lacks admin/staff role or when
  the RPC layer reports the contract missing.

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

The suite is **documentation-only at this handoff**. No executable
automated test file exists yet for LV-01…LV-30. The prior draft of
this document incorrectly implied an existing test file
(`supabase/functions/_shared/crm-live-verification_test.ts`) — that
file does NOT exist in this repo (`find supabase/functions -name '*_test.ts' -o -name '*.test.ts'` returns nothing).

Fixtures required before any LV test can run:

- `USER_A` — admin/staff of `TENANT_A`; auth JWT.
- `USER_B` — admin/staff of `TENANT_B`; auth JWT.
- `USER_C` — authenticated user with neither `admin` nor `staff` role.
- `service_role` key (server-side only, never in browser).
- Seed rows: one canonical client per tenant, one DNC client in
  `TENANT_A`, one service-blocked client in `TENANT_A`, one active
  campaign enrollment on the DNC client, one staff row per tenant.

Classification (all rows currently backend-blocked because the target
objects do not exist in project `ahqauomkgflopxgnlndd`):

| ID | Target | Automated? | File / procedure | Current status | Expected post-deployment result |
|---|---|---|---|---|---|
| LV-01 | `v_client_canonical_state` read (own tenant) | Manual (SQL editor) or scriptable via `curl` + PostgREST | procedure §Live verification | backend-blocked | 1 row, all columns typed |
| LV-02 | `v_client_canonical_state` cross-tenant read | Manual | procedure | backend-blocked | 0 rows |
| LV-03 | `crm_transition_lifecycle` authorized | Manual | procedure | backend-blocked | `{ok:true}` + audit row |
| LV-04 | `crm_transition_lifecycle` cross-tenant | Manual | procedure | backend-blocked | `{ok:false, error_code:'unauthorized'}` |
| LV-05 | `crm_transition_lifecycle` invalid transition | Manual | procedure | backend-blocked | `{ok:false, error_code:'invalid_transition'}` |
| LV-06 | `crm_transition_lifecycle` stale concurrency token | Manual | procedure | backend-blocked | `{ok:false, error_code:'concurrency_conflict'}` |
| LV-07 | `crm_transition_lifecycle` idempotency replay | Manual | procedure | backend-blocked | identical result, no duplicate audit |
| LV-08 | `crm_set_engagement` | Manual | procedure | backend-blocked | `{ok:true}` + `engagement_changed` audit |
| LV-09 | `crm_set_contact_policy` → DNC cancels enrollments | Manual | procedure | backend-blocked | `{ok:true}` + `contact_policy_changed` + `campaign_cancelled_by_policy` per cancellation |
| LV-10 | `crm_set_service_policy` | Manual | procedure | backend-blocked | `{ok:true}` + `service_policy_changed` audit |
| LV-11 | `crm_set_eligibility` requires manual-review payload | Manual | procedure | backend-blocked | `{ok:false, error_code:'invalid_transition'}` |
| LV-12 | `crm_set_care_cadence` | Manual | procedure | backend-blocked | `{ok:true}` + `care_cadence_changed` audit |
| LV-13 | `crm_assign_clinician` cross-tenant staff | Manual | procedure | backend-blocked | `{ok:false, error_code:'invalid_transition', message:'staff_not_in_tenant'}` |
| LV-14 | `crm_close_client` | Manual | procedure | backend-blocked | lifecycle=Closed, `closed` audit |
| LV-15 | `crm_reopen_client` | Manual | procedure | backend-blocked | lifecycle restored, `reopened` audit |
| LV-16 | `crm_evaluate_communication_policy` DNC ordinary | Manual | procedure | backend-blocked | `{allowed:false, reason_code:'contact_policy_dnc'}` |
| LV-17 | `crm_evaluate_communication_policy` clinical exception | Manual | procedure | backend-blocked | `{allowed:true}` |
| LV-18 | `crm_evaluate_communication_policy` service-blocked | Manual | procedure | backend-blocked | `{allowed:false, reason_code:'service_policy_blocked'}` |
| LV-19 | `crm_evaluate_communication_policy` cross-tenant | Manual | procedure | backend-blocked | `{allowed:false, reason_code:'unknown_canonical_state'}` |
| LV-20 | `crm_activity_events` direct INSERT refused | Manual (PostgREST) | procedure | backend-blocked | permission-denied |
| LV-21 | `crm_activity_events` UPDATE/DELETE refused | Manual | procedure | backend-blocked | permission-denied |
| LV-22 | six `v_crm_reports_*` views, own tenant | Manual | procedure | backend-blocked | tenant-scoped rows |
| LV-23 | six `v_crm_reports_*` views, cross-tenant | Manual | procedure | backend-blocked | no leak |
| LV-24 | `helpscout-proxy` enforces suppression | Manual (invoke edge fn) | procedure | backend-blocked (requires A1.10 RPC) | `{status:'suppressed'}` + `email_suppressed` audit |
| LV-25 | `ringcentral-sms` enforces suppression | Manual | procedure | backend-blocked | recipient `suppressed` + `sms_suppressed` audit |
| LV-26 | `campaign-scheduler` enforces suppression | Manual | procedure | backend-blocked | step `suppressed`, enrollment cancelled if terminal |
| LV-27 | Regenerate `types.ts`, typecheck + lint clean | Automated once types exist: `bunx tsgo --noEmit && bunx eslint src --max-warnings=0` | run at repo root | blocked on types regen | 0 errors, 0 residual casts |
| LV-28 | Frontend smoke: canonical detail loads | Manual browser walk-through | procedure | backend-blocked | no `CONTRACT_NOT_DEPLOYED` banner |
| LV-29 | Frontend smoke: cross-tenant client id | Manual | procedure | backend-blocked | structured empty state, no leak |
| LV-30 | Frontend smoke: non-admin/staff mutation gated | Static assertion + manual click-through. Static portion is covered by `src/test/p09-legacy-assertions.test.ts` (removed-legacy imports); live click-through remains manual. | file: `src/test/p09-legacy-assertions.test.ts` | static portion **passing** (`bunx vitest run` — 20/20); live click-through backend-blocked | gate renders read-only fallback, no RPC issued |

Summary counts:

- Already implemented & passing as automated tests: **0** end-to-end LV tests. The only automated coverage today is the static portion of LV-30 via `p09-legacy-assertions.test.ts`.
- Implemented but skipped pending contract: **0**.
- Manual live-verification procedures: **LV-01 … LV-26, LV-28, LV-29** (28 tests).
- Automatable once backend deployed (planned): **LV-27** (typecheck + lint, one-shot after `types.ts` regen).
- Documentation-only: entire suite is currently documentation; no
  vitest/deno file executes any RPC round-trip today.

A contract row in this document may be marked "DELIVERED — verified"
only after every referenced `LV-##` passes against live project
`ahqauomkgflopxgnlndd` and the CRM types file has been regenerated.

---

## Backend completion trigger

The CRM remains **backend-blocked** and MUST NOT be considered live
until the Supabase project `ahqauomkgflopxgnlndd` has:

1. **Published all required objects** listed in the Quick index:
   `v_client_canonical_state`, all nine lifecycle RPCs
   (`crm_transition_lifecycle`, `crm_set_engagement`,
   `crm_set_contact_policy`, `crm_set_service_policy`,
   `crm_set_eligibility`, `crm_set_care_cadence`,
   `crm_assign_clinician`, `crm_close_client`, `crm_reopen_client`),
   `crm_evaluate_communication_policy`, all six
   `v_crm_reports_*` views, and the `crm_activity_events` lockdown.
2. **Applied the exact signatures** documented in A1.1–A1.11 and
   A2.1–A2.6. Any parameter name / return-shape drift is a rejection.
3. **Applied tenant-scoped RLS** on every read surface and every RPC's
   internal reads/writes, sourced from `tenant_memberships` /
   `crm_has_role(auth.uid(), ...)`.
4. **Applied explicit GRANT/REVOKE controls** as specified — including
   the `REVOKE ALL … FROM anon, authenticated` + `GRANT SELECT …
   TO authenticated` + `GRANT ALL … TO service_role` on
   `crm_activity_events`, and `GRANT EXECUTE` on every RPC.
5. **Enforced idempotency** on all nine lifecycle RPCs via
   `public.crm_idempotency_keys` (24h replay window).
6. **Enforced communication suppression at the sending backend** —
   `helpscout-proxy`, `ringcentral-sms`, and `campaign-scheduler` all
   call `crm_evaluate_communication_policy` server-side and refuse
   dispatch on `allowed=false`. Frontend result is never trusted.
7. **Passed authorized and unauthorized round-trip tests** — LV-01
   through LV-26 with a real `USER_A`/`USER_B`/`USER_C` fixture set.
8. **Produced the contract release/version evidence** — new
   `backend_contract_releases` row with matching `contract_version`,
   which is then wired into `src/lib/crm/contracts/v1/index.ts` as
   `CONTRACT_VERSION`.

Only after all eight conditions are satisfied and every `LV-##` has
been executed against live Supabase may the CRM be declared launched
and the "Current blocker" lines in A1 be updated to
"DELIVERED — verified via LV-##".
