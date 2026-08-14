# Automated Beyond The Yellow Prospect Discovery + Contact Enrichment

## What exists today (verified against the live database)

- `relationship_organizations` (187 rows) is the canonical organization table. It has `name`, `website`, `organization_kind`, `veteran_affiliated`, `relationship_stage`, `outreach_status`, `source`, `metadata`, but **no** `headquarters_state` column. 20 rows carry `metadata.target_city`.
- `relationship_organization_roles` (organization_id + role_code + source + metadata) already exists, and `relationship_role_catalog` already has `bty_nominee` (lane `bty_participation`) and `funder`/`sponsor` (lane `partnership_support`). There is **no** `donor_potential` role yet.
- `relationship_social_profiles` already has `organization_id`, `platform_name`, `handle`, `profile_url`, `follower_count`, `source`, `metadata` — no schema change needed for YouTube.
- `relationship_contact_organizations` already supports `role_title`, `is_primary`, `metadata`.
- pg_cron is in use with a mix of `private.*` worker functions and `net.http_post` calls to edge functions; existing Central-time handling is done crudely (duplicate CST/CDT payroll jobs). No BTY discovery job exists.
- Email infrastructure: Resend edge functions (`crm-resend-email`, worker + webhook) already deployed; `_shared/suppression.ts` exists.
- Business Development UI lives in `src/pages/crm/business-development/*` (organization directory/detail, orchestration console, reconciliation page).
- No Gemini secret or Gemini call path exists anywhere in the repo yet.

## Prerequisite

A `GEMINI_API_KEY` secret must be added (I will request it during implementation). The spec pins model `gemini-3.1-pro-preview`; I will store the model name in config so it can be corrected without a code change if the API rejects that identifier, and the run ledger records the exact model used.

## Database work (additive migrations)

1. `relationship_organizations.headquarters_state` (text, 2-letter, validated by trigger against the 49-state rotation set) + partial index. Backfill only where existing metadata unambiguously establishes headquarters state; no invention.
2. Role catalog: insert `donor_potential` (label "Donor potential", `applies_to = 'organization'`, lane `partnership_support`, active). `funder` untouched.
3. Normalization helpers (immutable SQL): `relationship_normalize_domain(text)`, `relationship_normalize_youtube_url(text)`, `relationship_normalize_org_name(text)`; expression indexes on organizations for domain/name lookups and on social profiles for normalized YouTube URL.
4. Private automation tables (in `private` schema, not exposed via Data API):
   - `bty_discovery_state` — tenant_id (PK), current_state, last_successful_state, next_state, last_successful_business_date, updated_at; seeded `AL`.
   - `bty_discovery_runs` — unique `(tenant_id, business_date)`, target_state, model, status, current_attempt, timings, organizations_created_count, organization_ids[], subscriber_range_tier_used, error summary jsonb, notification_sent_at, metadata.
   - `bty_discovery_candidates` — per-run accepted/rejected candidates with reason (drives the exclusion set across passes).
   - `bty_contact_enrichment_runs` — unique `(discovery_run_id, organization_id)`, status, contact_id, model, confidence, error, timestamps.
5. RPCs (SECURITY DEFINER, authorization-checked, `search_path` pinned):
   - `private.bty_claim_discovery_run(tenant, business_date, attempt)` — idempotent claim; returns existing successful run instead of re-running.
   - `private.bty_commit_discovery_batch(run_id, jsonb candidates)` — single transaction: insert exactly five organizations, attach `bty_nominee` role, upsert YouTube social profiles, write provenance, set run success + organization_ids, advance state controller (skipping Alaska, wrapping WY → AL). Raises if count <> 5 so nothing partially persists.
   - `private.bty_mark_run_failed(run_id, error jsonb)` — state controller untouched; sets failure and reserves the single notification slot.
   - `private.bty_record_contact_enrichment(...)`.
   - `public.bty_next_rotation_state(text)` — pure rotation function, used by tests.
   - `public.bty_automation_overview()` — read-only, admin/staff-gated projection of state + recent runs + enrichment status for the UI.
   - Duplicate screen: `public.bty_screen_organization_candidates(jsonb)` returning per-candidate match verdicts (domain / YouTube / exact name / name+state), used by the edge function before persistence.
