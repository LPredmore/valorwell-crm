# Identity linking: migration dependency review and implementation checklist

Date: 2026-10-15. Repository: `LPredmore/valorwell-crm`. Database: Billing Hub `ahqauomkgflopxgnlndd`.

Status: APPROVED FOR IMPLEMENTATION by the user’s October 14 “Proceed” following presentation of this review. Implementation is proceeding on draft PR #154. No migration, backfill, source-record edit, automated check or runtime test was performed in this review. Tasks 11, 12 and 14 remain open. The October 8 proposal must not be deployed unchanged.

## Decision and intended behavior

Keep source records independent and use an explicitly reviewed reference overlay. A person can have several independently authorized domain roles. Do not activate or populate the empty `crm_people`, `crm_person_identities` or `crm_person_records` registries. Their current tenant-member SELECT contract is broader than the protected-source contract, and a globally unique email identity cannot safely represent shared addresses.

Use two new live tables: `crm_identity_reviews` and `crm_identity_review_events`. Validate prospects directly against `therapist_outreach_prospects.tenant_id`. Do not create or use a separate prospect-attribution table on the live project. No email-derived backfill, automatic link, merge, source-primary-key rewrite or clinical-data copy is part of this implementation.

A link is visible only while the signed-in user can view that domain and both its anchor and target satisfy the CURRENT source tenant/ownership contract. Check this on reads and writes. Source deletion or reassignment hides a stale reference while retaining its audit records. Identity linking must not block source lifecycle changes or activate any source triggers.

Conservative suggestions retain the existing email trim/lowercase and unambiguous US phone normalization. Do not collapse email dots/plus suffixes, infer international phone equivalence, or link from a name alone. Shared evidence remains a candidate requiring a human decision. The existing 100-row search cap is a discovery limit, not proof that no other candidate exists.

## Evidence and scope

CRM main was `b6986b71d46c2b3afff1351ddc43c02328d49060`; continuation branch was `d1f7781fc15fd75d79ab2cc2e8b1f008e3b84ce6` when inspected. Source, catalog and immutable repository snapshots were inspected read-only. No production PII was exported.

The old identity migration version `20261008161000` is absent from the live migration ledger; all three proposed tables and their trigger helpers are absent. The live prospect tenant-scoping migration `20261009231905` has already been applied. All 1,279 prospects have non-null tenant IDs; there is one distinct tenant in this source. Contact, opportunity, applicant and client IDs are also UUIDs with non-null UUID tenant IDs. Current aggregate counts: contacts 467; opportunities 242; applicants 35; prospects 1,279; clients 684. The three unused identity registries each contain zero rows.

Database discovery included columns/defaults/nullability, constraints, indexes, RLS policies, grants, triggers, relevant helper/RPC definitions, dependent views, scheduled jobs and migration history. All eight inspected source/registry tables have RLS enabled, without FORCE RLS, owned by postgres. No view, database function body or cron job was found consuming the proposed identity tables. No identity-specific deployed Edge Function was identified; CRM Edge Function source contains no consumer of these proposed objects.

Cross-application source discovery covered all available text/code/config/migration/docs blobs in 12 repository trees: 2,739 distinct blobs, 21,907,245 bytes, zero retrieval failures. Shared blobs were read once by content SHA. No proposed identity-table, identity-repository, identity-panel or attribution-method consumer was found outside CRM. The connector search index failed a known-positive CRM control, so this conclusion uses the full snapshot scan, not empty search results. Snapshot evidence does not establish the behavior of untracked deployments or inaccessible repositories.

| Repository | Immutable tree SHA |
| --- | --- |
| valorwell-billing-hub | `9d9819e0f378c1e263ab2736a1b3172df49431b7` |
| valorwell-ehr-shell | `7f0ff45df4b447b688f8d7cc601c12c36665a3fd` |
| valorwell-ehr-staff-profile | `6c036b4cef3f161fabf31ffd428f885883c94145` |
| auth.valorwell.org | `de988d2469d291c8446b70c032b40200c7dc3dfb` |
| valorwell-staff | `2386d0334b23c67febc038bdb8f4971d9b8d7bda` |
| valorwell-website | `784d2c73237c91cb8f5ee6d43ecdaafa22655e80` |
| valorwell-billing | `cc754f4051f53c2444460538f1c299b0cfb649b4` |
| valorwell-media | `b98d2f2a092e221daa3d3d6b580171649dc8cce6` |
| valorwell-credentialing | `909b2a9259922d297480c44df96236e1991fc1ca` |
| valorwell-clients | `f8ab4748049c1b155c58ccb4dc15577bd23fea0a` |
| flurra | `6a128a5267dc0dbec5749fd82311f5615600ce83` |
| flurra-final | `f1bf760385b3f36b9c6ea7e44824b0a597cd9ca9` |

