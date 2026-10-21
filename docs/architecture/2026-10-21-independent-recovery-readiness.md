# Independent recovery verification — October 21, 2026

**Release decision: NOT READY.** Hosted catalog verification and three narrowly scoped
test-branch repairs executed in this session. Historical replay, complete signed-user
acceptance, and provider acceptance remain separate, unfulfilled gates. Nothing was
deployed to production. Production history was not repaired.

The production project was `ahqauomkgflopxgnlndd`; the authorized test project was
`dskqovrvogmwrlmxsdjd`, branch `valorwell-security-recovery-20261020`. The control plane
still reports `MIGRATIONS_FAILED`. Production has 966 ledger entries. The manually
reconstructed branch started with 25 and now has 28. Its recovery/test entries do not
represent replay of production's historical chain.

Evidence: [sanitized independent observations](migration-recovery-evidence/20261021-independent-verification.json).
These supersede neither earlier receipts nor their observation times. Catalog calls
used explicit READ ONLY transactions and separate snapshots; this is not a globally
atomic comparison. No production table records, role passwords, vault secrets, raw
schema export, or executable function bodies were committed.

## Executed corrections and root causes

The application-only schema reconstruction left destination platform grants in place.
GRANT statements in a schema restore do not necessarily remove privileges already
present on the destination. Independent inspection found 289 relation ACL differences,
including anonymous TRUNCATE/REFERENCES/TRIGGER/MAINTAIN privileges absent in production.
RLS does not protect TRUNCATE. This establishes an overprivileged test reconstruction;
it does not establish an exploitable production PostgREST route. The raw private
restore inputs were unavailable here, so the exact restore statement responsible
was not independently identified; surviving destination defaults are the supported
explanation, not a claim to have audited that private SQL.

`relation_acl_repair.py` renders exact object/owner/preimage/postimage checks and only
the privilege differences from captured relation metadata. A single DO block makes
failure atomic. It rejects production as a target, unknown grantors/roles/options,
unsafe identifiers, duplicate identities and mismatched relation coverage. It never
connects to a database. The caller must independently verify the control-plane project
selector: a generated SQL comment is not server-side project authentication.

The generated repair was tested in a transaction ending in ROLLBACK, then applied only
to the test branch as `20261021105916_recovery_restore_captured_relation_acl`.
All 481 application relation ACLs subsequently matched production after ordering ACL
items canonically, preserving grantors and grant options. Reusing the original
preimages after repair raised `Recovery ACL before mismatch` before any changes;
regenerate from fresh captures rather than replaying this recovery entry. Six offline
regressions cover safety and legitimate access preservation. No function grants were
reverted; the October security changes remain in effect.

The application-owned `auth.users.on_auth_user_created` hook was omitted with the
managed Auth schema. Its existing `public.handle_new_user()` function already matched
production. Exact trigger restoration passed a rollback test and was applied only to
the branch as `20261021110301_recovery_restore_captured_auth_user_hook`. A subsequent
definition/enabled-state fingerprint matched production. This verifies installation,
not signup runtime behavior or downstream transport safety.

The application-owned `supabase_realtime` publication also lacked its two production
memberships. The production members have no row filters and their captured column
fingerprints match. A rollback test verified exact empty preimage and two-table
postimage. Branch migration `20261021111438_recovery_restore_application_publication_memberships`
restored `public.messages` and `public.crm_clickup_sync_runs`; both membership
fingerprints now match production. This does not restore the separate managed
`supabase_realtime_messages_publication` or prove delivery to a realtime client.

CRM's required lint gate also failed on a single-assignment timer in generated preview
auth storage. The minimal `const` correction preserves behavior. A new fake-clock test
checks both editor timeout requests, local fallback and listener/timer cleanup. The
existing strict lint rule remains the regression check for the original lint failure.

The full local CRM suite returned **970 PASS / 1 FAIL**: a newsletter editor mount
test exceeded its existing five-second timeout during concurrent checks. Its unchanged
five-test suite then passed in isolation (the affected case completed in 1.254s).
No timeout or assertion was relaxed. Resource contention is a plausible explanation,
not a proven root cause; retain the full-run failure and require a clean full CI run
before treating the application gate as resolved. This remaining timing risk does
not change the database release blockers.

## Production/test parity

