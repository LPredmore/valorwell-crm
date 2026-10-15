# CRM roadmap continuation — October 14, 2026

Implementation prepared against main b6986b7 (PR #153). Branch: codex/crm-roadmap-continuation. Draft PR: https://github.com/LPredmore/valorwell-crm/pull/154.
No tests, lint, typecheck, build, browser checks, migrations, deployment, or live workflow executions were performed. Acceptance remains open. This is a continuation of Todoist master task 6hhmHVFjqc5rmjCq; verification belongs under its final checklist 6hm9jrrxrXXxpPwq.

Latest October 15 status supersedes the earlier migration blocker: the user applied the identity migration manually; this continuation repaired only its tracking row and generated live types. See the final continuation entry below. Earlier observations remain chronological evidence.

## Changes

### Phases 07, 08, 10: compact navigation

Keep additional tools visible as labeled icon links when the sidebar is collapsed. Existing capability filtering and route destinations remain in place.

### Phases 13, 17: directory workflow

- Validate UUID, stage, outreach status, veteran affiliation, sort, contact-history and page URL parameters before constructing typed directory queries.
- Preserve directory filters and page in contact/org detail links, return links, organization edit and new-organization save flows. Return destinations remain fixed internal paths; only query strings are retained.
- Hide obsolete search results during the debounce interval and hide cached success results on query error.
- Disable pagination while a query is fetching.

### Phase 15: activity timeline

- Replace repeated retrieval of all earlier pages with independent incremental interaction/email queries.
- Scope caches and reset channel/display state by tenant, operator, CRM role and subject.
- Add stable ID ordering for equal-time email/interaction pagination.
- Add retry and pressed-state semantics to channel controls.

### Phase 16: follow-up tasks

- Paginate the same canonical task table in 50-row pages, with open/overdue filtering applied before pagination. No second task store.
- Reset task drafts when subject, tenant, operator or CRM role changes.
- Scope task caches by those identities and view; use named owner controls and labels.
- Correct relationship task writes to invalidate crm-tasks rather than the unrelated tasks key. Canonical task mutations also invalidate relationship-task queries.
- Preserve server permission checks, existing status/priority contracts and local-time date input behavior.

## Impact and remaining review

Changes affect navigation rendering, directory URL interpretation, source-history requests, task list queries and query-cache refreshes. No database contract or outbound communication worker changed. Invalid URL enum/UUID values now fall back/are ignored instead of reaching the database. Saved bookmarks with invalid values may show a broader default view; RLS remains authoritative. Incremental offset pagination can still shift under concurrent inserts/deletes; source IDs deduplicate displayed tasks. Timeline sources retain their existing deduplication semantics; full provider/reply reconciliation remains a separate roadmap requirement.

The task list is loaded incrementally, so its displayed loaded count is not a tenant-wide total. The timeline likewise labels loaded events and older-source availability. Full lifecycle, identity linking, donor synchronization, research identity decisions, security acceptance and deployment are not completed by these changes.

## Deferred checks

- Run existing lint, app/tooling typechecks, Vitest, production build, boundary/provenance checks and CI in the combined test pass.
- Timeline with >200 records per source: load successive pages without refetching earlier pages on each click; equal timestamps; source failures/retry; channel/display reset on record/operator/role/tenant changes.
- Directory URL validation with malformed/duplicate IDs, enum/sort values and invalid/large pages; valid multi-value bookmarks; rapid typing, back/forward and delayed/error responses.
- Contact/org detail round trips and organization create/edit/save preserve directory filters and page, including new-tab navigation; hostile return query strings cannot change the fixed route.
- Tasks >100, including overdue records beyond the first page: open/all/overdue filters, completion/reassignment, names, unknown/historical owners, task draft reset and failed-page retry.
- Record panel writes refresh My Tasks and canonical task writes refresh record panels. Confirm no duplicate creation and correct local-time due dates across DST.
- Compact/expanded/mobile navigation: every permitted additional tool remains reachable, all icon links have names, prohibited tools stay hidden.
- Signed-in two-tenant/role regression, normal release review and production deployment after acceptance. Rollback by reverting the batch commit; no database rollback.

## Publication blocker

Automatic approval review rejected the attempted GitHub push because it required explicit authorization to upload repository contents and create the remote branch. No alternate upload route was attempted. User explicitly authorized publication. GitHub publication then succeeded through the connected GitHub app (terminal credentials were unavailable). PR #154 remains a draft; no deployment or verified acceptance is claimed.


## Continuation after publication authorization

Additional implementation for Phases 13, 15, 16, 17, 23, 24, 27, 33, 38 and 39:

- Linked manual pipeline memberships on relationship contact/org profiles, including optional related-organization links, named owners, stage and next action. Pages contain 25 records; errors never imply a zero total. No connected clinical adapters are loaded.
- Exact pipeline-record bookmarks use a tenant/pipeline/record lookup independent of the board's loaded page or filters. Unavailable/archived pipeline links produce an explicit unavailable state instead of silently choosing another pipeline.
- Pipeline details show paged stage events, the existing relationship communication timeline and canonical follow-up tasks. The relationship workspace remains one click away.
- Pipeline and research review sessions reset draft state on tenant/operator/role changes. Source-specific queries keep the existing tenant filters and RLS.
- Institutional and VA research review now uses server-paged search, separate complete-source totals, Awaiting review/Linked/All views, and a link to the existing organization. Linking invalidates board metrics and profile memberships. No organization or source associations were changed during this implementation.
- Recruitment quick views reuse existing reviewed/uncontacted, replied, linked-applicant, blocked, review and overdue predicates, preserving name/state context. No campaigns are activated by these views.
- Canonical task editing converts ISO due dates to local wall-clock input instead of slicing UTC. Invalid date input is rejected before serialization. Clearing a due date in edit mode sends explicit null through the existing repository contract; creation keeps an omitted deadline optional.
- Contact/org detail navigation resets nested drafts for different tenant/user/role/record identities. Lifecycle/referral activity updates invalidate the aggregate timeline; their history queries are scoped to the operator context.
- Communications has a new navigation-only landing page with URL-backed categories for direct messages/replies, campaigns, newsletters and templates. Existing destinations remain available. Technical control-plane navigation moves into Administration; source-specific sending engines are untouched.

### Dependencies and risks

| Surface | Risk | Mitigation and deferred verification |
| --- | --- | --- |
| Manual memberships and record bookmarks | Medium: access, archived/foreign IDs, associated-org semantics | Existing public-client RLS plus explicit tenant/pipeline filters; defer signed role/tenant, >25 record and missing-record acceptance. |
| Research paging/search | Medium: filter behavior, matching totals, equal sort values | Exact count queries, stable ID tiebreaker, restricted literal search and server-side link filters; defer full-dataset and retry acceptance. |
| Stage history and panel reuse | Medium: incomplete source history or refresh mistakes | Paginate existing stage ledger; reuse existing relationship-only timeline/tasks; defer >50 events and cross-view refresh checks. |
| Operator-specific caches/drafts | Medium: stale data during role or tenant switches | Extend keys/reset boundaries; server authorization remains required; defer independent signed-user/role verification. |
| Date editing | Medium: accidental offset changes | Display existing instant in operator local time; defer UTC/Central/DST round-trip acceptance. |
| Communications navigation | Low: route discovery/bookmark regressions | Add one landing route, retain old destinations and control-plane URL; defer role and navigation matrix. |

### Work still requiring source evidence or separate operational decisions

- Shared-database contract changes require the existing migration dependency audit/review gate. This batch adds none.
- Do not close signed-JWT, authenticated UI, release, performance or security acceptance tasks until their evidence exists.
- CRM invitation issuance/shared Auth redirects require the actual administrative invitation mechanism and live multi-portal settings; no guessed global Site URL change was made.
- Research reconciliation and Primary contact conflicts require record-specific identity evidence and deliberate review. Paging is tooling for that work, not proof it is reconciled.
- Donor payment/webhook synchronization requires authoritative source event/ledger mappings and controlled fixtures before production changes.
- No additional tests, lint, typecheck, build, CI inspection, browser checks, migrations, production writes or worker activation were performed.


### Global Primary selection tooling (Phase 41)

Organization contact rows now expose an explicit confirmation action to choose the sole global Primary through the existing `crm_set_organization_primary_contact(p_organization_id,p_contact_id)` RPC. The function's source and generated signature were inspected; it retains permission checks, row locking and same-organization affiliation validation. No database function or production data was changed. Existing Primary flags can also be reconfirmed as sole Primary so a human can resolve legacy multiple-Primary cases. The affiliation form's label now matches organization-wide semantics. Deferred: deliberate choice on real conflicts, concurrent choice/foreign contact/readonly tests, card/Primary refresh and rollback acceptance.


### Canonical Tasks workspace (Phase 16)

The main Tasks page now exposes the existing create/edit dialog, named owner assignment, explicit due-date clearing, local date/time display and links back to a task's relationship contact or organization. Read-only operators do not see selection/mutation actions. Bulk completion has pending/error feedback; list failures cannot present old data as current success. Selection resets when tenant, operator, role or task view changes. Canonical task mapping now retains the relationship subject columns that were already selected from the database. Read-only schema inspection confirmed both subject columns exist in Billing Hub; this was implementation dependency discovery, not behavioral testing. No test task or source record was created.

Deferred Tasks acceptance also includes creating/editing/reassigning from the main queue, relationship source-link preservation, deadline clearing, readonly mutation hiding, bulk failures, empty/error states and independent operator/role transitions. The existing canonical list endpoint retains its original result-limit behavior; it is not a complete audit export.


### Live identity dependency blocker

Read-only catalog discovery on October 15 UTC returned null for `public.crm_identity_reviews`, `public.crm_therapist_prospect_attributions` and `public.crm_identity_review_events`. The earlier runbook already documented their migration as deliberately unapplied pending signed-JWT/source-access acceptance. The current source migration is `supabase/migrations/20261008161000_crm_identity_review_links.sql`. Therefore the review UI's missing-contract state remains appropriate; this batch does not activate identity approvals or attribute prospects. The existing schema migration gate and independent acceptance work remain on the roadmap. No complete new migration audit or migration approval is claimed here.


### Workspace dashboard (Phase 34)

Added a CRM dashboard at `/crm/workspace` and made it the sidebar/default `/crm` destination. It shows a bounded My Tasks preview, separate exact relationship-reply and recruitment-review counts, BTY scheduling/client-operations launchers, and exact existing-RPC attention/stage counts for a selected manual pipeline. It does not aggregate incompatible funnels. Unavailable sources show unavailable states instead of fabricated zeroes. The System Command Center is reachable from Administration and its old URL remains valid. Client dashboard and all existing detail links remain available. No new metrics/RPC/database contracts were added. Deferred: source total reconciliation, zero vs unavailable states, stage/pipeline selection, role/tenant/user transitions, navigation/bookmarks and realistic query performance.

### Identity migration plan is stale

Further read-only schema discovery confirmed `public.therapist_outreach_prospects.tenant_id` is already uuid NOT NULL, while the October 8 identity migration/runbook assumes that prospects lack tenant_id and proposes a separate immutable attribution table. The existing validation trigger checks that proposed attribution overlay rather than directly proving the target prospect's current tenant. Do not apply that migration unchanged. Re-evaluate the actual source-domain tenant/privacy contract and complete a fresh dependency review before schema implementation. No migration or prospect attribution was executed.


## October 14 evening / October 15 UTC: identity, authentication and donor dependencies

- Identity source IMPLEMENTED in PR #154: current-source tenant/permission guard on reads and writes, soft references that preserve source lifecycle, append-only evidence history, canonical/retry handling, typed repository, tenant/user/role-scoped panel, and paged links/history. Removed obsolete prospect attribution UI/API. SQL and test fixtures are prepared.
- Database deployment BLOCKED by Supabase connection error “Invalid or expired requestState”. The last catalog read showed both proposed tables absent. No successful migration or type regeneration is claimed. A scoped SQL contract type extension is prepared until live generation is available. Do not close Tasks 11/12/14.
- Invitation/recovery source IMPLEMENTED: explicit CRM return URLs, password setup flow, server capability check before CRM entry, multi-tenant choice, no-role message, and operator-only explicit CRM invitation script. No script run or email sent. Shared Auth settings/templates remain UNKNOWN through current connector capabilities; see `2026-10-15-crm-invitation-and-recovery.md`.
- Donor expansion BLOCKED on source-contract review: existing processor can populate the legacy email identity registry, increments aggregates per invocation, and emits automation events; current source lacks a proven campaign-to-tenant/currency/recurring lifecycle contract. See donor dependency evidence. No donor processing performed.
- No tests, lint, typecheck, build, CI or browser execution performed for this continuation. All acceptance and release work remains in Task 42. Branch changes remain draft/unmerged/undeployed.

## October 15 resumed implementation

- **Database applied by user; tracking repaired:** catalog discovery confirmed both identity tables/current evidence fields, RLS, policies, triggers and helpers. Inserted only missing ledger version `20261015015000`, name `crm_identity_review_links_current_tenants`; subsequent catalog read returned it. Did not reapply SQL. Migration source SHA-256: `29b364e8ebe63496f36a5892eb47409e9a3b1eb3f8ca1cff17a226653a56cf47`.
- **Source implemented:** generated the full live Billing Hub TypeScript contract and replaced the temporary identity-schema client extension with normal generated client access. Generation also reflects existing unrelated live schema additions (including BTY activity and video transcript speaker fields); no corresponding database changes were made here. Updated identity repository mock source; NOT RUN.
- **Auth tooling implemented; hosted config blocked:** additive exact-redirect planning/operator script with read-only default, explicit apply flag and template-routing indicators. Current OpenAPI endpoint/fields inspected. Shared Site URL/templates are never written by the script. No management credential configured and no Auth-settings connector operation available, so script/config not executed. Exact next action in the invitation runbook. No auth messages, accounts or roles created.
- **Recruitment/staff source implemented:** `/crm/recruitment/applicants` provides paged source-authorized actual applications, including Approved, onboarding and closed statuses omitted by the board preview. Matching staff/CRM tenant required; errors cannot imply empty success. Named owner, next action/due, source application and staff references; no clinical detail copy, approvals, provisioning, resend or network claims. Board/list handoff summaries reuse existing authorized source data. See `docs/architecture/2026-10-15-recruitment-staff-handoff.md`.
- **Donor dependency review advanced; ingestion blocked:** inspected live object definitions/grants, source/queue uniqueness, aggregate-only counts, both deployed webhook variants and CRM/Billing Hub/staff source consumers. Documented owner-privilege transaction view/null-ID joins, directly executable private definer, legacy identity creation, replay/amount/currency/recurring and external ownership gaps. Added a concrete forward strategy, not SQL deployment. Asked for authoritative source ownership/subscription/event evidence. Existing donor UI now labels aggregates unreconciled and scopes/hides cached enrichment appropriately. No donor processing or grant/schema changes.
- **Acceptance remains open:** prepared Auth configuration plan, handoff domain and repository test source. No tests, lint, type checks, builds, browser acceptance or workflow execution. Publication uses `[skip ci]` to defer automatic checks to Task 42. No merge/deployment or completed roadmap acceptance is claimed.

Remaining independent roadmap items were reviewed against their current source and task notes: implemented navigation/tasks/pipeline/workspace work awaits deferred acceptance; identity acceptance waits the combined role/migration pass; invitation live configuration requires Management API access; staff invitation transport/retry and campaign end-to-end require approved recipients and deferred checks; donor expansion requires the explicit source contract; source/Primary reconciliation requires record evidence. Current Social Media/publishers and all execution holds are preserved.

### Successive source-action integration (Phase 20)

Added a typed connected-source action registry and dispatch adapter. `ConnectedStageEditor` now derives destinations, follow-up requirements and guidance from that registry and calls one dispatcher. Dispatch still invokes the independent BTY/applicant source adapters with their existing tenant/version/reason/follow-up checks and audited native RPCs. No generic table writer or universal lifecycle state machine was introduced. Unknown, clinical/staff and prospect sources have no fallback; first-contact, approval/invitation and BTY campaign-readiness holds remain. Prepared registry contract tests, NOT RUN. Source status/version/mode rejection, native dispatch/refresh/errors and source permission matrix remain in Task 42. No source records changed. Broader clinical/staff lifecycle mutation remains in its authoritative workspace until a separately reviewed action contract exists.

## Zeffy scope correction and read-only review

User confirmed Zeffy is the current Foundation platform; Givebutter `565036` is legacy. Reviewed Todoist, current website source, deployed Zeffy receiver/catalog and official provider documentation. [Current evidence, field matching and missing configuration](architecture/2026-10-15-zeffy-donation-integration-review.md). Deployed receiver v11 and historical captures exist; no donor ledger processing or deterministic click attribution bridge is implemented there. Public form confirms the Zeffy Foundation organization/form IDs, but no authoritative Billing Hub Foundation tenant mapping was found. Preserve Donation form opened intent conversion and add verified payment amounts separately only after ownership/authentication/attribution configuration is established. Legacy security/retention tasks remain separate. Documentation/Todoist corrections only; no application, database, provider or Ads configuration change, runtime acceptance, ingestion or upload.

## Further implementation: canonical Tasks and selected tenant (Phases 13/16/23)

Source implemented; NOT TESTED or deployed. Relationship tasks now accept the UI's explicit tenant/operator scope and revalidate it against the current server capability response. A null automatic server tenant no longer blocks an otherwise authorized selection. Wrong-session, foreign tenant and readonly writes fail before the task operation. Removed the temporary task-client schema cast; live generated subject columns are used directly. Existing task RLS/subject/owner/provenance triggers remain authoritative and unchanged.

Canonical Tasks now requests 50-row source pages with stable ID ordering after due/completion/update ordering. Status, priority, named owner and literal search filters are URL-backed and apply before pagination. Existing unpaged repository consumers retain their API behavior. The UI labels page/loaded counts without claiming a workspace total; a full last page may require one empty Next page. Offset pages may shift under concurrent writes. Mock adapter paging/sort was updated for parity; it is not production evidence.

Bulk completion records completed_at; form status transitions set/clear completion timestamps while ordinary edits to completed tasks preserve the existing timestamp. Terminal rows cannot be bulk-selected for completion. Explicitly clearing a description now writes null. Existing native task triggers were inspected for implementation dependency discovery only; no task was mutated. Prepared filter/paging/selected-scope tests; execution remains under Task 42. Rollback by reverting source; no migration is added.

## Successive tenant, ownership and audit integration (Phases 13/15/17/22/23/24/27/34)

Source implemented; NOT TESTED, merged or deployed. Live function source inspection showed `crm_select_operating_tenant` validates a tenant but does not persist session selection; `get_crm_operating_context` only chooses automatically for a single authorized tenant. Direct relationship, lifecycle and opportunity adapters now use the mounted CRM selection and revalidate its tenant/operator against the server capability response. The in-memory selection is a preference, not a grant. Missing selection, session changes and an intervening tenant switch reject the operation. Non-UI callers retain the existing server-selected contract. RLS remains authoritative. The ID-only native relationship-stage action also checks the source belongs to the selected tenant before dispatch. Tenant-implicit campaign/delivery/import/referral RPC contracts have NOT been generalized; ambiguous multi-tenant operations remain fail-closed pending a backend contract review.

CRM Auth retains working refresh/switch callbacks after context replacement, discards stale asynchronous responses, clears the selected binding immediately on auth/tenant transitions and fails closed on rejected context requests. Storage denial no longer prevents startup or an otherwise authorized in-memory tenant choice. Server selections must appear in the capability response. Relationship-only email timeline reads now accept explicit authorized tenant/operator scope; no clinical email query was introduced.

Directory, owner, recruitment reconciliation and additional pipeline caches include operator/role scope. Failed capabilities, applicant/readiness responses, owner rosters, pipeline list/record details and global metrics cannot present cached data as current success. Pipeline stage history displays the recorded actor profile and a named owner lookup where available; missing actors remain “Not recorded.” The staff owner directory pages beyond the former 500-row cap, excludes inactive entries and deduplicates profiles. Dashboard My Tasks now actually requests only its five displayed rows.

Prepared Auth race/switch, direct selected-scope, relationship email scope, full owner directory and actor-history fixtures. No fixtures or other checks executed. The staff workspace source was reviewed again: no exact-applicant read/URL contract exists; CRM continues linking to its authorized applicant workspace rather than inventing an exact-record destination. Staff approval/provision/invitation transport is unchanged. No source records, roles or configuration changed. Rollback by reverting this source batch; no new migration.

## Zeffy independent implementation prepared

Separate Billing Hub draft [PR #15](https://github.com/LPredmore/valorwell-billing-hub/pull/15), branch `codex/zeffy-verified-capture`, source commits `ceccbd7` and `495d0ea`: raw-byte HMAC/timestamp validation and bounded capture into the existing event table, trusted verification markers, duplicate/conflict handling that preserves historical unverified rows, pure cent/currency/refund/payment projection, and a GET-only authenticated payment review command with partial-report safeguards and aggregate-only output. Prepared signature/capture/retry/refund/cursor fixtures; NOT RUN. No provider request, deployment, secret/configuration change, tenant assignment, donation ledger write, conversion upload or historical mutation was performed. See the Billing Hub PR runbook for exact configuration and deferred execution steps.

Foundation tenant mapping, current Zeffy subscription/signing/read-API bindings, documented recurring lifecycle completeness and a supported opaque visit-token round trip remain open. The existing Google Ads Donation form opened action stays the initial intent conversion; payment values and attribution must use a separate verified contract. Givebutter `565036` is historical and does not block this work.

## Owner clarification: Foundation donations use the existing CRM tenant

Owner explicitly confirmed Foundation donations belong to `00000000-0000-0000-0000-000000000001`, the existing CRM tenant, and confirmed the Zeffy webhook base endpoint. Ownership decision is resolved; no separate Foundation tenant is needed. Earlier missing-ownership notes are historical. Downstream mapping/ledger remains source/configuration work, not deployed by this note. A base URL ending in an empty question mark does not establish secret binding, enabled subscriptions or current delivery success. Shared Auth dashboard inspection instructions are recorded in the invitation/recovery runbook. No tests, runtime/configuration changes or messages.

## Owner-provided shared Auth settings

Owner supplied Site URL https://client.valorwell.org, redirect entries missing CRM, and both invite/reset templates using ConfirmationURL. Configuration inspection dependency is now partially resolved by owner evidence; exact three CRM return additions still unconfirmed. Keep existing shared Site URL/templates/portal entries. Reviewed client guard and both origin-local session clients; documented separate staff-only routing versus dual-role client behavior in the Auth runbook. No client/staff application changes, settings edits, messages or tests. Deferred checks appended to Task 42.

## Successive roadmap source implementation: staff handoffs, BTY and operational queues

User explicitly accepts a second sign-in when staff-only accounts reach EMR. Existing client-portal branch `codex/staff-portal-routing`, commit `12c46bc`, and draft [client PR #31](https://github.com/LPredmore/valorwell-clients/pull/31) were found in the workspace and preserved. The source uses canonical client-first resolution and an existing self-scoped staff context; no-client/staff evidence redirects to the fixed EMR origin, while dual-role clients stay in their client lifecycle. No token transfer, global sign-out, profile creation or role grant. Prepared fixtures remain NOT RUN. This is source implementation, not live routing acceptance.

Independent staff source now published in draft [staff PR #30](https://github.com/LPredmore/valorwell-staff/pull/30), commit `5ebb2e9`: native applicant workspace has 50-row paging beyond its former 100-row first-page cap, URL search/status/page and all actual source statuses; auth/tenant/user/role-scoped queries, malformed/repeated actionable-page rejection and failure states. Existing approval/provision/invitation actions are preserved and never invoked by reading/navigation. A new `applicant=<uuid>` locator marks only that exact ID within authorized results, uses a name as a search hint and explicitly explains absent references. CRM handoff queue and connected applicant cards now generate those fixed staff links. Deploy/review staff source before relying on the CRM locator. This is not an exact-record API or proof of an identity match; native offset ordering remains a concurrency limitation.

CRM source changes (Phases 15/17/22/23/24/30/32/34):

- BTY opportunity search/status/cause/veteran/page state lives in the URL; detail/back navigation preserves it and validates query values. Search/cause debounce hides obsolete results; errors cannot present cached names/rows/totals as current success. Tenant/user/role scope resets detail drafts and owner caches; readonly mutation sections are hidden. Direct opportunity list adds an ID sort tie breaker.
- Ordinary BTY owner/qualification/followup edits now carry the displayed `updatedAt` as an atomic conditional update. Read-only live trigger discovery confirmed native `version` advances only for status changes, while `updated_at` advances for ordinary edits. A lost timestamp race returns a reload error; no trigger/schema change. Legacy API callers omitting the optional timestamp retain their existing behavior. Stage transitions retain their native version/audit contract.
- Opportunity interactions load additional 100-row pages, deduplicate loaded IDs and show failures/retry rather than stopping silently at 100. Orchestration evidence is hidden after failed refresh. No clinical messages or new timeline sources were added.
- Connected BTY/client source traversal no longer silently stops at 2,000: stable created/ID ordering, repeated-ID/error rejection and an explicit traversal safety failure replace incomplete success. Staff assignments are paged; staff identity hydration uses bounded ID batches. Applicant traversal likewise rejects malformed/repeated pages and reports a safety limit instead of silent 20-page truncation. Prospect board preview deliberately remains 200 with its full source queue link. Offset changes can still shift membership; this is not an audit export or measured performance claim.
- Operational Exceptions hides readonly mutations and cached failed results, shows retry/mutation/owner errors and pending state, scopes queries by operator/role, and revalidates current server CRM mutation capability before each native operation. No exception/task was changed. Existing exception update/audit/idempotency limitations are not remediated by these UI guards.

Prepared filter/locator/page-contract/scope/exception/connected-traversal/stale-opportunity fixtures, NOT RUN. No tests, lint, type checks, builds, browser checks or workflow execution. No schema/configuration/source-record changes, messages, payments, Ads uploads, workers, campaign activation or Social Media/publisher changes. All branches remain draft/unmerged/undeployed. Phase acceptance remains open; deferred checks appended at the end of Todoist task 42. Roll back source through GitHub; no database migration to reverse.

## User-authorized merge to main — October 15

User explicitly requested merging all continuation work to main. All four PRs were marked ready and merged with their inspected head SHA pinned; GitHub subsequently reported each closed and merged:

| Repository / PR | Merge commit |
| --- | --- |
| CRM [#154](https://github.com/LPredmore/valorwell-crm/pull/154) | `b755b776c0b96149263164448eb1fcafd47cbf78` |
| Staff [#30](https://github.com/LPredmore/valorwell-staff/pull/30) | `62444fafe19713544cc1af92470feedd29249aa7` |
| Clients [#31](https://github.com/LPredmore/valorwell-clients/pull/31) | `09a272d1a39413e3e9ab365d1ea870ab0918638c` |
| Billing Hub [#15](https://github.com/LPredmore/valorwell-billing-hub/pull/15) | `00f74b3b2000c6ec89c87a2127dd904be048b60e` |

Earlier draft/unmerged notes above are historical and superseded by this merge receipt. Merge commit titles include `[skip ci]` to preserve the user's deferred-check instruction. No tests/lint/type checks/build/browser acceptance or workflow dispatch was performed. This is GitHub merge evidence, not application deployment or runtime verification. No manual hosting/Edge Function deployment, Auth setting change, source-record change, message/payment/upload or worker/campaign activation was performed in this merge pass. Automated hosting status was not checked. Task 42 and all incomplete acceptance/configuration/backend/evidence requirements remain open.