All repository names above are under `LPredmore`. Tree SHAs are tree identifiers, not commit identifiers. Scan excluded binary assets, dependency/build/vendor directories and dependency lockfiles.

## Complete identified file inventory

Paths are relative to the CRM repository. Direct references were searched across `src`, `supabase`, `docs` and `.github`; adjacent contract and type consumers are included below.

| File | Current dependency/use | Required change and impact |
| --- | --- | --- |
| `supabase/migrations/20261008161000_crm_identity_review_links.sql` | Defines old tables, validation/audit triggers, grants and RLS; assumes separate prospect attribution. | Preserve historical file; supersede with a new forward migration. Never apply this file alone to live. Historical reset sequence is covered below. HIGH if used alone. |
| New versioned `supabase/migrations/*_crm_identity_review_links_current_tenants.sql` | No current implementation. | Self-contained creation of corrected two-table contract plus explicit known-legacy upgrade path; transaction and shape assertions. HIGH authorization surface. |
| `src/repositories/identity-reviews.ts` | Reads context/candidates/reviews, writes review upserts and attribution inserts; casts absent table types to `crm_people`. | Remove attribution API; use generated types and explicit selected-tenant arguments scoped by server permission; page reviews/events; retain source-read boundaries. MEDIUM. |
| `src/components/crm/identity/IdentityReviewPanel.tsx` | Queries suggestions/reviews, saves decisions, offers obsolete attribution form. | Remove attribution form/wording; enable decisions only after successful review load; scope query keys/drafts to tenant, user, role and contact; show loading/error and paged audit. MEDIUM. |
| `src/domain/identity/review.ts` | Normalizes evidence, classifies candidates, sorts symmetric contact pairs, maps authorized route forms. | Retain conservative rules and current route mapping; no invented applicant/prospect detail route. LOW. |
| `src/domain/identity/review.test.ts` | Tests matching, pair ordering and safe route mappings. | Preserve coverage, extend only for changed contracts; execution deferred. LOW. |
| `src/domain/identity/db-migration.test.ts` | Executes historical SQL in PGlite; prospect fixture lacks tenant ID and auth fixtures are synthetic. | Model current tenant columns/name-derived people; run new migration alone and historical-plus-forward sequence; cover RLS/current-source/audit cases below. HIGH test-contract relevance; not GoTrue proof. |
| `src/pages/crm/business-development/ContactDetailPage.tsx` | Mounts review panel in contact workspace. | Pass selected tenant/user context through established CRM auth surface; retain adjacent panels. LOW. |
| `src/test/contact-detail.test.tsx` | Mocks identity repository/panel in contact workspace tests. | Align mock signatures and missing-contract/loading behavior; execution deferred. LOW. |
| `src/integrations/supabase/types.ts` | Missing proposed table types; repository currently bypasses this. | Regenerate after the approved schema contract exists; review generated scope. MEDIUM. |
| `src/repositories/supabase/relationships.ts` | Maps source contact to person/role inbox and fetches tenant-filtered candidates. | Reuse unchanged. `kind` is derived from truthiness of preferred/first/last name; it is NOT a DB column. SQL person guards must reflect these fields. LOW. |
| `.github/workflows/crm-identity-verification.yml` | Path filters and existing identity lint/type/test/build commands. | Include new forward-migration path and relevant tests without running workflow now. LOW. |
| `docs/architecture/2026-10-08-tasks-11-14-identity-linking.md` | Historical ADR and obsolete rollout assumptions. | Add supersession notice/link and corrected rollout reference; preserve historical evidence. LOW. |
| `docs/architecture/2026-10-08-tasks-15-17-operations-implementation.md` | Notes absent identity migration as a dependency. | Point at current contract and release prerequisites. LOW. |
| `docs/crm-roadmap-continuation-2026-10-14.md` | Tracks identity blocker and deferred acceptance. | Record corrected review/implementation/deployment statuses separately. LOW. |
| `docs/architecture/2026-10-15-identity-linking-migration-review.md` | This review/checklist. | Record approval and final implementation evidence later. LOW. |

