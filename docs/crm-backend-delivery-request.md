# CRM Backend Delivery Request

**Owner:** ValorWell CRM application (this repo)
**Target Supabase project:** `ahqauomkgflopxgnlndd`
**Contract version consumed:** `valorwell-crm-contracts@1.0.0+pending-supabase-hash`
(see `src/lib/crm/contracts/v1/index.ts`)

This document lists every backend object the CRM directly consumes. It supersedes
any global platform contract register for CRM purposes. Contracts owned by other
apps (billing, claims, ERA, payroll, credentialing, clinical, provider lifecycle)
are explicitly out of scope and are NOT listed here.

A contract may be marked "delivered" only when all of the following are true:

1. Migration file applied to project `ahqauomkgflopxgnlndd`.
2. `pg_proc` / `pg_views` shows the object at the declared signature.
3. `pg_class` privileges show the declared `GRANT`s.
4. Authorized round-trip from CRM succeeds (see Verification test column).
5. Unauthorized round-trip (wrong role or wrong tenant) is refused with the
   contract error shape.
6. Idempotency-key replay returns the original result without side effects
   (where the contract is marked idempotent).
7. Generated Supabase types include the new object and the CRM build succeeds
   after regeneration.

Until every criterion is satisfied the CRM will hold the affected UI in
`CONTRACT_NOT_DEPLOYED` fail-closed state.

---

## A1. Required for CRM launch

### 1. `public.v_client_canonical_state` (view)

- **Columns:** exactly the fields on `CanonicalClientState`
  (see `src/lib/crm/contracts/v1/client-state.types.ts`).
- **Grants:** `SELECT` on view to `authenticated`.
- **Caller role:** any authenticated admin/staff of tenant.
- **RLS:** tenant scoping enforced by underlying tables + view definition; the
  view MUST filter rows so only rows where the caller is a member of
  `tenant_id` are visible.
- **CRM consumer:** `src/hooks/crm/useCanonicalClientState.ts` (single and
  batch reads), all Canonical* pages, kanban, StateBadges.
- **Verification test:** signed in as admin, request one row for a known
  client — assert all columns present and correctly typed.
- **Current blocker:** view does not exist.

### 2. `public.crm_transition_lifecycle(client_id uuid, to_stage text, reason text, idempotency_key uuid, contract_version text) → jsonb`

- **Return:** `MutationResult` shape
  (see `src/lib/crm/contracts/v1/mutations.types.ts`).
- **Grants:** `EXECUTE` to `authenticated`.
- **Caller role:** must be admin or staff of the client's tenant. Enforced
  server-side via `crm_has_role(auth.uid(), 'admin'|'staff', tenant_id)`.
- **RLS:** function is `SECURITY DEFINER`; must validate tenant + role and
  refuse cross-tenant writes.
- **Idempotency:** repeated calls with the same `idempotency_key` within 24h
  return the original result.
- **Events emitted:** `lifecycle_changed` into `crm_client_state_audit` with
  prev/new value, actor, source, correlation id, reason.
- **Also writes:** the canonical lifecycle column read by
  `v_client_canonical_state`. MUST NOT be the legacy `pat_status` column;
  legacy triggers on `pat_status` remain owned by other apps.
- **CRM consumer:** `useTransitionLifecycle`, `useUpdateClientStatus`,
  `useBulkUpdateStatus` (via `crm_bulk_update_client_status` fan-out or a
  future `crm_bulk_transition_lifecycle`).
- **Verification test:**
  1. admin round-trip succeeds and audit row appears;
  2. staff of another tenant is refused with `forbidden`;
  3. replay with same `idempotency_key` returns original response with no new
     audit row.
- **Current blocker:** function does not exist.

### 3. `public.crm_set_engagement(client_id, to_state, reason, idempotency_key, contract_version) → jsonb`
Same policy as #2. Consumer: `useSetEngagement`.

