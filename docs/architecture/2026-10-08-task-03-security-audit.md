# CRM Modernization — Task 03: Live authorization, RLS and sensitive-data boundary audit

**Date:** 2026-10-08. **Source:** read-only `pg_policies`, `pg_class`, `pg_proc`, `has_table_privilege`, `has_function_privilege`, `has_schema_privilege` inspections on Billing Hub `ahqauomkgflopxgnlndd`, plus `src/repositories/supabase/relationships.ts`, `relationships-opportunities.ts`, `CrmLayout.tsx` and social-media architecture. **No authorization policy has been altered.**

## Current effective access model (metadata verification)
| Domain/table | RLS | Observed policy/entry point | Boundary decision |
|---|---|---|---|
| `relationship_contacts`, `relationship_organizations` | Enabled | Capability-specific authenticated policies `private.crm_has_relationship_permission(... tenant_id, permission)`; separate tenant staff/admin policies; own-profile contact policies | Enforce both server RLS and explicit tenant filters. Check permissive policy union carefully. |
| `relationship_opportunities` | Enabled | `crm_user_capabilities` tenant-scoped SELECT/INSERT/UPDATE policies | Keep BTY opportunity authorization distinct from generic prospect editing. |
| `relationship_campaigns`, enrollments, communications, suppressions | Enabled | Staff/capability-limited authenticated SELECT; privileged RPCs/worker handle mutations | Do not replace with broad authenticated writes or share across clinical mail engine. |
| `crm_tasks` | Enabled | Role-based tenant SELECT/INSERT/UPDATE/DELETE with `crm_has_role(auth.uid(), tenant_id)` | Preserve current staff role semantics; extend only with reviewed contact/pipeline subject references. |
| `crm_people`, `crm_person_identities`, `crm_person_records` | Enabled | SELECT limited by `is_tenant_member(auth.uid(), tenant_id)`; registry empty | Registration/backfill must use guarded service/RPC; not a universal browser-writable contacts table. |
| `provider_applicants` | Enabled | 0 direct `pg_policies` for authenticated/anon | Existing service/RPC worker boundary; no direct browser CRUD. |
| `therapist_outreach_prospects` | Enabled | 0 policies; **no tenant_id column** | High-risk to bind directly to new multi-tenant CRM. Review ownership/provenance, add trusted import/reconciliation path only after explicit tenant decisions. |
| `ai_operations_social_publications` | Enabled | Single `service_role` policy | Social control-plane Edge Function authenticates/tenant-scopes requests; retain existing service-role boundary; do not make table browser-accessible. |
| `crm_newsletters` | Enabled | authenticated SELECT requiring tenant membership | Newsletter mutating/sending RPCs are more privileged; preserve send guard. |

**Important correction to archived documentation:** July 2026 `docs/architecture/relationship-schema-alignment.md` described broad `USING (true)` relationship policies at that time. Live Oct 8 `pg_policies` results instead show capability and tenant-scoped rules above. Treat old guidance as historical.

## Additional privileged surface findings
1. Postgres public views checked: `crm_campaign_participation_v`, `crm_person_source_records`, `crm_va_vaccn_referral_contacts_verification`, most `relationship_*_v` views have `security_invoker` enabled. **Exception needing inspection:** `crm_donor_transactions_v` has no `security_invoker` option and `authenticated` SELECT is granted. This can bypass underlying RLS under the view owner's privileges; audit view definition, owner, grant semantics, visible fields and domain before continuing any unified reporting change. This observation is a risk indicator, **not proof of cross-tenant disclosure**.
2. Multiple `SECURITY DEFINER` functions exist in `public` and `private`. Some private helper routines show EXECUTE privileges inherited by `anon`/authenticated; `anon` has **no private-schema USAGE**, whereas authenticated has private-schema USAGE. Lack of schema access limits direct anon invocation but does not replace function-level permission review. Focus on input validation, tenant check, `search_path`, and callable surface of membership, newsletter, identity and campaign functions.
3. Public `crm_process_newsletter_unsubscribe` shows `anon` EXECUTE. An unsubscribe endpoint may intentionally be public but token verification/idempotency/rate control must be independently tested before calling it safe.
4. `CrmLayout.tsx` requires authentication but authentication alone is NOT authorization; the menu must enforce capability visibility while server functions and RLS enforce final decisions. `relationship_contacts` has several policies, so evaluate OR combinations before asserting only one path controls access.
5. The social worker's `service_role` power means `social-media-manager` must tenant-scope every read and mutation itself. Its architecture document records this design; run negative-case tests before any refactor, not in current audits.