`OrganizationDetailPage.tsx` is in the identity workflow's lint/path list but contains no proposed identity-object consumer; no identity change is needed there. Existing contact/org affiliation and Primary-contact workflows remain source-owned.

## Database contract and object checklist

| Object/surface | Existing contract | Required action |
| --- | --- | --- |
| `relationship_contacts` | UUID PK, non-null tenant; existing unique `(tenant_id,id)`; CRM capability and legacy clinical/website policies; browser CRUD. | Read anchor/target ID, tenant and name fields inside guard only. No source DDL, grant or trigger change. Require named people for contact-pair identity. |
| `relationship_opportunities` | UUID/tenant; composite primary-contact FK; campaign/status/audit triggers; browser SELECT/INSERT grants. | Require matching tenant and `primary_contact_id = contact_id` on reads and writes. Do not change opportunity status, primary contact or grants. |
| `provider_applicants` | UUID/tenant; tenant restriction, workflow/initial-contact triggers; service-role access, no browser grants/policies. | Validate existence/tenant behind private boolean guard for CRM admin only. Do not grant browser access or enqueue applicant actions. |
| `therapist_outreach_prospects` | UUID/tenant; unique tenant/ID; email/state/dedup/held-work triggers; no browser grants/policies. | Validate actual current tenant, admin only. No attribution, outreach status edits or browser source grants. |
| `clients` | UUID/tenant; authenticated SELECT under own-profile, clinical staff/admin policies; clinical lifecycle triggers. | Require CRM admin AND existing same-tenant clinical admin helper. No clinical data in overlay or broader client access. |
| `crm_people`, `crm_person_identities`, `crm_person_records` | Empty; tenant-member SELECT; identity-value uniqueness. | Leave unused and unchanged. No backfill. |
| `crm_identity_reviews` | Absent live; old migration proposes single-source contact FK and tenant FK. | Create UUID PK, tenant/contact/domain/target, decision/basis/note/reviewer/timestamps; domain/decision/basis/length checks; unique business pair and `(tenant_id,id)`; tenant/contact and tenant/domain/target indexes. Do not FK source IDs: the new overlay must not block source deletes/moves. Validate them through guards and hide stale links. Retain tenant FK RESTRICT. |
| `crm_identity_review_events` | Absent live. | Create append-only server ledger with actor/time, old/new decisions and review evidence snapshots. Composite `(tenant_id,review_id)` FK to reviews prevents mismatched event tenant; RESTRICT deletion. Browser SELECT only through visible parent. No browser insert/update/delete. |
| `crm_therapist_prospect_attributions` | Absent live; old proposal makes it authoritative. | Do not create live. If historical reset/another environment created it, revoke API grants/policies and leave inert; do not delete data. If it contains rows, stop for explicit data-reconciliation review. |
| New `private.crm_identity_source_access` helper | Absent. | STABLE SECURITY DEFINER, empty search_path, fully qualified objects, session `auth.uid()`, validated domain/mode, permission and current source checks. Boolean only; no source payload/dynamic SQL/public RPC. Revoke PUBLIC/anon; authenticated EXECUTE solely for RLS use in private schema. |
| `private.crm_identity_review_validate` | Absent live; old source validates attribution and actor. | Validate authenticated actor, immutable tenant/anchor/domain/target, canonical contact order, conservative person/source guards and all write authorization. Timestamps server-owned. Revoke direct helper execution. |
| `private.crm_identity_review_audit` | Absent live. | SECURITY DEFINER insert into events with qualified fields and evidence snapshot; record changed reviewer/basis/note/decision, suppress exact retry/no-op events. Revoke direct execution. |
| Review RLS and grants | Proposed only; old event parent policy has ambiguous unqualified tenant reference. | SELECT calls current-source read guard; INSERT/UPDATE both enforce write guard. Authenticated review SELECT/INSERT/UPDATE, event SELECT only; no DELETE, no anon, no new service-role writer grant. Explicit qualified parent policy columns. Trigger-owned event writes. |
| Existing permission helpers | `private.crm_has_relationship_permission` checks session uid/capability; `public.crm_has_role(uuid,text[],uuid)` joins same-tenant membership with clinical roles. | Reuse unchanged: business read admin/operator/readonly, write admin/operator; sensitive evidence admin; clients additionally clinical admin. No source policy relaxation. |
| `get_crm_operating_context` | Chooses current tenant only when capability set has exactly one; multi-tenant result has null current tenant. | Do not change shared RPC. Identity repository accepts selected tenant from CRM auth and validates it against available tenants; DB guards authorize every request. UI-supplied tenant never grants permission. |
| Views, cron, Edge Functions, webhooks/workers | No identified proposed-object consumer. Existing source triggers can cause workflows if source rows are written. | No changes, activation or source writes. This overlay must not send communications or create clinical/applicant workflow activity. |

