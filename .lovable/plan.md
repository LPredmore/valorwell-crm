# Communications Control Plane — Foundation (Phases 0–4)

Approved scope for this increment: baseline, provider-applicant worker extraction, canonical person identity, campaign registry, participation history. Nothing user-visible changes and no existing automation is cut over. Later phases (trigger engine, staff/donor campaigns, newsletters, unified UI) each get their own plan.

## Verified current state

- `campaign-scheduler` (910 lines) really does carry two unrelated responsibilities: client campaign step processing and provider-applicant communication jobs (claim RPC `crm_claim_provider_applicant_communication_jobs`, Resend send, SMS via RingCentral, terminal-state revalidation, completion RPC).
- Live tables already present: `crm_campaigns`, `crm_campaign_steps`, `crm_campaign_enrollments`, `crm_campaign_step_logs`, `crm_campaign_triggers`, `relationship_campaigns`, `relationship_campaign_enrollments`, `relationship_campaign_communications`/`relationship_communications`, `provider_applicants`, `crm_provider_applicant_communication_jobs`, `crm_email_messages`, `crm_email_events`, `crm_bulk_send_logs` (+ recipients, staff recipients), `givebutter_donations`, `donation_attribution`.
- No identity, registry, event-outbox, or newsletter tables exist yet.
- Existing legacy auto-enrollment trigger function `_legacy_enroll_campaign_on_status_change` is in the database and stays untouched in this increment.

## Phase 0 — Baseline and release safety

- Produce a baseline report (row counts for every table listed above, active campaigns with enrollment counts, and the full inventory of `cron.job` entries invoking campaign-scheduler, relationship-campaign-worker, crm-resend-email, crm-resend-staff-broadcast, Givebutter functions, and the BTY dispatcher). Committed as `docs/communications-control-plane-baseline.md` so later phases can diff against it.
- Add the implementation feature flags, all defaulting off, alongside the existing relationship flag mechanism: `communications_control_plane_enabled`, `campaign_trigger_engine_enabled`, `client_trigger_cutover_enabled`, `bty_trigger_cutover_enabled`, `staff_campaigns_enabled`, `donor_campaigns_enabled`, `universal_newsletters_enabled`, `newsletter_mailbox_suppression_enabled`.
- No destructive migration. Every migration in this increment is additive.

## Phase 1 — Extract provider-applicant communication

- New edge function `provider-applicant-communication-worker` containing the applicant logic moved verbatim from `campaign-scheduler`: job claiming, terminal-state revalidation, email/SMS send, retries, content versions, `crm_email_messages` linkage, RingCentral support, response tracking, delivery acceptance, lifecycle updates.
- Shared helpers (Resend transport, idempotency key, phone/email normalization) extracted into `supabase/functions/_shared/` rather than copied.
- Verification mode first: the new worker runs against the same queue with sending disabled by a flag, and I compare claimed jobs and computed content against what campaign-scheduler would produce.
- Only after that comparison is clean do I remove applicant processing from `campaign-scheduler` and schedule the new worker. Applicant behavior does not change.

## Phase 2 — Canonical person identity

- New tables `crm_people`, `crm_person_record_links` (unique on tenant + record_type + record_id), `crm_person_emails` — RLS enabled at creation, explicit grants, no `anon` access, service_role for workers.
- Backfill order: clients, staff, provider applicants, relationship contacts, known donor identities. Links only from deterministic evidence (same `profile_id`, explicit applicant→staff conversion/handoff records, existing explicit cross-record links).
- Exact-email linking used only where unambiguous. Never auto-merge on name alone, phone alone, stripped `+alias`, shared household mailbox, or organization affiliation. When uncertain, separate people are created.
- Reconciliation report view/RPC exposing `unlinked_records`, `ambiguous_identity_candidates`, `multiple_people_same_exact_email`, `multiple_people_same_newsletter_mailbox`, `applicant_staff_possible_matches`, `relationship_profile_matches`. Ambiguous matches are never auto-resolved.
- `newsletter_mailbox_key(email)` is added as a pure SQL/TS helper in this phase for reporting only. It is not used for identity, login, campaigns, or reply routing. Global email normalization stays `trim().toLowerCase()` and the two functions stay explicitly named (`normalizeEmailAddress`, `newsletterMailboxKey`).