## Required permission/role regression matrix
| User context | Contacts and orgs | BTY opportunity | Clinical details | Social publishing |
|---|---|---|---|---|
| CRM relationship viewer | Read own tenant's authorized relationship data | Only assigned capability | Not by virtue of CRM membership | Read-only only if social capability permits |
| CRM relationship editor | Mutate authorized own-tenant relationship data | Allowed BTY transitions only | No clinical note access | No publishing implied |
| Staff clinician | Staff role plus specific permissions | Only if explicitly authorized | Protected by EHR-specific policies | Not automatically authorized |
| Recruiter / applicant | Only permitted candidate/referral subset | No automatic BTY access | None | None |
| Unauthenticated | No general CRM data | No opportunity access | None | No control-plane publishing |
| Cross-tenant authenticated user | **Denied** | **Denied** | **Denied** | **Denied** |

This is a **required test matrix**, not a claim it has been exercised with independent JWT identities.

## Security validation gates before production schema/UI changes
- Create two synthetic tenant contexts and low-privilege test users through approved environment; verify authenticated A cannot SELECT/INSERT/UPDATE B's contact, organization, opportunity, activity, task, candidate or pipeline row, including RPC and view access. Avoid impersonating real production users.
- Test `security_invoker` view behavior against both tenants and roles, especially `crm_donor_transactions_v`. Inspect its definition and remediate if found unsafe, separate from unrelated nav release.
- Test restricted access to staging therapist prospects and provider applicants through browser API and via proposed RPC after a safe tenant assignment.
- Review each new `SECURITY DEFINER` function for narrowed privileges, pinned `search_path`, explicit tenant authorization, `auth.uid()`/service-only checks, and input constraints. Do not use definer to bypass errors.
- Verify clinical/PHI read denial from relationship-only role and no protected payload copied into generic contact/communication search.
- Review public unsubscribe endpoints for signed token scope and abuse controls.
- Do not expose `service_role` or other secrets in frontend/logs.
- Perform test under genuine low-privilege identities, not an admin/service-role account, and record PASS/FAIL evidence.

## Completion status / explicit blocker
**Static policy and surface audit: DONE.** Live policy table, schema privileges, function privilege flags and view options were read without mutations. **Cross-tenant runtime negative tests: NOT DONE.** This environment did not establish independently authenticated synthetic tenant test sessions; admin metadata cannot prove effective RLS or view isolation. Therefore Task 03 **must remain OPEN** until the role-based test matrix is executed and reviewed. Documented suspicious surfaces should be triaged before Task 19 schema exposure or shared identity release.

This audit creates no production authorization changes. Evidence is inspectable using the live metadata queries and repository paths above.


---

# Addendum — Controlled Runtime RLS Tests, Security Advisor, and Concrete Findings
**Audit date:** 2026-10-08. **Tooling:** Billing Hub SQL execution with `BEGIN TRANSACTION READ ONLY`, `SET LOCAL ROLE authenticated|anon`, session-local simulated `request.jwt.claim.sub` values, RLS-policy and function metadata inspection, and Supabase Security Advisor. **No database mutations, DDL, subscriber sends, scheduled publishing, role grants, or background jobs were changed.**

## 1. Read-only role simulation results

The following tests executed against the *current live database* using Postgres `SET LOCAL ROLE`. They are stronger than reviewing SQL policy definitions, but **they are not a replacement for a real HTTP/JWT test against two genuine tenants**, as the production project currently has only **one tenant** and no independent second-tenant fixture was provisioned.

