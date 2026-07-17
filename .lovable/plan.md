# CRM Production-Workflow Correction — Implementation Plan

Scope: make the CRM functionally ready for one controlled live test Patient, using only the existing canonical contracts and additive backend changes. Delivered in sequenced phases so each migration and edge-function change is reviewable before the next lands.

## Phase 0 — Discovery (no writes)

Before any change I will confirm current state with read-only tool calls:

- `supabase--read_query` — list all `crm_*` RPC signatures + grants, RLS on `crm_tasks`, `crm_exceptions`, `crm_campaign_enrollments`, `crm_campaign_step_logs`, `crm_notes`, `crm_activity_events`, `crm_campaign_triggers`, `crm_client_state_audit`; enum values for lifecycle/engagement/eligibility/policy/cadence; existing `enroll_campaign_on_status_change` trigger definition; current `crm_campaign_triggers` columns.
- `code--view` — the active hooks/repos/pages listed in each phase to confirm the exact broken call sites before rewriting.
- `supabase--edge_function_logs` + repo diff — confirm deployed `ringcentral-sms` and `helpscout-proxy` source matches `supabase/functions/*`; if drift, resync repo first.

Findings that change any phase below will be reported before I execute that phase.

## Phase 1 — Server-authoritative CRM operating context (req §1)

Backend (one additive migration):
- New enum `crm_capability_role` = `crm_admin | crm_operator | crm_readonly | crm_none`.
- New table `crm_user_capabilities(profile_id, tenant_id, crm_role, granted_by, granted_at)` — additive, tenant-scoped, RLS: self-select + service_role write.
- RPC `public.get_crm_operating_context()` returns JSON `{profile_id, current_tenant_id, available_tenants[], crm_role, capabilities{mutate, communicate, manage_campaigns, report}, contract_version}`. Resolves current tenant from `crm_user_capabilities` first, then falls back to `tenant_memberships` only when a single row exists; otherwise returns `available_tenants` and `current_tenant_id = null` so the UI must pick.
- Seed: every existing `user_roles.role IN ('admin','staff')` profile gets a matching `crm_user_capabilities` row (`admin -> crm_admin`, `staff -> crm_operator`) per tenant they already have membership in. No sibling app changed.

Frontend:
- Rewrite `CrmAuthProvider` to call `get_crm_operating_context()`, expose `capabilities`, `availableTenants`, `switchTenant(tenantId)`.
- Replace `useCanMutate` and `CrmMutationGate` with capability-driven checks.
- Add a tenant switcher in `CrmHeader` shown only when >1 tenant.
- Fail closed everywhere when context resolution errors.

## Phase 2 — Individual SMS (req §2)

Backend: new edge function `crm-send-client-sms` (leaves `ringcentral-sms` bulk/webhook untouched). Validates JWT → resolves operating context → loads client + phone → calls `crm_evaluate_communication_policy` → sends via RingCentral → writes `crm_activity_events` + communication row. Returns stable `sent|suppressed|invalid_phone|unauthorized|provider_failure`. Accepts only the whitelisted `messageClass` vocabulary.

Frontend: `src/repositories/supabase/communications.ts` `sendSms` now invokes `crm-send-client-sms`. Remove the `ringcentral-sms` individual-send call path.

## Phase 3 — Individual HelpScout email (req §3)

Frontend/repo fix only (edge function already correct):
- Rewrite email send path to call `helpscout-proxy?action=create-conversation` with `{subject, customerEmail, customerName, text, messageClass}`.
- Always resolve recipient email from the canonical client record — operator cannot substitute a different address.
- Call policy evaluator first; map results to stable enum.
- Reply path uses `?action=reply&conversationId=…`.
- Remove `action:"sendEmail"` body-based call.

## Phase 4 — Internal notes (req §4)

Rewrite the notes repo/hook:
- Use `operatingContext.currentTenantId` and `operatingContext.profileId` as UUIDs.
- Verify client belongs to tenant.
- Insert into `crm_notes` with `note_type='internal'`, no hardcoded emails/tenant strings.
- Surface in the timeline distinctly from external comms.

## Phase 5 — Patient selector in Communications (req §5) ✅

- New `<ClientPicker>` (search across `pat_name_preferred | pat_name_f/l | email | phone`, tenant-scoped, canonical clients).
- `CanonicalInbox` composer requires explicit selection; Send disabled until picked; resets on channel change / close.
- When opened from `CanonicalClientDetail`, preselect that client.