## Phase 3 — Campaign registry

- New table `crm_campaign_registry` with `audience_domain`, `engine_type`, `engine_campaign_id`, `name`, `lifecycle_status`, `concurrency_group`, `priority`, unique on (engine_type, engine_campaign_id).
- Register existing `crm_campaigns` rows as client/client and existing `relationship_campaigns` rows as bty/relationship. No campaign data is moved or cloned; the engine tables remain the execution source of truth.
- Existing client campaigns get concurrency group `LEGACY_CLIENT_EXCLUSIVE` recorded now so Phase 6 can preserve today's one-active-campaign behavior. No concurrency behavior changes in this increment.
- Keep the registry in sync with engine campaign creation/rename/status changes via triggers on the two engine tables, so the registry cannot drift.

## Phase 4 — Participation history projection

- `crm_campaign_participation_v` as a view over the existing client and relationship enrollment tables (no duplicated authoritative history), exposing person, registry, engine, source record, start/end, status, outcome, response timestamp.
- Normalized outcome vocabulary: responded, interested, no_response, completed_normally, state_changed, do_not_contact, suppressed, failed, manually_stopped. Historical rows that cannot be reliably classified stay `legacy_unknown` — nothing is inferred.
- History filter RPC supporting ever/never participated, currently active, started-within and completed-within 1/2/3/6/12 months, responded, no response, interested, suppressed, stopped — all filtering on indexed source timestamps.

## Indexes and permissions

Indexes added in this increment: `crm_person_record_links(tenant_id, record_type, record_id)` and `(tenant_id, person_id)`; `crm_person_emails(tenant_id, normalized_email)`; `crm_campaign_registry(tenant_id, audience_domain, lifecycle_status)`; supporting indexes on the enrollment timestamps the participation filters use.

Every new table has RLS at creation. `crm_people` is not exposed as a cross-domain data union — person identity grants no domain authorization, and no sensitive domain attributes are copied into the identity tables. Every SECURITY DEFINER function validates tenant, pins `search_path`, checks capability or worker authorization, and avoids dynamic SQL.

## Ecosystem impact

All changes are additive: new tables, new views, new functions, one new edge function, and removal of applicant processing from campaign-scheduler only after equivalence is verified. No existing column, constraint, or primary key on `clients`, `staff`, `provider_applicants`, `relationship_*`, `givebutter_donations`, or `donation_attribution` is altered, so the Clients, Staff, Billing, and Onboarding projects are unaffected. Clinical, scheduling, billing, payroll, and authentication paths are out of scope.

## Verification

- Baseline document with real production numbers before and after each migration.
- Vitest coverage for `newsletterMailboxKey` vs `normalizeEmailAddress`, identity link determinism (client+staff same profile → one person; applicant→staff continuity; two clients sharing an address not merged; `family@` vs `family+child@` not person-matched), registry sync, and the participation history filters.
- Transaction-safe SQL verification script for identity backfill, registry coverage, RLS presence on every new table, and cross-tenant read rejection.
- Applicant worker equivalence evidence: identical claim set and identical rendered content, no duplicate `crm_email_messages` rows.
- Typecheck and the full test suite.

## Out of scope for this increment

Trigger engine and cutovers, concurrency enforcement, client reply correlation, staff/donor campaign engines, BTY outreach state, newsletter model/worker/UI, and the unified Campaign Management UI. Legacy automatic enrollment stays exactly as it is today; nothing is flipped on. Shadow-mode cutover decisions later remain yours — I will report evidence and wait.