| Category | Independently observed result | Interpretation |
| --- | --- | --- |
| Tables / views / sequences | 425 / 37 / 19 in both; all 481 identities present | PASS for identity coverage |
| Relation owners, kinds, RLS flags, options | Zero differences in 481 relation metadata fingerprints; 408 tables enable RLS | PASS for compared metadata, not policy adequacy |
| Relation grants | 289 differences before repair; zero canonical ACL differences after | PASS after branch-only repair |
| Columns | 6,724 live table/view columns; zero differences after ranking live columns in relative order | 162 raw differences were physical attnum gaps, not missing/reordered live columns |
| Constraints | All 2,399 production table constraints match; one additional Stedi retirement CHECK | Expected PR #34 delta |
| Indexes / enums / sequence definitions | 1,578 / 67 / 19 match | PASS for compared definitions and validity metadata |
| Application policies | All 551 match | PASS for definitions, not signed tenant execution |
| Storage policies | 19 production policies absent on test | BLOCKED for Storage authorization equivalence |
| Triggers | All original captured triggers match after Auth repair, except the reviewed claim-line tenant trigger change | Expected claim correction delta; runtime unverified |
| Functions | 1,122 production, 1,123 test; 22 raw changed signatures | 20 signatures fall within the staged October changes; two CRLF/LF-only body differences; one added private claim helper; fresh-baseline replay remains pending |
| Function ownership / SECURITY DEFINER / ACL / configuration | Compared independently for all application functions; differences listed per signature in JSON | Do not turn intended authenticated APIs into service-only APIs |
| View definition | `relationship_report_metrics_v` raw hash differs | Private text comparison found only 22 redundant `::text AS text` aliases; owner, invoker option and columns match; runtime comparison pending |
| Default privileges | All 30 default-ACL fingerprints match | The 12 omitted managed statements did not leave a current default-ACL catalog difference; this does not claim they executed |
| Application/extension dependency edges | 12,941 production distinct identities; zero missing or changed multiplicities; six added edges | Added edges belong to reviewed claim helper/language and Stedi CHECK; catalog dependencies do not resolve dynamic SQL/body references |
| Extensions | Six match; pg_net differs | Production 0.19.5 in public; test 0.20.4 in extensions; compatibility unproven |
| Database / role settings | Owner postgres and en_US.UTF-8 match; seven compared role fingerprints match | Production PostgreSQL 17.6/aarch64 vs test 17.11/x86_64; engine/locale implementation differences still need acceptance |
| Role memberships | Three additional realtime-admin memberships on test | Managed infrastructure difference requiring owner review |
| Publications | Application publication's two memberships repaired and fingerprint-matched; one managed publication and seven managed memberships remain absent | Realtime delivery tests remain unverified |
| Schedulers | Production 52 jobs / 42 active; test zero | Deliberate schema-only isolation, not scheduling acceptance |

The older pinned fingerprint query remains unchanged. Its postrepair raw relation
hashes still differ on 94 relations because ACL array ordering is retained in that
query, plus the single view deparser difference. Component queries independently
confirm equal relation metadata and equal sorted ACL items. No broad category was
silently allowlisted. The supplementary queries are read-only and return hashes or
catalog identity/permission metadata, never function bodies or business records.

`postgres` is not a member of `supabase_storage_admin` and has no ownership privileges
on `storage.objects`. Restoring the 19 policies requires the managed object owner or
the supported Supabase administration path; do not grant that role wholesale to pass
tests. Publication/managed memberships and extension version changes also require
explicit platform reconciliation. Anonymous/authenticated SECURITY DEFINER advisor
findings remain contract-review candidates, not a basis for indiscriminate revocation.

## Test matrix and evidence boundaries