6. One-time duplicate reconciliation, deterministic only:
   - `public.bty_preview_organization_duplicates()` — report of deterministic groups (same normalized domain, same normalized YouTube URL, or exact normalized name + same headquarters state) plus an "ambiguous, review only" list that is never auto-merged.
   - `public.bty_merge_organization_duplicates(survivor_id, duplicate_ids, reason)` — repoints every FK referencing the duplicates (roles, contacts affiliations, social profiles, campaigns/enrollments, communications, interactions, opportunities, referrals, stage history, activity events, import rows, notes), consolidates roles/metadata/provenance, then deletes the duplicate only after all references move. Enumerated from `information_schema` FKs at implementation time so nothing is missed; writes an audit event.

## Edge Functions

- `bty-discovery` — resolves Central business date, claims/resumes the run, builds the state exclusion list plus the global "already in CRM" dataset, calls Gemini (`gemini-3.1-pro-preview`, Google Search grounding, strict JSON schema, 10–15 ranked candidates per pass), validates every candidate (11 checks from the spec), re-queries with rejected names and the next subscriber tier (500–5k → 250–10k → 100–25k → any verified) until five valid remain, then commits atomically. Handles timeout, rate limit, malformed JSON, grounding failure, exhausted candidates.
- `bty-contact-enrichment` — only for today's successful run's exact five organization ids; per-organization Gemini contact research, contact dedupe by normalized email / LinkedIn / name+organization, reuse or create contact, create `relationship_contact_organizations` affiliation with `is_primary = true` and `organization_contact` role, record enrichment run. Never touches a backlog.
- `bty-automation-dispatcher` — invoked every 5 minutes by cron; evaluates `America/Chicago` local time and fires 06:00 / 06:10 / 06:15 discovery attempts and 06:30 enrichment. DST-safe (no fixed UTC offset). Skips discovery attempts when today's run is already successful; skips enrichment when there is no successful run.
- Failure notification: after a failed attempt 3 only, one email to `info@valorwell.org` through the existing Resend path, guarded by `notification_sent_at`.
- Shared module `supabase/functions/_shared/bty-discovery.ts` for Gemini client, schemas, normalization, validation and tier logic so it is unit-testable.

## Scheduling

Single cron job `bty-automation-dispatcher` at `*/5 * * * *` calling the dispatcher function with a service-scoped internal token; all downstream work is idempotent per run/attempt.

## UI

- Organization detail + directory: role chips rendered from `relationship_organization_roles` (BTY Nominee, Donor Potential, others) and a headquarters-state field on the organization form.
- BTY and Donor lists become role-filtered views over canonical organizations (`bty_nominee` / `donor_potential`) — same `organization_id` in both.
- New `BtyAutomationPage` under Business Development: current/next state, last successful run, today's run status and attempt, the five discovered organizations with subscriber tier, enrichment status per organization, recent failures. Read-only.
- Duplicate reconciliation preview/merge surface added to the existing reconciliation page.

## Tests

Vitest coverage for: rotation (starts AL, skips AK, AL→AZ, WY→AL, no advance on failure), tier expansion order and closest-to-target ranking, candidate validation and rejection rules, duplicate rejection by domain / YouTube / exact name, retry gating (06:00 success blocks 06:10/06:15; failures cascade; attempt 3 marks failed; single email), enrichment gating and contact reuse/creation/affiliation, and role coexistence. Plus SQL verification script `supabase/verification/bty_discovery_automation_test.sql` (transaction-safe) exercising the commit RPC, idempotency constraints, failure path and merge RPC.

## Verification I will actually run

Typecheck, full vitest suite, SQL verification script, a controlled Alabama live discovery run against the real Gemini API with results inspected, and a forced-failure rehearsal (attempts 1–3 failing) confirming state stays AL, one email, no enrichment, no partial batch — with test artifacts removed afterwards. The final report will state plainly anything that could not be verified.

## Out of scope

No changes to clinical, EHR, billing, staff, therapist or unrelated systems. No new organization tables, no parallel BTY/donor models.