Read permission matrix: relationship-contact and BTY links use existing `view_relationships`; provider-applicant/prospect links additionally require `view_sensitive_evidence`; client links additionally require same-tenant clinical admin. Write matrix adds `edit_relationships` to the same domain restrictions. Anonymous, missing capability, wrong tenant and unknown domain/mode deny. Sensitive UUIDs and notes receive the same restrictions as their parent review.

## Exact migration and deployment strategy

1. Approve this dependency checklist and strategy before SQL or related application implementation. Approval is for the defined overlay, no backfill or external actions.
2. Add a NEW forward migration with a current timestamp. Preserve `20261008161000` as history, mark it superseded in the runbook, and never deploy it alone. The forward migration creates the corrected tables when absent. For a known historical installation, it asserts expected shape, rejects populated legacy attribution/unrecognized schema, replaces old policies/helpers, removes the old source-contact FK, and adds the audited current constraints. It must not silently accept unknown schema with `IF NOT EXISTS`.
3. Support both explicit fixture sequences: current source schema + forward migration; and historical identity migration + forward migration. In the latter only, the obsolete attribution table can remain inert with API access revoked. This extra unused historical artifact is intentional; live will have only the two new identity tables. No source row transformation or copy is needed.
4. Publish migration source and application changes through GitHub. Application changes remove attribution APIs/UI, use explicit selected-tenant scoping, typed review/event access and successful-load gating. Review/event paging prevents silent truncation. No new service or dependency is needed.
5. Execute only the approved forward migration via Supabase as one transaction. Record its actual ledger version. Do not run a blind `db push`/reset or apply every outstanding historical migration: this live project already contains later independently applied versions. Refresh catalog preconditions immediately before applying; stop if inspected state changed materially.
6. Regenerate database types from the resulting schema, commit those through GitHub, and remove the current table-name type casts. Keep the old frontend attribution form unavailable while contract deployment occurs; its removed table fails closed. No production identity writes until the combined release acceptance pass.
7. Per the user's instruction, defer test/lint/type/build/CI/browser/RLS behavioral execution to Task 42. Preparing meaningful updated test source is implementation work; passing those checks remains a release gate. Read-only schema evidence is not a substitute for those tests.
8. During the combined acceptance pass, run the checklist below, reconcile source counts against a fresh baseline allowing unrelated concurrent changes, review migration ledger/grants/advisors, and then release the intended application commit. Verify signed-in behavior and source preservation before marking roadmap tasks complete. Do not create paid branches or production test tenants without separate authorization.

Compatibility: existing domain IDs, routes, lifecycle functions, grants, RLS and integrations remain authoritative. Corrected review row columns retain the prior frontend read/write form where safe; the unsupported attribution action is removed. Multi-tenant users use the selected tenant rather than relying on a server auto-selection that can return null.

Rollback: revert the frontend feature through GitHub first to stop UI writes. Before any link use, the new empty objects can be removed in reverse dependency order through an approved rollback. After any review/audit data exists, retain it and disable writes; use a forward repair rather than dropping audit evidence. Do not restore the stale attribution contract. Source records require no rollback because they are never written.

## Foreseeable side effects and acceptance evidence

