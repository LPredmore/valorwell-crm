# CRM Modernization — Task 02: Billing Hub schema, data and dependency inventory

**Audit date:** 2026-10-08. **Production project:** Billing Hub, Supabase `ahqauomkgflopxgnlndd`. Read-only inspection using `list_tables`, `information_schema.columns`, `pg_constraint`, `pg_policies`, and aggregate SELECT queries; no customer/clinical record values exported, no SQL writes executed.

## Scope and live snapshot
- 320 public tables were returned by the current table listing (not all are CRM-owned). The CRM GitHub repo has 250 tracked migration files; these are **repository file counts**, not proof that every migration is applied on the live database.
- Relationships: `relationship_contacts` 442; `relationship_organizations` 358; `relationship_contact_organizations` 354; `relationship_opportunities` 188; `relationship_opportunity_status_history` 188; `relationship_interactions` 1,053; `relationship_communications` 595; `relationship_replies` 34; `relationship_suppressions` 13; `relationship_campaigns` 3; `relationship_campaign_enrollments` 290; `relationship_enrollment_events` 4,560.
- Related: `relationship_import_rows` 871; `relationship_message_observations` 386; `relationship_reconciliation_issues` 51; `crm_tasks` ~89; `crm_campaigns` 9; `crm_campaign_registry` 12; `crm_newsletters` 4.
- Therapist: `therapist_outreach_prospects` 1,279; `provider_applicants` 35. These are different populations and are **not automatically deduplicated**.
- Identity registry is pre-created but empty: `crm_people` 0; `crm_person_identities` 0; `crm_person_records` 0. **Do not create a second identity registry before examining existing identity RPCs and source maps**.
- Social publishing: `ai_operations_social_publications` 79; `ai_operations_social_publication_events` 691; social accounts 1, playlists 3 and playlist-publication links 79. **These are to be preserved** until separate Flurra parity/cutover.

Counts above are database measurements during the audit and may subsequently change.

## Record and key relations verified
| Owner | Foreign keys / domain associations | Constraint |
|---|---|---|
| `relationship_contact_organizations` | contact → `relationship_contacts`; organization → `relationship_organizations`; tenant | Association key is composite `(tenant_id, contact_id, organization_id)`; no synthetic ID |
| `relationship_opportunities` | organization, primary contact, tenant, assigned profile | BTY-specific lifecycle; do not repurpose status values across all pipelines |
| `relationship_communications` | campaign, enrollment, step, contact, organization, opportunity, tenant, profile, private work item | Communication belongs to relationship domain; preserve message identifiers and link chain |
| `relationship_campaign_enrollments` | campaign/contact/organization/opportunity/tenant; donor/profile refs | Has safety status, next send and reply state; not the same engine as client campaigns |
| `crm_person_identities` / `crm_person_records` | `crm_people` | Registry exists but has no linked people yet |
| `provider_applicants` | tenant, profile, converted staff | Application and onboarding data must remain authoritative |
| `ai_operations_social_publications` | social account, video project, optional clip and tenant | Publishing job/media source dependencies block deletion and premature migration |

## Non-destructive data-quality results
- Relationship contacts missing email: **36 / 442**. Normalized nonblank email duplicates within `relationship_contacts`: **0 duplicate email-key groups** in this snapshot. Some contacts may be non-email/role inboxes; missing email alone is not a defect.
- Therapist prospects missing email: **1,039 / 1,279**. Email present: **240**; email present and `outreach_contactable=true`: **239**. Contactable but missing email: **1,038**. Treat `outreach_contactable` as a flag, **not** proof the email channel exists or is approved for sending. Two duplicate nonblank normalized email-key groups appear in the prospect staging list.
- Prospect email overlap with `relationship_contacts`: **0** records; applicant email overlap with `relationship_contacts`: **34 of 35**; prospect overlap with `provider_applicants`: **0**. This shows recruitment prospect records must be reconciled before any shared-contact import, not assumed already included.
- Broken link checks returned **0** for contact↔organization joins with missing endpoints, opportunities missing organizations, and opportunities with an invalid non-null primary contact. The checks validate these sampled link classes, not every relation.
- Existing `relationship_reconciliation_issues` contains 51 entries: inspect severity, owners and resolution history before deciding whether any block migration. No content sampled.
- `therapist_outreach_prospects` has **no tenant_id column**, while `provider_applicants`, `relationship_contacts`, and `crm_people` do. Treat staging as privileged ingestion data until origin/tenant mappings are verified.

