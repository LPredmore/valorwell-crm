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
