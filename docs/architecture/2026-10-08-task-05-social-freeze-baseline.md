# CRM Modernization — Task 05: Social Media freeze, publishing dependency map and read-only baseline

**Baseline date:** 2026-10-08. **System:** existing ValorWell CRM and Billing Hub project `ahqauomkgflopxgnlndd`. **No code, queue, cron, OAuth, database row, thumbnail, or scheduled publication changed.** Social Media must stay in production in the old CRM (separate sidebar category) until new Flurra is independently validated and explicitly approved for cutover.

## Current UI contract
- Route: `/crm/social-media` in `src/App.tsx`.
- Page: `src/pages/crm/SocialMediaManagerPage.tsx`; uses `fetchSocialMediaBootstrap` for connection/auth/tenant/capability preflight; provides tabs **Library**, **Publishing Queue**, **Calendar**, **Settings**, and **Schedule Series** dialog.
- Component group: `src/components/crm/social-media/`; API client `src/lib/crm/social-media.ts`.
- New sidebar should provide a dedicated collapse/expand **SOCIAL MEDIA** section, NOT hide the existing page. Deep-linking to tabs is acceptable only if initial/default/old links and authentication work unchanged.

## Publishing control and worker dependency map
| Layer | Current owner | Do not change in CRM navigation refactor |
|---|---|---|
| Authenticated control plane | `supabase/functions/social-media-manager/` | Tenant/capability preflight; source/playlist ownership checks; publication create/edit/approve/queue |
| Scheduling/claim/send | `supabase/functions/video-youtube-publish-dispatcher/` | Claim/release RPCs, lease fencing, publish/retry reconciliation |
| YouTube API and rules | `supabase/functions/_shared/youtube-publish/` | Resumable upload and verification; thumbnail/Short behavior version-dependent |
| Publication persistence | `ai_operations_social_publications`, social accounts/playlists, publication events/links | Status history, external video ID, source refs and scheduled_for |
| Source media | `ai_operations_video_projects`, `ai_operations_video_clips`, rendering/R2 assets | Media identity and ownership; production jobs reference these |
| Scheduling runner | `cron.job`: `video-youtube-publish-dispatcher-1min` | Every minute, active; do not duplicate worker ownership with Flurra |
| Other connected platform actions | Existing account and settings/automations | Preserve existing behavior and permissions; no platform switch |

Authoritative prior design: `docs/social-media-manager-architecture.md`. Some Shorts thumbnail guidance there was superseded by more recent changes; **inspect current worker/code and test with actual supported YouTube behavior before treating old documentation as final**.

## Current production read-only evidence
- `ai_operations_social_publications`: **79** total, consisting of 43 published, 7 scheduled, 12 draft, 16 cancelled, 1 approved. `ai_operations_social_publication_events`: **691** rows.
- Other social entities: one social account, three playlists, 79 publication↔playlist associations and settings/routing data.
- Scheduled items had `scheduled_for` dates between **2026-10-08 17:00 UTC** and **2026-10-09 20:00 UTC** in the inspected snapshot. **Never infer these have been or will be successfully published just because the scheduler ran.**
- A single `approved` publication has a recorded `scheduled_for` of **2026-09-24 20:00 UTC**. It predates the audit and deserves a follow-up status inspection (could be intentionally not queued or stale). No action taken.
- `video-youtube-publish-dispatcher-1min` is active with `* * * * *` schedule. Recent `cron.job_run_details` rows from 2026-10-08 show `succeeded` invocations, including timestamps near **16:20 UTC**. **This verifies invocation only.** It does not establish the result of each Edge Function execution, job claim, YouTube upload, thumbnail, external processing, or content-publication transition.
- Table RLS for `ai_operations_social_publications` is enabled, with `service_role` policy; the control plane therefore remains a critical tenant-scope enforcement boundary.

## Safe baseline test cases (for Task 08 and every later deployment)
1. Signed-in authorized user reaches `/crm/social-media` in existing sidebar location, then in new distinct category after Task 08. Authentication/tenant capability resolves correctly, and role-limited users cannot mutate.
2. Library loads and shows same source content, cover art, draft/ready state and actions.
3. Queue loads and shows same statuses/IDs/next scheduled times; no duplicate publish job created by read-only navigation.
4. Calendar reflects existing scheduled publication times with same timezone interpretation and links.
5. Settings displays current account/playlist connection read-only; no OAuth reauthorization triggered by menu changes.
6. Schedule Series dialog opens and existing schedules are preserved; do not submit new schedules during navigation smoke tests.
7. Record count and state reconciliation before/after new menu deployment; compare the same snapshot/time window to account for legitimate worker transitions.
8. Confirm dispatcher still scheduled once per minute, job-run details healthy, and no second Flurra worker claims same queue.
9. Confirm existing video thumbnail and external publication links still render. Shorts vs long-form thumbnail behavior must be verified against current worker and YouTube UI; do not use obsolete documentation as source.
10. Check error states, reloads, nested routes, mobile, menu collapse, user role, scheduled upload and pending retries without modifying live jobs.

## Flurra cutover — independent release gate, not part of CRM refactor
- Flurra is a **separate multi-tenant commercial social application**, not another CRM subsection.
- No production cutover until parity coverage includes tenant auth/RLS, social accounts, media library and R2/object identity, queues/claim tokens, scheduled videos, series scheduling, Shorts/long-form cover behavior, external publication IDs, history, OAuth, errors/retries, cron reconciliation and human rollback.
- Compare live records and asset availability, migrate or bridge only after explicit approval. Avoid simultaneous job claiming and double-posting.
- Until then, keep the current Social Media menu and all current runtime integrations intact; do not drop tables or disable workers.

## Baseline audit result
**PASS — Read-only baseline captured:** component/route/runtime inventory, publication count/status snapshot, schedule ranges, pg_cron schedule and recent run evidence. **NOT EXECUTED:** credentialed UI smoke tests, actual YouTube verification, Flurra parity, thumbnail test upload, error injection or job retry. These are mandatory future execution gates in Tasks 08, 35 and 37. Baseline is not a certification that live publishing succeeds for every item.