| Test | Result this session | Evidence / limit |
| --- | --- | --- |
| Source bytes vs recorded test migrations | PASS 11/11 | Ten staged files plus PR #34: byte length and recorded-body MD5 match checked-out sources; source SHA-256 pinned separately |
| Targeted RPC permissions | PASS 16/16 on test; 4/16 on production | Real catalog has_function_privilege results; twelve production failures remain staged changes, not deployment authorization |
| Idempotency helper, claim/payroll internal, automation emitter, worker/social, donor ACL assertion scripts | PASS 5/5 | Existing DO assertions executed in READ ONLY transactions; not tenant/application execution |
| Donor fail-closed bodies, title search_path, browser view denial, enrollment 403 marker | PASS | Catalog definitions/grants, no RPC side effects invoked |
| Relation repair / Auth hook / application publication | PASS | Real rollback validation, branch-only apply, and postapply fingerprints; stale-preimage negative control rejects |
| Anonymous PostgREST table access | PASS denial | Test-project GET with synthetic nonexistent ID: HTTP401 / SQLSTATE42501, no rows returned |
| JWT signed by untrusted independent key | PASS rejection | Test-project GET: HTTP401 / PGRST301; this does not test a trusted user or token expiry |
| Valid signed users, client/clinician/admin memberships, same-tenant positive controls, cross-tenant denials, service worker requests | BLOCKED | No private approved isolated baseline or native DB/Auth/PostgREST stack in this workspace; hosted server-side egress denial unproven |
| Full CRM #193 database worker suite | BLOCKED before scenarios | Explicit opt-in preflight cannot load private local synthetic signing secret; no worker scenario passed |
| Full Billing #40 claims/payroll database suite | BLOCKED before scenarios | Owned `valorwell-schema-exact` container absent; no database-backed scenario passed |
| Full Stripe database posting/dedup/reconciliation suite | BLOCKED | Same missing owned authoritative stack; source webhook tests do not replace it |
| Stedi read-only postdeploy checks | 4 PASS, 2 FAIL | Zero active/unclosed routes and cron; fence present; historical minima returned zero instead of >=4 attempts / >=6 events |
| Stedi historical retention acceptance | BLOCKED | Schema-only restore copied no history. Preserve failed raw assertions; do not lower minima or invent records as evidence of production retention |
| Claim.MD sandbox submission, genuine acknowledgement, uncertain outcomes and retry | BLOCKED | No designated sandbox credentials/tenant/provider setup; no claim was submitted or accepted |
| Stripe sandbox/webhook deployment and reconciliation | BLOCKED | No designated branch test account/webhook secret or hosted workflow execution |
| Payroll sandbox payment/calculation/reconciliation | BLOCKED | No designated sandbox setup; no payment initiated |
| Campaign scheduling, retries/idempotency and CRM worker failure recovery on full recovered DB | BLOCKED | Full isolated acceptance prerequisites above; hosted cron deliberately remains empty |
| Historical migration replay | FAIL, existing control-plane state | First historical migration references set_updated_at before it exists; not replayed or repaired here |

Fresh local source/application results are captured separately in
[the execution summary](migration-recovery-evidence/20261021-local-test-execution.json).
Existing Billing mocked source regressions ran successfully (5 claim/auth/tombstone,
7 Claim.MD orchestration and 13 payroll cases), as did 20 Stripe signed-webhook source
tests. Their database/provider adapters are synthetic; their fixture responses are
**not accepted claims, provider evidence, or database-backed integration acceptance**.
No new accepted-claim response was fabricated. Existing historical PR claims of local
15/15, 23/23 or Stripe 13 results were reviewed, not relabeled as fresh executions.

## Forward-only baseline and migration execution plan

Do not reset/rebase/merge the failed Supabase branch. Do not repair production's ledger,
insert historical rows, or add a guessed helper under an old applied version. The
historical chain remains incomplete; a new late migration cannot fix an earlier
bootstrap dependency.

For reproducible **new environments**, privately capture a complete current-state
baseline and its exact export-time ledger, database/role/extension state, Auth/Storage
hooks/policies and publication dependencies. Have the baseline reviewed for embedded
capabilities, dependency completeness and owners/grants. Bind approved bytes and exact
superseded history metadata in an immutable provenance manifest. Provision a fresh,
owned, genuine Supabase stack with server egress denied before loading SQL. Install the
baseline as a genuinely new baseline version, preserve historical mapping outside the
runtime ledger, then execute only hash-bound post-cutover deltas. Verify strict parity
and run all independent signed-PostgREST suites there. CI continues to test tooling
without accessing the private schema. This is current-state provisioning, never a
successful historical replay claim.

For the existing production database, obtain a new read-only ledger/catalog snapshot
immediately before release. Stripe version `20261019232604` is already present: retain
it and **do not replay historical alias 20261019000100**. The reviewed applicant delta
`20261020214527` is also already present. The branch's three new recovery repairs correct
reconstruction drift and must **never** be sent to production.

After all gates and separate production authorization, execute the following reviewed
source inputs in this exact order, using a dedicated release manifest and controlled
migration runner. All eleven source hashes are in the evidence JSON. Stedi is an
optional separately approved first item; skipping it leaves the ten-file security order.

