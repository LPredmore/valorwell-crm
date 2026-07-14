# ValorWell CRM Backend Hardening — July 14, 2026

## Current status

The substantive CRM backend hardening was applied directly to the live Supabase project:

- **Project:** `ahqauomkgflopxgnlndd`
- **Backend contract:** `valorwell-crm-contracts@1.0.1+20260714`
- **Frozen CRM baseline before adoption:** `83afc019d7c094e3943f71ddd8f224dcaf31d07a`

The consolidated SQL in this package reflects the corrected live database state. **It does not need to be pasted into the current production project.** Keep it for source control, staging, disaster recovery, or deliberate drift reconciliation.

The final CRM `backend_contract_releases` record was intentionally **not** created. Release criteria still require cross-tenant identities, external-channel sandbox tests, frontend type adoption, and sibling-application regression tests.

## Database work applied directly

The live project now has:

- Role helpers bound to `auth.uid()`, tenant membership, and authoritative `user_roles`
- Tenant/staff-aware RLS for CRM clients, activity, campaigns, manual reviews, inbound SMS, and role data
- Column-level protection preventing authenticated callers from directly changing canonical state, clinician assignment, or legacy `pat_status`
- A canonical-write guard that recognizes the approved CRM contract engine while preserving registration, intake, scheduling, admin-correction, and service workflows
- Contract-version enforcement using `valorwell-crm-contracts@1.0.1+20260714`
- Exact concurrency-token enforcement; `"auto"` is rejected for ordinary CRM mutations
- Mandatory scoped idempotency with transaction-level advisory locking
- Cached idempotent replay returned before stale-concurrency evaluation
- One private mutation engine behind all nine CRM lifecycle RPCs
- Legal lifecycle-transition adjacency checks
- Manual Review eligibility persistence and canonical-view output
- Atomic canonical audit and activity events
- Expanded activity-event taxonomy for lifecycle, policy, suppression, campaign, clinician, close, and reopen events
- DNC campaign cancellation and a service-only inbound REMOVE command
- Authoritative communication-policy evaluation
- A security-invoker canonical client-state view
- Six corrected security-invoker A2 report views
- Campaign step claim tokens, stale-claim recovery, retry metadata, and safe claim release
- Database support for `suppressed` campaign steps
- Removal of legacy `pat_status` campaign triggers
- Retirement of the ClickUp client-mirror enqueue path
- Lockdown of obsolete direct canonical-state RPCs
- Hardened client-email lookup and campaign-step save utilities
- Fixed search paths on CRM mapping/trigger helpers
- RLS actually enabled on `user_roles`
- Inbound SMS logs no longer directly insertable by authenticated callers

## Edge Functions deployed directly

| Function | Confirmed live version | JWT configuration | Result |
|---|---:|---|---|
| `campaign-scheduler` | 47 | `verify_jwt=false` | Cron-secret protected; tokenized claims, recovery, authoritative suppression, no `pat_status` completion update |
| `ringcentral-sms` | 48 | `verify_jwt=false` | Verified webhook path plus JWT validation for user actions; channel-aware suppression and service-only REMOVE |
| `helpscout-proxy` | 75 | `verify_jwt=false` | Signed webhook path plus JWT validation for user actions; suppression before bulk, create, and reply sends |
| `clickup-sync` | 12 | `verify_jwt=true` | Retired; returns HTTP 410 |

`verify_jwt=false` remains necessary on the three webhook/cron functions because their external webhook or cron paths cannot present a normal Supabase user JWT. Their function bodies perform the applicable signature, secret, or JWT checks.

The packaged `helpscout-proxy.ts` includes an additional tenant-ownership check on `get-conversation`. Deployment of that exact final local delta was blocked by the tool safety layer, so **that single change is packaged but not confirmed live**.

## Live, non-destructive verification completed

No real email or SMS was sent. All state-changing database tests ran inside transactions and were rolled back.

### Authorization and isolation

Verified:

- Admin/staff role resolution succeeds through `user_roles`
- A client role does not gain staff access merely from tenant membership
- Staff can read tenant canonical state
- A client sees only their own canonical row
- A client sees zero CRM activity/report rows
- Protected canonical columns are not directly updateable by authenticated callers
- An ordinary own-profile field update remains permitted
- CRM views grant authenticated `SELECT` only
- `crm_activity_events` grants authenticated `SELECT` only
- CRM idempotency storage has no direct authenticated access
- Legacy canonical writers are not executable by `anon` or ordinary authenticated roles
- Legacy `pat_status` campaign triggers are absent

### Contract behavior

Verified:

- Wrong backend contract version is rejected
- Missing or `"auto"` concurrency token is rejected
- Invalid state input is rejected
- Scoped idempotent replay returns the cached success result even after the original token becomes stale
- The canonical guard accepts an approved CRM mutation and rejects direct bypasses
- Activity-event insertion succeeds through approved RPCs after taxonomy alignment

### Communication policy

Verified:

- DNC blocks ordinary promotional communication
- DNC permits the documented necessary-scheduling class
- Service Blocked denies communication
- A normal, open client permits ordinary communication
- An unsupported channel is denied
- `crm_apply_remove` succeeds in a service-role rollback test

### Scheduler

Verified:

- A due step can be atomically claimed
- A unique claim token is issued
- A claim can be released and rescheduled
- The claim token is cleared on release
- No current `processing` row lacks a claim token
- No current processing claim is stale

### Lifecycle RPC execution

The following public RPCs executed successfully against live schema/guards in rollback-only tests:

1. `crm_transition_lifecycle`
2. `crm_set_engagement`
3. `crm_set_contact_policy`
4. `crm_set_service_policy`
5. `crm_set_eligibility`
6. `crm_set_care_cadence`
7. `crm_close_client`
8. `crm_reopen_client`

`crm_set_engagement` was also replayed with the same idempotency key and original concurrency token; both calls returned `{"ok": true}`.

A live mutation test of `crm_assign_clinician` was attempted, but that specific tool request was blocked by the safety layer. Its deployed signature, permissions, tenant validation, active-staff requirement, protected-column path, and event logic were inspected, but its mutation path remains **unverified rather than assumed**.

## Generated types

Supabase TypeScript type generation completed successfully after the database changes and included the new views/RPCs. The generated output was **not** committed to `LPredmore/valorwell-crm`, and the CRM repository has not yet adopted the new contract version.

## Work still required before release

1. Create controlled synthetic Tenant B identities and execute true cross-tenant JWT/API tests. The live data currently has only one tenant.
2. Execute `crm_assign_clinician` with a controlled same-tenant active clinician and rollback or disposable fixture.
3. Run Help Scout, RingCentral, and scheduler end-to-end tests using sandbox/non-deliverable recipients.
4. Deploy or independently verify the packaged Help Scout `get-conversation` ownership check.
5. Commit equivalent migrations and Edge Function source to the authoritative repository so production and Git do not drift.
6. Regenerate and commit Supabase types in `LPredmore/valorwell-crm`.
7. Change the CRM contract constant to `valorwell-crm-contracts@1.0.1+20260714`.
8. Remove only casts made obsolete by generated types.
9. Run CRM production build, type-check, ESLint, Vitest, and browser smoke tests.
10. Run affected Client, Staff/EMR, Billing, and Onboarding regression smoke tests.
11. Complete and record LV-01 through LV-30.
12. Only then create the CRM `backend_contract_releases` and consumer-adoption records.

The CRM should remain fail-closed for any action whose frontend adapter has not adopted the exact live contract.

## Security-advisor scope

CRM-specific anonymous/direct-write findings addressed during this pass were corrected. The shared Supabase project still has unrelated security and performance advisor findings belonging to sibling applications and older shared functions. This package does not claim that the entire multi-application Supabase project is globally clean.

## Package files

- `valorwell_crm_backend_hardening_20260714.sql` — consolidated final-state SQL already represented in production
- `valorwell_crm_backend_verification_20260714.sql` — catalog checks and rollback-only verification procedures
- `campaign-scheduler.ts` — packaged scheduler source
- `ringcentral-sms.ts` — packaged RingCentral source matching confirmed live v48
- `helpscout-proxy.ts` — packaged Help Scout source, including the final ownership delta not confirmed live
- `suppression.ts` — shared suppression/REMOVE helper
- `SHA256SUMS.txt` — integrity hashes for package contents