## Persistence/source-of-truth decisions for design
1. Use `relationship_contacts`, `relationship_organizations`, `relationship_contact_organizations`, their roles/interaction/communication tables as **current non-clinical relationship sources**. Do not assume generic CRM person record is already populated.
2. Evaluate using existing `crm_people` as link registry, recording `source_domain + source_record_id` and reviewed identity confidence; never replace clinical/auth, therapist/applicant or BTY source PKs.
3. Keep `relationship_opportunities` as authoritative BTY opportunity record; new configurable pipeline layer should reference it with an adapter rather than rewriting BTY lifecycle in-place.
4. Keep clinician recruitment staging and `provider_applicants` distinct until migration mapping is tested, with exclusion/suppression checks and no direct browser access to staging.
5. Keep operational client records and PHI exclusively behind existing EHR/client APIs; generic CRM may reference a permitted intake status with access control.
6. Keep all `ai_operations_social_*` and video/publish data untouched during CRM redesign and navigation separation.

## Dependency and migration risk register
| Priority | Risk | Required resolution |
|---|---|---|
| P0 | 1,039 therapist prospect rows lack email; staging is not tenant-keyed | Task 25: source/tenant eligibility reconciliation and safe prospect import; use at most verified 239 contactable-with-email as *candidate* pool subject to suppression, duplicate checks and permission |
| P0 | Multiple communications/campaign engines | Task 04/33: registry and controls map before rewiring sends |
| P0 | Flurra migration could interrupt 7 scheduled and other existing publications | Task 05/08/37: preserve live worker/queue/storage; cutover is independent |
| P1 | Existing person registry has zero rows | Task 11/12: approved identity design and staged, reversible linking |
| P1 | `relationship_opportunities` has a BTY-specific status machine | Task 18/20: pipeline adapter, no universal in-place status rewrite |
| P1 | RLS and privileged functions require explicit review | Task 03: live policies/function grants and negative-test gate |
| P2 | Relationship data may need indexes for saved/filtered pipeline views | Task 18/19/23: EXPLAIN representative queries before applying indexes |

## Schema/source inventory (no reliance on old documents alone)
- `docs/architecture/relationship-schema-alignment.md` is from July 2026; its unconditional RLS assessment is **historical** and contradicted by newer capability-constrained policies verified on Oct 8.
- `src/repositories/supabase/relationships.ts` handles contact and organization repository calls with explicit tenant filtering.
- `src/repositories/supabase/relationships-opportunities.ts` handles BTY opportunities.
- `src/repositories/supabase/relationships-campaigns.ts` handles relationship campaigns.
- `src/repositories/supabase/index.ts` wires CRM client, task, campaign, communications, staff, report and relationships data sources.
- Further per-column schema available through `information_schema.columns` and generated `src/integrations/supabase/types.ts`; always regenerate types after approved migrations.

## Acceptance and validation
- **PASS:** enumerated live table counts, key/source relationships, staging email gaps, duplicate key groups, sampled orphan counts and migration risks using read-only queries.
- **PASS:** canonical source decisions distinguish live relationship, clinical, therapist, newsletter and social tables.
- **NOT YET TESTED:** every downstream Edge Function consumer, every table FK orphan, live impersonation/RLS negative tests, migration dry-run, full database snapshots. Those become tasks 03, 06, 11–12, 19 and 35, not assertions that they already pass.
- No database mutations performed for Task 02.