| Order | Repository / exact source file | Prerequisite |
| --- | --- | --- |
| S | Billing #34: `20261018235900_retire_stedi_operational_routing.sql` | Billing owner resolves historical/uncertain attempts; pg_cron/route preflight and isolated retention/future-window tests pass |
| 1 | CRM: `20261019000200_revoke_direct_crm_idempotency_helpers.sql` | Reviewed helper contracts and trusted worker access |
| 2 | Billing: `20261019000300_claim_payroll_internal_rpc_acl.sql` | Existing four RPCs/owners and service controls |
| 3 | CRM: `20261019000310_campaign_lifecycle_authorization_and_idempotency.sql` | Actual lifecycle/idempotency schema and authorization contracts |
| 4 | CRM #193: `20261019165842_crm_campaign_membership_profile_contract.sql` | Immediately after 00310, before traffic resumes; do not timestamp-sort |
| 5 | CRM: `20261019000400_internal_campaign_social_worker_acl.sql` | Positive service worker controls |
| 6 | CRM: `20261019000410_ai_ops_title_trigger_search_path.sql` | Actual trigger/function and dependency qualification |
| 7 | CRM: `20261019000500_fail_closed_legacy_donor_attribution.sql` | Donor owner acknowledges unavailable legacy attribution |
| 8 | CRM: `20261019000600_restrict_crm_automation_event_emitter.sql` | Trusted automation contracts |
| 9 | CRM: `20261019000800_campaign_lifecycle_forbidden_response.sql` | Lifecycle helper installed; signed foreign/missing HTTP403 regression |
| 10 | Billing: `20261019085103_claim_status_authorization_boundary.sql` | Claims schema/triggers; client/clinician/admin/billing/service regression suite |

These staged versions sort before production's latest version. A normal blanket
`db push`, `--include-all`, or migration-repair command is not an approved deployment
method. The release owner must choose and review a forward-only packaging track:
new CLI-generated deployment versions above the then-current production maximum,
containing the reviewed changes in the table's order, with immutable mappings to the
unchanged staged inputs and explicit supersession for fresh-baseline provisioning.
Prepare and test those concrete envelopes in a later PR before asking to execute them;
no deployment envelope or production-ledger operation is authorized here. This plan
provides exact input order; packaging/version allocation is a remaining release gate.

## Risks, recovery and required human approvals

1. **Platform/database owner:** reconcile 19 managed Storage policies, realtime
   publications/memberships and pg_net/engine compatibility. Approve the private
   baseline's embedded-capability review and exact managed dependencies. Missing
   Storage parity invalidates Storage access tests; missing publications invalidate
   realtime delivery tests. Restored Auth trigger still needs isolated signup coverage.
2. **Security/domain owners:** approve CRM #193's intended membership contract and
   each narrow RPC authorization change after positive and negative signed-user tests.
   Client, clinician, admin and tenant membership roles are not interchangeable.
3. **Billing owner:** separately approve PR #34 and resolve historical Stedi unknown
   outcomes before final provider retirement. Never resubmit uncertain historical
   attempts automatically to Claim.MD.
4. **QA/provider owners:** supply an approved private baseline bundle or perform its
   owned isolated restore, then rerun full native signed-JWT tests with independent
   synthetic users in multiple tenants. Configure designated provider sandboxes with
   scoped secrets outside Git/command history; explicit synthetic submission testing
   must produce genuine sandbox evidence. No production password is needed.
5. **Release operator:** review generated forward-only deployment envelopes, current
   ledger/catalog preconditions, maintenance window, backups and recovery procedure;
   authorize production SQL and each Edge/configuration deployment separately only
   after every release blocker is closed. Approval to merge a source PR is not approval
   to merge the Supabase branch or activate workers.

Take a recoverable database backup and private prechange definitions/ACLs before an
authorized rollout. Record cron/worker configuration without secret values. Pause
affected dispatch only under that approval, apply ordered transactions, and check
service positive controls plus browser denials before resuming. Stop at the first
failed prerequisite; never skip a failed assertion. Prefer a reviewed forward fix to
restoring vulnerable browser grants. Stedi fences and immutable claim/payment evidence
must remain intact. Restoring provider routing, resubmitting claims, altering ledgers,
restoring production data or enabling workers requires a separate human decision.

For this branch, the repair SQL and sanitized captures remain private with SHA-256
digests in evidence. A wrong/stale preimage aborts atomically. Reinspect current grants
and generate a new exact delta if correction is needed; do not blindly run inverse
grants. No full release-readiness claim is justified until the blocked matrix rows and
forward-only deployment packaging are resolved.