| Test context | Action | Observed result | Interpretation |
|---|---|---|---|
| `authenticated`, synthetic UID without any tenant membership | SELECT aggregate counts on `relationship_contacts`, `relationship_organizations`, `relationship_opportunities`, `crm_tasks` | **0, 0, 0, 0** | PASS — no-member context cannot read CRM relationship/task rows |
| `authenticated`, simulated CRM operator UID chosen from existing `crm_user_capabilities` | Same SELECTs | **442, 358, 188, 89** | PASS — positive control: valid user sees authorized tenant CRM records |
| `authenticated`, simulated ordinary tenant member without CRM capability or staff profile | Same SELECTs | **0, 0, 0, 0** | PASS — general tenant membership alone did not grant relationship/CRM task access in this test |
| `anon`, no user claim | SELECT `relationship_contacts`; separately `crm_donor_transactions_v` | **permission denied** | PASS — no anonymous direct SELECT grant |
| `anon`, no user claim | `get_crm_operating_context()` | `authenticated=false`, `crm_role=crm_none`, no tenant returned | PASS — publicly callable context returns no CRM authority or tenant in unauthenticated case |
| `authenticated`, no direct table grant | SELECT on `provider_applicants`, `therapist_outreach_prospects`, `ai_operations_social_publications` | **permission denied** on all three | PASS — protected source tables cannot be queried directly by the authenticated DB role |
| `authenticated`, synthetic nonmember or CRM operator | SELECT `crm_donor_transactions_v` | **0 rows** | INCONCLUSIVE for future row confidentiality: actual view has zero current result rows, so cannot demonstrate or disprove a privilege bypass involving donor transaction contents |

The simulated CRM operator and ordinary member user IDs were selected inside SQL to avoid copying identity values to the audit report. The synthetic no-member UID was an arbitrary UUID. These are controlled database-role simulations, **not real OAuth/PostgREST sessions**. Production tenant count: **1**, memberships: **700**, CRM capability assignments: **17**.

## 2. Confirmed schema/access risks requiring hardening

### Finding S1 — HIGH: Privileged donor transactions view lacks invoker security
- `public.crm_donor_transactions_v` belongs to `postgres` and has **no `security_invoker`** view option. The authenticated role has SELECT, anon does not. The view joins `crm_donors` with `givebutter_donations` on matching contact ID **OR** email; its join does **not constrain the donation and donor tenant IDs to match**.
- Supabase Security Advisor independently lists **`security_definer_view` ERROR (count 1)** on this exact view. Remediation: https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view
- This is a **confirmed unsafe design** for multi-tenant exposure and a likely row-security bypass when matching rows exist. **No actual donor data disclosure was demonstrated** (the view returned 0 rows in the current dataset).
- Proposed fix: inspect all calling code and API consumers; redesign with `security_invoker=true` **AND a tested tenant-safe access pattern** (or revoke direct client SELECT and expose a tightly permissioned RPC). Enforce `d.tenant_id = g.tenant_id` where source schema has compatible tenant attribution; if donation table lacks the column, use a reviewed tenant-safe mapping. Verify in a staging fixture with donor rows in Tenant A and Tenant B. Note `givebutter_donations` currently lacks authenticated SELECT, so **merely flipping the view option can break existing reporting**; test compatibility first. Do not unilaterally alter production view.

### Finding S2 — HIGH: Authenticated-executable idempotency helpers with no tenant authorization
- `public._crm_idempotency_claim(p_key text,p_operation text,p_tenant_id uuid,p_target_id uuid)` and `public._crm_idempotency_record(p_key text,p_operation text,p_result jsonb)` are `SECURITY DEFINER` and **have EXECUTE for authenticated**.
- Read-only inspection of function bodies confirms `_claim` accepts caller-provided tenant/target IDs, then inserts into `public.crm_idempotency_keys` with **no comparison to an authorized tenant or capability**; `_record` updates stored results by caller-specified key and operation without an actor/tenant check. This creates an **authorization/integrity risk** for any clients that can invoke these public functions. We did NOT execute them against live rows because they mutate data.
- Supabase advisor reports the public authenticated-executable SECURITY DEFINER surface. Remediation: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- Proposed fix: identify every SQL/RPC caller, distinguish internal definer-to-definer usage from client RPC calls, revoke direct `authenticated`/`PUBLIC` EXECUTE on internal helper functions where safe, and add explicit tenant/actor checks where any exposure must remain. Prefer `private` schema for internal helpers after careful dependency review. Test application operations and cross-tenant misuse *in staging* before deployment.

