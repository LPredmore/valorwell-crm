# ValorWell AI Operations Platform

An additive, read-only observation layer inside the CRM: deterministic collectors establish what actually happened, a single queued Gemini 2.5 Pro worker adds higher-order reasoning, and findings/briefs surface to admins. No production system is modified or remediated.

## Verified current state (Billing Hub `ahqauomkgflopxgnlndd`)

- 28 active `cron.job` entries across appointments, billing finalization, claims/ERA, payroll, payments, journey exceptions, provider demand, therapist matching, campaigns, newsletters, relationship Google sync, BTY dispatcher. This is the seed set for operation monitoring, discovered dynamically (not hardcoded).
- `private` schema already exists and already holds server-only config (`private.crm_control_plane_flags`, `private.relationship_feature_flags`) read through the `crm_control_plane_flag` function — AI Operations flags will follow this exact pattern.
- Authorization primitives already exist and will be reused, not reinvented: `private.valorwell_is_admin`, `private.valorwell_has_tenant_access`, `private.valorwell_is_service_role`, `public.is_tenant_admin`, `public.crm_has_role`.
- No `ai_operations_*`, YouTube, or business-calendar/holiday tables exist yet.
- 19 Edge Functions exist; none call Vertex. BTY dispatcher (`centralBusinessDate`/`centralLocalTime` in `_shared/bty.ts`) is the DST-aware pattern to imitate — copied conceptually into a new shared module, with no coupling to BTY code.
- No Vertex service-account secret is configured yet.

## Delivery sequence

This directive is too large for one change set. It ships in the order the directive specifies, each stage independently verifiable. AI stays disabled until Stage 2 passes.

### Stage 1 — Foundation (this change set)
Additive migration only, all flags off:
- `public.ai_operations_runs`, `ai_operations_module_runs`, `ai_operations_findings`, `ai_operations_finding_events`, `ai_operations_briefs`, `ai_operations_youtube_comments`, `ai_operations_settings` — RLS enabled, `GRANT SELECT` to `authenticated` behind admin+tenant policies, `GRANT ALL` to `service_role`, `anon` revoked.
- `private.ai_ops_snapshots`, `ai_ops_work_items`, `ai_ops_source_cursors`, `ai_ops_finding_evidence`, `ai_ops_operation_registry` — no `authenticated` grants at all, so the browser cannot reach them.
- Unique business-date/tenant constraint on runs; unique `work_key`; unique `fingerprint` per tenant/module for finding dedup.
- Indexes on tenant_id, business_date, module, status, severity, last_seen_at, entity_type/entity_id, fingerprint. No indexes added to existing production tables.
- Feature flags (`ai_operations_enabled`, per-module flags, `executive_brief_email_enabled`, `shadow_mode`) added into the existing control-plane flag table + admin toggle RPC.
- Business-calendar table (closures/holidays, data-driven) plus America/Chicago business-date and business-day-offset SQL helpers.
- Admin read-model RPCs for the dashboard (paginated findings, run/coverage summary, brief fetch) and finding lifecycle RPCs (resolve/dismiss/snooze) writing immutable events.
- Regenerated DB types, tests, typecheck, build.

### Stage 2 — Model infrastructure
`ai-operations-model-worker` Edge Function: Vertex service-account JWT auth, single Gemini 2.5 Pro adapter, atomic queue claim, bounded concurrency, strict JSON-schema validation, one schema-repair retry then fail (never Flash, never a preview model), exponential backoff on 429/5xx/timeout, prompt/schema versioning, and logging that records ids/durations/tokens/status only.

### Stage 3 — System Integrity (shadow)
Registry-driven monitoring reconciled against live `cron.job`; three evidence levels (scheduled, executed, downstream invariant); unmonitored-cron findings; `UNKNOWN` when evidence is missing; Gemini used only to cluster and prioritize deterministic findings.

### Stage 4 — Client Journey
Structured-only snapshots (no note narrative), evaluation hashes with reuse, daily accounting of all non-closed clients plus prior-24h closures, 5–8-client micro-batches with opaque entity keys and strict one-result-per-entity validation, linkage to existing `client_journey_exceptions` without modifying them.

### Stage 5 — Communications QA
Authoritative-identifier linkage only, thread assembly with quote normalization, durable source cursors with overlap windows, Gemini decides "response required", deterministic calendar logic decides SLA breach.

### Stage 6 — YouTube operations
Official API ingestion by immutable comment ID, bounded backfill then hourly incremental sync, reanalysis only on new/changed content, classification + suggested reply. No posting endpoint exists.

### Stage 7–8 — Executive Brief + email
Brief synthesized from module state only, partial brief when modules fail, explicit coverage manifest; `ai-operations-send-brief` anonymized, exactly-once per business date + recipient, over existing Resend config, disabled by default.

### Stage 9 — UI
New `/crm/ai-operations` (Today's Brief, Open Findings, per-module tabs, Run History/Coverage; severity/module/status/date filters; resolve/dismiss/snooze; deep links to clients and existing exceptions) and a compact, failure-tolerant summary widget on `/crm/canonical`. `/crm` routing unchanged.

### Stage 10 — Scheduling + shadow validation
One `ai-operations-dispatcher` (weekday, DST-aware, business-date idempotent) running the 03:15 → 05:00 Central sequence, plus a model-worker throughput schedule. Five consecutive business days in shadow mode before email activation.

## Technical notes

- AI Operations only ever reads production tables; every write targets `ai_operations_*` / `ai_ops_*`. No trigger, policy, or column on existing production tables is altered.
- Retries apply to AI Operations' own work only; production remediation is always a recommendation.
- Rollback is `ai_operations_enabled = false` plus unscheduling the two cron entries; tables are retained.

## Blocker to confirm before Stage 2

Vertex requires a Google service-account key stored as a Supabase server secret (`VERTEX_SERVICE_ACCOUNT_JSON`, project id, region). Stages 1 and 3's deterministic detection can land without it; PHI-bearing Stages 4–5 stay disabled until the Google Cloud environment meets ValorWell's compliance requirements.