## Phase 6 — Server-policy-authoritative composer (req §6)

- `PolicyAwareComposer` removes any local rule interpretation.
- Calls `crm_evaluate_communication_policy` on channel/message-class change AND immediately before send (stale-state guard).
- Displays backend reason code with friendly copy map.
- Blocks send on deny; shows override-not-allowed messaging.

## Phase 7 — Canonical campaign auto-enrollment (req §7) ✅

Backend migration:
- Additive columns on `crm_campaign_triggers`: `trigger_dimension`, `trigger_operator`, `trigger_value`, `trigger_event`, `trigger_version`. Existing rows stay valid.
- Drop the active `enroll_campaign_on_status_change()` trigger; keep function body for history (renamed `_legacy_…`) but not attached.
- New trigger on `crm_client_state_audit` (post-insert) → `crm_process_canonical_campaign_triggers(client_id, tenant_id, event)` that matches active triggers, checks policy, prevents duplicate active enrollment, atomically creates enrollment + first step log, writes activity event, idempotent per `(client_id, campaign_id, event_hash)`.
- Data migration: remap existing `Registered/Matching/Waitlist` campaigns to canonical dimensions. `Interested` and any ambiguous legacy campaign flagged `is_manual_only=true` (new boolean) and shown in UI as Manual.

## Phase 8 — Atomic manual enrollment RPC (req §8) ✅

- New RPC `crm_enroll_clients_in_campaign(p_campaign_id, p_client_ids[], p_reason, p_idempotency_key, p_contract_version)` returning `jsonb[]` of per-client results. Transactional: enrollment + first step in one tx; policy-checked; tenant-checked; idempotent.
- Frontend enrollment UI switches to this RPC. Remove every direct insert into `crm_campaign_enrollments` / `crm_campaign_step_logs` from `src/hooks/crm/*` and `src/repositories/supabase/campaigns.ts`.

## Phase 9 — Controlled enrollment state actions (req §9) ✅

- New RPCs: `crm_pause_enrollment`, `crm_resume_enrollment`, `crm_cancel_enrollment`, `crm_mark_enrollment_responded`, `crm_restart_enrollment`. All: tenant-check, reason, idempotency, audit event, cascade-suppress scheduled step logs when appropriate.
- UI: replace "Remove Enrollment" destructive delete with Cancel/Archive. Permanent delete removed from operator UI.


## Phase 10 — Transition-aware lifecycle controls (req §10) ✅

- New RPC `crm_allowed_lifecycle_transitions(p_client_id)` returning valid next stages + reason-why-not for blocked ones (single source of truth).
- `CanonicalClientDetail` lifecycle control queries this RPC via `useAllowedLifecycleTransitions`, renders only allowed transitions (Closed hidden — routed to Phase 11 Close dialog), requires a reason (min 3 chars) in a confirmation dialog, and refetches allowed transitions + client state on `concurrency_conflict`.

## Phase 11 — Close Client dialog (req §11) ✅

Dedicated `<CloseClientDialog>` on `CanonicalClientDetail`: disposition picker uses the exact `CLOSURE_REASONS` contract vocabulary, required reason (min 3 chars), optional notes, "what closing does" explainer, then calls `dataProvider.clients.close` which invokes `crm_close_client` with a fresh concurrency token, fresh idempotency key, and contract version. Lifecycle dropdown no longer offers Closed (routed here via `use_close_client`). Close button is hidden when the client is already Closed.

## Phase 12 — Reopen Client (req §12) ✅

Reopen action visible only when `lifecycle='Closed'`. Reason required (min 3 chars). Calls `crm_reopen_client` via `dataProvider.clients.reopen`. Preserves historical closure event. No auto-restart of cancelled campaigns.

## Phase 13 — Eligibility Manual Review dialog (req §13) ✅

Dialog `<EligibilityManualReviewDialog>` on `CanonicalClientDetail` captures reason (min 3), owner, next_action, and review_due_at, and calls `crm_set_eligibility` with a full `p_manual_review` JSON payload. Manual Review is removed from the plain eligibility dropdown so it can only be set via the dialog. Repository enforces the payload requirement — `updateEligibility` throws when `Manual Review` is selected without a `manualReview` object. Eligibility tab shows the current state and offers a Set/Update Review action depending on whether the client is already in Manual Review.

## Phase 14 — Clinician assignment (req §14) ✅