### Finding S3 — MEDIUM: Large privileged RPC surface requires scoped review
Supabase Security Advisor returned:
- `anon_security_definer_function_executable`: **16 WARN** (includes intentionally public token-based unsubscribe and context endpoints; not all are vulnerabilities).
- `authenticated_security_definer_function_executable`: **285 WARN** (many legitimately needed protected CRM/clinical operations; treat as a triage queue, not 285 confirmed vulnerabilities).
- `rls_enabled_no_policy`: **118 INFO** (many intentionally service-only or private; zero direct policies also noted for `provider_applicants` and `therapist_outreach_prospects`, which denied direct authenticated access in runtime role simulations).
- `function_search_path_mutable`: **1 WARN**: `private.invalidate_ai_operations_video_downstream_on_title_change`.
- `extension_in_public`: **1 WARN**: `pg_net` in public; migration requires dependency planning.
- `auth_leaked_password_protection`: **1 WARN**, an account/security setting that can be handled separately.

The tokenized `crm_process_newsletter_unsubscribe` function verifies a SHA-256 token hash and expiry before changes, so its anonymous EXECUTE is plausibly intentional; this audit **does not** claim end-to-end abuse prevention/rate limiting was tested.

## 3. What still prevents claiming complete two-tenant end-to-end security verification
1. The connected **production instance has only one tenant**, so no existing Tenant B records are available for an A/B confidentiality test. The nonmember and ordinary-member negative tests do **not** exercise two populated tenant datasets.
2. The tools allowed controlled read-only DB role/JWT-claim simulations but did not provide **two independently authenticated HTTP users and signed JWTs**. Thus PostgREST client, Edge Function request-boundary behavior and actual multi-tenant negative tests remain unexecuted.
3. The donor transactions view currently returns 0 rows. It needs *staging* fixtures with cross-tenant matching IDs/emails to verify the leak and proposed remediation. Do not seed production donor data for this audit.
4. Public SECURITY DEFINER helper integrity failures were detected through code/grant inspection, not by invoking mutating RPCs. Test attempts in a staging database with rollback/test fixtures.
5. No clinical/PHI cross-domain data was extracted; a dedicated least-privilege client/EHR role test remains a release gate for the unified CRM.

**Status of Task 03:** Static code/policy/function/view audit + controlled role-simulation tests are **COMPLETE**. Full **two-tenant signed-JWT / HTTP tests and confirmed fixes are NOT COMPLETE**. Per Task 03's original completion rule, **leave the Todoist task open** until a non-production fixture or two safe independent tenant identities can be used to demonstrate the remaining cross-tenant negative tests. Findings S1/S2 must not be silently waived.

## 4. Independent remediation/action plan
- **Security hardening A:** Replace or restrict `crm_donor_transactions_v` with invoker- and tenant-safe access. Ensure no reporting regression.
- **Security hardening B:** Restrict `_crm_idempotency_claim`/`_crm_idempotency_record` direct RPC execution; audit all call sites, authorization and write integrity; test before migrating.
- **Security hardening C:** Create isolated staging/test tenant fixtures and independently authenticated low-privilege JWT clients. Negative tests for A→B SELECT/INSERT/UPDATE across contacts, orgs, opportunities, tasks, pipeline, donor view, enrollment RPCs, client/PHI, protected staging and social manager APIs.
- **Security hardening D:** Triage remaining Supabase advisor RPC/privilege/search-path findings, concentrating on public functions accepting tenant IDs and writing protected rows.

No schema permissions were modified during this investigation. Document PRs should follow the GitHub branch+PR policy rather than direct commits to main.