### 4. `public.crm_set_contact_policy(client_id, policy, reason, idempotency_key, contract_version) → jsonb`
Same policy as #2. Consumer: `useSetContactPolicy`, DNC toggle in
`PolicyAwareComposer`. On `Do Not Contact` write, must also cancel active
campaign enrollments (see §8 of `docs/supabase-integration-contract.md`).

### 5. `public.crm_set_service_policy(client_id, policy, reason, idempotency_key, contract_version) → jsonb`
Same policy as #2. Consumer: `useSetServicePolicy`.

### 6. `public.crm_set_eligibility(client_id, state, manual_review jsonb, reason, idempotency_key, contract_version) → jsonb`
Same policy as #2. Consumer: `useSetEligibility`.

### 7. `public.crm_set_care_cadence(client_id, cadence, reason, idempotency_key, contract_version) → jsonb`
Same policy as #2. Consumer: `useSetCareCadence`.

### 8. `public.crm_assign_clinician(client_id, staff_id, reason, idempotency_key, contract_version) → jsonb`
Same policy as #2. Consumer: assign clinician action on client detail page.
Additional validation: `staff_id` must be a staff row in the same tenant.

### 9. `public.crm_close_client(client_id, disposition_reason, reason, idempotency_key, contract_version)` and `public.crm_reopen_client(client_id, reason, idempotency_key, contract_version)`
Same policy as #2. Consumer: close/reopen buttons on client detail. Must set
lifecycle to `Closed` (or restore) and emit closure/reopen audit events.

### 10. `public.crm_evaluate_communication_policy(client_id uuid, channel text, message_class text) → jsonb`

- **Return:** `{ allowed: boolean, reason_code: text, policy_version: text }`
  matching `SuppressionDecision` in `supabase/functions/_shared/suppression.ts`.
- **Grants:** `EXECUTE` to `authenticated` and `service_role`.
- **Caller role:** admin or staff of tenant (for UI pre-check); edge functions
  use service role.
- **RLS:** reads must respect tenant scoping; cross-tenant queries return
  `unknown_canonical_state`.
- **Idempotency:** n/a (read-only evaluator).
- **CRM consumer:** `PolicyAwareComposer` UI pre-check;
  `supabase/functions/helpscout-proxy` and `supabase/functions/ringcentral-sms`
  before every dispatch; `supabase/functions/campaign-scheduler` before each
  scheduled step.
- **Verification test:**
  - DNC client + `ordinary_campaign_follow_up` → `allowed=false`,
    `reason_code=contact_policy_dnc`.
  - Service-blocked client + any class → `allowed=false`,
    `reason_code=service_policy_blocked`.
  - Missing canonical row → `allowed=false`,
    `reason_code=unknown_canonical_state`.
- **Current blocker:** shared helper currently reads `v_client_canonical_state`
  directly; must be replaced with an RPC so the policy is centrally versioned
  and auditable.

### 11. `supabase/functions/helpscout-proxy` — server-side suppression call

- **Requirement:** every outbound send path (reply, create-conversation,
  bulk-send) must call `crm_evaluate_communication_policy` before dispatch and
  persist a `email_suppressed` audit row into `crm_client_state_audit` on
  block. Client-supplied `allowed=true` is never trusted.
- **CRM consumer:** `useReplyToConversation`, `useBulkSend`.
- **Verification test:** signed in as admin, attempt a send to a DNC client
  with `ordinary_campaign_follow_up` — assert HTTP 200 with
  `status: 'suppressed'`, no HelpScout call was made, audit row written.
- **Current blocker:** wiring exists in the shared helper but is not invoked
  on every branch of the proxy.

### 12. `supabase/functions/ringcentral-sms` — server-side suppression call

Same as #11 for SMS. Consumer: `useBulkSms`, campaign step SMS.
Verification: DNC recipient rejected pre-dispatch, audit row written.
Current status: helper is invoked on the main send path (line 276) — need to
verify every branch (bulk, individual, campaign step) does the same.

### 13. `public.crm_activity_events` — insert lockdown