- New `<AssignClinicianDialog>` on `CanonicalClientDetail` filters `useStaffList()` to the client's tenant, `Active` status, clinician/staff role, and `availability !== 'Unavailable'`; requires a ≥3-char reason; routes through `dataProvider.clients.assignClinician(id, staffId, reason)` → `crm_assign_clinician` RPC with fresh concurrency token, idempotency key, and contract version. Direct writes to `clients.primary_staff_id` remain forbidden. Server-side `v_crm_eligible_clinicians_for_client` view deferred pending readiness-table exposure — noted in backend delivery request.

## Phase 15 — Journey / Audit display (req §15) ✅

- Audit repository now returns a stable `eventType` (the raw `crm_client_state_audit.dimension` — `lifecycle_stage`, `engagement_state`, `eligibility_state`, `contact_policy`, `service_policy`, `care_cadence`, `closure_reason`, `at_risk`, `legacy_pat_status`) and a separate `eventLabel` for display. Filters no longer key off human copy.
- `CanonicalClientDetail` Journey tab filters by `eventType === 'lifecycle_stage'`; the Audit tab shows `eventLabel` while preserving previous/next values, actor, source, and reason. Clinician assignment / policy / cadence / eligibility events already flow through the same audit stream and appear alongside lifecycle rows.
- `AuditEvent` domain type updated; mocks and adapters aligned. 86/86 tests pass.

## Phase 16 — Task management (req §16)

Full CRUD via `crm_tasks` with tenant RLS: create, edit, assign/reassign, collaborators (additive `crm_task_collaborators` table), priority, type, start/due, checklist (additive `crm_task_checklist_items`), tags, complete, cancel. Client detail Tasks tab gets Add Task + row navigation to detail. All writes carry operating-context tenant + creator.

## Phase 17 — Exceptions ↔ tasks (req §17)

Verify/repair: view, resolve, dismiss, reassign, create-linked-task. Linked task carries exception_id, client_id, campaign_id, priority-from-severity, creator. Idempotency guard against double task creation.

## Phase 18 — Remove obsolete/competing paths (req §18)

Ripgrep sweep + delete:
- Any direct frontend update of canonical state columns, `primary_staff_id`, enrollments/step_logs.
- Legacy `pat_status` CRM mutations, hardcoded tenant/sender strings, fabricated success returns.
- Duplicate client/campaign/comms implementations. One active implementation per workflow.
- Ensure no legacy route stays reachable.

## Phase 19 — Real-Patient onboarding compatibility (req §19)

Verify (no code change unless a gap surfaces): a client inserted through the real onboarding flow gets canonical defaults, appears in CRM list, has usable concurrency token, can progress from Registration, be assigned, receive policy-approved comms, enter canonical campaign, create tasks/audit. No synthetic CRM-only patient path introduced. No plaintext password handling.

## Phase 20 — Shared-app impact review (req §20)

Every migration audited against Client / Staff / Billing / Credentialing / scheduling / claims / provider-matching / HelpScout / RingCentral / campaign-scheduler. All changes additive: new tables, new columns with defaults, new RPCs, extended (not replaced) triggers. Report per-app impact assessment.

## Phase 21 — Static verification (req §21)

`bun run lint`, `tsgo` app + tooling, `bunx vitest run`, `bun run build`, ripgrep for forbidden direct writes / hardcoded tenants / legacy `pat_status` mutations, edge-function repo-vs-deployed diff, RPC signature+grant inspection, RLS inspection for every touched table, confirmation no `anon` grants on protected mutations. No live sends, no live patient created.

## Phase 22 — Final completion evidence (req §22)

Report with: commit SHA, changed files, migrations applied, RPC signatures, edge function versions/hashes, grants, RLS policies, active UI route per workflow, obsolete-code confirmation, ripgrep results, build/lint/type/test results, shared-app compatibility notes, remaining blockers. One of the two required verdicts.

---

## Execution model

- Phases are executed in numeric order across multiple turns. Each backend phase is one migration + one edge-function change at most, submitted via `supabase--migration` for your approval before running.
- After each phase I report: what shipped, static-verification result, any surprises from Phase 0 read-back, and the next phase's exact plan.
- No live SMS/email/patient mutation at any point in this implementation pass.
- If any Phase 0 discovery contradicts an assumption above (e.g. an RPC already exists with a different signature), I will report and revise before proceeding.

## Out of scope

- Publishing `backend_contract_releases` row (explicitly deferred until live validation passes).
- Live message sends, live test-patient creation, sibling-app regression runs — all are human-driven steps after `IMPLEMENTATION READY…` verdict.