| Surface | Severity | Risk and mitigation | Deferred verification |
| --- | --- | --- | --- |
| Protected source privacy | CRITICAL | A definer helper or permissive policy could reveal domain membership/UUIDs. Session-bound permissions, private boolean-only helper, qualified objects, no source grants. | Two-tenant signed-JWT/HTTP matrix for each domain and role; direct-source access remains unchanged. |
| Source lifecycle | HIGH | A source FK could block deletes/reassignment; stale links could outlive access. Use no source FK, immutable soft references and read-time guards. | Delete/reassign synthetic sources, change BTY primary, revoke role; links/events hide and source operations still succeed. |
| Migration compatibility | HIGH | Historical/reset and already-later live ledgers differ. New standalone forward migration, explicit legacy assertions, transaction, no blind push. | Run both schema sequences and interrupted/failed transaction recovery; inspect ledger/schema. |
| Shared backend workflows | HIGH | Accidental source writes could enqueue outreach/clinical work. Only new overlay tables are written. | Reconcile source rows and verify no new source workflow/outbox/event artifacts attributable to link decisions. |
| Tenant/user cache | HIGH | Cached protected link data could remain after switch. Tenant/user/role/contact keys, draft reset, server checks. | Switch tenant, user and role during loading/save; no stale content or cross-tenant submission. |
| Review integrity | MEDIUM | Duplicate pairs, forged actor, evidence edits, retry noise or cross-tenant events. Canonical pair, unique key, immutable identifiers, actor trigger, composite event FK, evidence ledger. | Reverse pair/upsert/reversal/concurrent saves; actor forgery and direct event CRUD denied; exact retries stable. |
| Contact workspace availability | MEDIUM | Missing table, denied reads or loading could expose unusable buttons. Require successful contract load; show explicit unavailable/error state. | Missing schema, denied permission, slow/error queries, contact navigation and adjacent panels. |
| Deletion/retention | MEDIUM | Inaccessible stale references retain UUID/evidence history; tenant deletion is restricted by overlay FK. No source deletion block; retain audit by design. | Document authorized retention/tenant deletion procedure before any destructive tenant cleanup. |
| Performance | MEDIUM | Per-row source authorization and history growth add read cost. Indexed source PKs/new review keys, bounded paging, no global candidate scans. | Inspect realistic query plans/latency and complete pagination under the combined pass. |
| Evidence content | MEDIUM | Users could type PHI into notes. Domain-restricted evidence; UI instruction to use identity evidence only; length limits; no clinical payload copy. | Confirm protected notes/events aren't exposed to business-only roles or shared timelines. |
| Adjacent CRM/Social Media | LOW | Shared page integration or deployment may regress existing actions. Keep changes scoped; source publishers/workers untouched. | Contact/org/task/Primary/bookmark regression and Social Media navigation smoke checks already in Task 42. |

## Deferred combined acceptance checklist (Task 42)

- Existing identity unit suite, updated PGlite fixtures, application typecheck, focused lint and build; inspect CI at release time. Do not reuse October 8 results as evidence for revised code.
- Current-schema standalone forward migration and historical-plus-forward migration; explicit rejection of unknown schema/populated legacy attribution; transactional failure recovery.
- Real signed-JWT/HTTP anon/outsider/admin/operator/readonly and clinical-admin combinations across two authorized tenants for all five domains; no paid branch or production test-tenant creation implied.
- Protected source tables retain current grants/policies; no applicant/prospect browser SELECT; private helper not exposed as public RPC; no service writer bypass.
- Current source tenancy and contact/BTY ownership checked on insert, update and SELECT; deleted/reassigned source, changed primary contact and revoked permission immediately hide reviews and their events.
- Canonical reverse pairs, idempotent retries, concurrency, forged reviewer, immutable IDs, invalid domain/basis, note limits, append-only event history and cross-tenant event denial.
- Multi-tenant selected context, user/role switching, draft reset, missing migration, failed/slow query, review/event pagination and existing source deep links.
- Source-count reconciliation and source/outbox/trigger side effects; no source merge, clinical-data copy, identity-registry population, unsolicited communications or worker activation.
- Record deployed commit, migration version, runtime evidence and remaining uncertainty; close Tasks 11/12/14 only after their original acceptance is satisfied.