- **Requirement:** revoke `INSERT` from `authenticated` for protected event
  types (`status_change`, `lifecycle_changed`, `engagement_changed`,
  `contact_policy_changed`, `service_policy_changed`, `eligibility_changed`,
  `care_cadence_changed`, `clinician_assigned`, `closed`, `reopened`,
  `email_suppressed`, `sms_suppressed`). Only `service_role` (via canonical
  RPCs and edge functions) may insert those rows.
- **Grants after change:** `SELECT` to `authenticated` (tenant scoped);
  `INSERT` to `service_role` only.
- **CRM consumer:** activity timeline reads. Writes are performed exclusively
  by canonical RPCs and edge functions.
- **Verification test:** direct client insert of `lifecycle_changed` from a
  signed-in user must fail with an RLS/permission error.
- **Current blocker:** RLS/grants currently permit direct inserts.

### 14. `public.crm_client_state_audit` (table) — DELIVERED
CRM-owned. RLS + grants in place.

### 15. `public.crm_tasks`, `public.crm_exceptions`, `public.crm_idempotency_keys`, `public.crm_client_canonical_meta` — DELIVERED
CRM-owned. RLS + grants in place.

---

## A2. Required only for later CRM features (not launch-blocking)

- `public.crm_bulk_enroll_campaign(client_ids uuid[], campaign_id uuid, ...) → jsonb`
  — bulk enrollment.
- `public.v_crm_reports_funnel`, `v_crm_reports_engagement`,
  `v_crm_reports_closure`, `v_crm_reports_campaigns`, `v_crm_reports_tasks`,
  `v_crm_reports_exceptions` — read models for Reports page.
- `public.crm_reengage_client(client_id, reason, idempotency_key, contract_version) → jsonb`
  — optional re-engagement action.

---

## A3. Explicitly NOT a CRM blocker

Removed from the CRM blocker list — owned by other applications:

- All `staff_*` credentialing tables (licenses, malpractice, CAQH, education,
  work history, certifications, disclosures, payer enrollments).
- Provider lifecycle tables (`provider_*`, `vaccn_*`).
- Clinical documentation (`appointment_clinical_notes`,
  `client_treatment_plans`, `client_safety_plans`, all assessments,
  `client_history_*`).
- Insurance / eligibility internals (`client_insurance*`, `eligibility_checks`
  detail, `client_diagnoses`).
- Billing and RCM (`claims`, `claim_*`, `era*`, `payment_allocations`,
  `client_charges`, `client_payments`, `client_payment_links`,
  `client_payment_methods`).
- Payroll (`payroll_*`).
- Practice configuration (`practice_info`, `practice_locations`, `services`,
  `cpt_codes`, `place_of_service`).
- Scheduling internals (`appointments`, `appointment_series`,
  `appointment_exceptions`, calendar sync tables).
- Forms platform (`form_*`, `consent_templates`).
- Backend contract registry itself (`backend_contract_*`).
- ClickUp mirror tables (`clickup_client_mirror_state`, `crm_clickup_*`) — UI
  and edge function already retired.

These remain owned by the shared backend / other apps. CRM does not consume
them and their absence does not block CRM launch.

---

## Post-delivery CRM steps

Once A1 items 1–13 are delivered and verified in Supabase:

1. Regenerate `src/integrations/supabase/types.ts`.
2. Confirm `CONTRACT_VERSION` matches the deployed contract hash.
3. Run read-only smoke tests first: canonical state read for a known client
   across every canonical page.
4. Run controlled mutation tests second: single lifecycle transition, single
   contact-policy set, single close, single reopen.
5. Verify tenant isolation: repeat every mutation with a user from a different
   tenant — every attempt must be refused.
6. Verify no direct protected-table writes remain (grep `src/` for
   `from('clients').update` with any of the protected columns).
7. Verify no `pat_status` workflow remains in CRM code paths (grep excluding
   generated types).
8. Update the action-state matrix and the final CRM audit report with the
   adopted commit SHA and Supabase migration hashes.
