# CRM release testing: full repository CI restored
Date: October 9, 2026

## Confirmed implementation

- [PR #112](https://github.com/LPredmore/valorwell-crm/pull/112) merged `c0cb97957577005edffb546a235d922be59f9a67`: BTY source-native, audited opportunity transitions and staff-contract applicant Contacted→Screening action; protected authorization and campaign trigger safety. Applied staff tenant-guard migration successfully to Billing Hub. The generic CRM board intentionally does NOT permit BTY Ready for Campaign because existing source trigger can activate outreach and does NOT perform applicant first contact or approval/invitation.
- [PR #113](https://github.com/LPredmore/valorwell-crm/pull/113) merged `70d349c1d20438e1c7637e73b47195c9aa45491c`: restores broad project CI without changing active source workflows.
- CI runs for final PR #113 commit `f9b646c72212c44fa1c4de14ce8883420cb8796f`:
  - [Repository Policy](https://github.com/LPredmore/valorwell-crm/actions/runs/37965518689) PASS.
  - [Application CI](https://github.com/LPredmore/valorwell-crm/actions/runs/37965518677) PASS (repository boundary, TypeScript application/tooling, **134 test files and 815 individual tests passed**, production build).
  - [Validate](https://github.com/LPredmore/valorwell-crm/actions/runs/37965518675) PASS (full-source ESLint with zero warnings, TypeScript, tests, build).
  - [CRM Navigation Verification](https://github.com/LPredmore/valorwell-crm/actions/runs/37965518600) PASS (focused navigation tests and build).

## Why the global gate failed and what changed

1. `video-r2-drive-migrator/index.ts` embedded a retired Supabase URL and retired project identifier, triggering repository-boundary policy. The URL now requires explicit HTTPS `LEGACY_R2_VIDEO_EXPORT_URL` runtime configuration. Existing migration ledger: **48 complete, 37 skipped, none pending**; previously complete/skip entries and actual video files unchanged. The optional migration utility will refuse new legacy fetch operations until that environment variable is configured; it must NOT default back to a retired project.
2. `previewAuthStorage.ts` had a `prefer-const` ESLint error; the async timeout closure now uses a stable constant with unchanged behavior.
3. Social-media Short-thumbnail eligibility helper intentionally exports a pure function next to a React component; ESLint warning now has a narrowly scoped documented suppression, with no video publishing behavior altered.
4. Six legacy regression assertions had become stale after CRM sidebar and route architecture changed. Tests now mock unrelated child editors in contact-detail isolation, supply an authorized sidebar capability contract, assert the actual CRM/Operations sidebar navigation and accessibility behavior, and check the canonical `CrmLegacyRouteRedirect` contract rather than the retired direct `Navigate` string. Production sidebar group-toggle labels were disambiguated from the global navigation collapse button. The updated **behavior assertions** passed.

## Live Billing Hub checks

- New `public.crm_staff_tenant_for_applicant_pipeline()` exists, returns UUID, uses restricted staff contract with `SECURITY DEFINER` and empty search path; `authenticated` may execute and `anon` may not. This narrow exception surfaces only the authorized staff tenant UUID. Supabase generic security advisor still warns on authenticated-callable SECURITY DEFINER functions; retain this function under the security review gate.
- Source counts after migration: **35** provider applicants, **188** BTY opportunities, **0** generic/manual pipeline records and stage events. No real applicant/BTY record was modified for testing.

## Still NOT a production-user acceptance test

- **Real signed-JWT HTTP two-tenant matrix** and signed-in browser test with authorized operator/staff/clinical role are outstanding; PGlite role simulation and GitHub CI are necessary, NOT sufficient.
- Actual published frontend/hosting revision not verified through browser.
- Connected Hired Clinicians/Clients remain source-read-only; connected BTY campaign readiness, applicant first contact and approved staff handoff remain in their existing authorized workflows, because there are real side effects.
- The repository is now GREEN at the broad CI/test/build level; separately tracked Supabase advisor findings and controlled E2E user acceptance remain release gates.

Operational follow-up: do not close Todoist phases 19/20/22/26/35/36 until the original full acceptance matrix is fulfilled.
