# YouTube release distributor — implementation and operating report

Verified 2026-10-10. Operational project: Billing Hub `ahqauomkgflopxgnlndd`; tenant `00000000-0000-0000-0000-000000000001`. Channel: `UCVcoBzMSzuABGxJ5Ne5EBtw`.

## A. Executive summary

Implemented and deployed the Billing Hub release registry, destination queue, attempt/audit history, scoped worker gateway, original-Drive-video proxy, and n8n monitor/dispatcher/recovery. The current video pipeline belongs to `LPredmore/valorwell-crm`, verified by source inspection. Existing upload, render, schedule and thumbnail code is unchanged.

**New public distribution is OFF.** The monitor and recovery schedules are active. The replacement dispatcher is inactive; global publishing is false; no single-delivery test is authorized; every destination is disabled. Legacy `ytReleaseDist001` remains active, so cutover has NOT happened. There are no competing active publishers.

Live snapshot: 242 registered videos, 206 historically excluded releases, 618 destination records: 597 SKIPPED_BASELINE, 14 FAILED, 4 BLOCKED_AUTH and 3 PUBLISHED. The three PUBLISHED results are imported legacy records, not new tests or independently reverified posts. All 33 legacy destination records were preserved, with 21 historical attempts. No public test posts were made.

## B. Database and deployed gateway

Five migrations are applied and their local versions match production:

- `20261009221348_youtube_release_distributor.sql`
- `20261009221904_distribution_media_leases.sql`
- `20261009222135_distribution_reconciliation_controls.sql`
- `20261009222507_distribution_worker_policies.sql`
- `20261010140140_distribution_live_test_gate_and_metadata.sql`

Tables:

| Table | Purpose |
|---|---|
| `ai_operations_distribution_config` | Tenant/channel configuration, baseline cursor, publishing and single-test gates, worker-token hash |
| `ai_operations_distribution_destinations` | Separate platform/account identities, enablement and credential verification |
| `ai_operations_youtube_release_registry` | Channel-wide visibility, classification, CRM source links, duration, baseline and exclusions |
| `ai_operations_distribution_overrides` | Explicit platform copy, classification and Drive-file overrides |
| `ai_operations_social_distribution_deliveries` | Unique tenant/video/destination job, content snapshot, lease, result |
| `ai_operations_social_distribution_attempts` | Each claimed attempt and sanitized outcome |
| `ai_operations_distribution_events` | Durable status transitions |
| `ai_operations_distribution_media_leases` | Expiring, file-specific private-media capability hashes |

RPCs: `distribution_observe`, `distribution_prepare`, `distribution_claim`, `distribution_begin_request`, `distribution_finish`, `distribution_recover`, `distribution_confirm_existing`. Trigger functions: `distribution_request_verification`, `distribution_record_transition`. Triggers: `distribution_publication_signal` on publication insert/ID/status/privacy changes; `distribution_transition_history` on delivery insert/status changes.

Explicit indexes: `youtube_release_check_idx`, `youtube_release_publication_idx`, `youtube_release_clip_idx`, `youtube_release_project_idx`, `distribution_overrides_release_idx`, `social_distribution_queue_idx`, `social_distribution_stale_idx`, `social_distribution_release_idx`, `social_distribution_destination_idx`, `social_distribution_attempt_history_idx`, `distribution_media_delivery_idx`, `distribution_media_expiry_idx`, `distribution_events_history_idx`, `distribution_test_delivery_idx`. Primary/unique indexes additionally enforce release tenant/video identity, destination tenant/platform/account identity, delivery tenant/video/destination identity, attempt delivery/number identity, and composite tenant foreign keys. Exact definitions are in the migrations.

All eight tables have RLS. Tenant-admin SELECT policies reuse `is_tenant_admin`; config and media leases are service-only. Anonymous/authenticated clients cannot execute worker RPCs or mutate these tables. RPCs use SECURITY INVOKER. The gateway receives the service key only from its existing server environment; n8n receives a dedicated, tenant-bound worker credential, not a database key. No raw platform response, credential, signed media URL or header is persisted in attempt logs.

`release-distributor` Edge Function version 3 is deployed. Bundle hash: `9b53f6bbddf60c2a012a9fd3024b408cb03b708864193f0ae013f174a4c2adf1`. JWT verification is intentionally disabled because POST uses the scoped `x-distribution-token` credential and GET/HEAD uses an expiring random media capability. Actions are allowlisted; arbitrary SQL/RPC forwarding is unavailable.

Claims lock with SKIP LOCKED, use 15-minute leases, require recently verified Public visibility, and allocate one attempt. A one-time database fence and fresh YouTube read precede each public publishing request. Crashes before the fence can retry; uncertain outcomes after it require review. Explicit 429 rejections use bounded exponential backoff, maximum five attempts. Successful destinations remain immutable across repeated events/privacy changes.

The initial authenticated baseline completed at `2026-10-09T22:17:29.668Z`. Public historical videos remain excluded even after privacy changes. An approved test can target exactly one existing delivery while global publishing stays off; this gate currently has no selection.

Advisors: no new-object security findings and no unindexed foreign-key findings. Nine informational unused-index notices are expected while the new queue is inactive; retain the concurrency/history indexes. [Supabase unused-index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). Existing unrelated project findings were not changed or represented as resolved.

## C. n8n deployment

| Workflow | ID | Live state | Triggers |
|---|---|---|---|
| YouTube Release Monitor - Billing Hub | `ytReleaseMonitor002` | Active | Every five minutes; manual; secured wakeup |
| Social Delivery Dispatcher - Billing Hub | `ytSocialDispatcher002` | Inactive | One-minute schedule when enabled; manual; secured wakeup |
| Delivery Reconciliation - Billing Hub | `ytDeliveryRecovery002` | Active | Every five minutes; manual |
| Release Distributor - Read Only Preflight | `ytDistributorPreflight002` | Inactive/manual | Manual only |
| YouTube Release Distributor - LinkedIn + Facebook | `ytReleaseDist001` | Active legacy | Existing 15-minute schedule |
| TEST ONLY - Distributor Mock Routes | `ytDistributorMockTest` | Inactive | Loopback-only test fixture; no real credentials |

Exports in `n8n/` are deliberately inactive for safe import. `scripts/build-distributor-workflows.mjs` generates them. Final exports were imported before enabling the monitor/recovery schedules and restarting n8n. Success/error/manual execution payload saving is disabled on the new production workflows. Automatic HTTP publishing retries are disabled.

The monitor verifies the authenticated owner channel, polls the newest uploads plus persisted internal and older known IDs, batches videos.list calls, and performs an incremental hourly full inventory. Known private/scheduled videos remain candidates. Internal publication triggers persist verification requests without altering the uploading pipeline. The last direct integration run observed 239 available videos, including non-public inventory.

Facebook sends the stored Facebook description and YouTube link to the Page feed. LinkedIn uses separate organization/personal destinations, stored LinkedIn description, article URL/title, and a thumbnail uploaded through the image API. Instagram requires confirmed Shorts, uses the original private Drive MP4, creates a Reel container, persists its ID, polls at 15-second intervals up to 36 checks, fences the final publish, then retrieves its permalink. It does not upload YouTube downloads or thumbnails as video.

The media proxy validates MP4 metadata, 3–180 second duration, square/portrait shape, and size up to 1 GB, and supports range reads. Its random, file-specific URL expires after 24 hours. Drive sharing permissions are unchanged. External Meta fetching and actual media acceptance remain unverified.

Unmatched videos are retained. Duration over 180 seconds can rule out Shorts; shorter duration alone never establishes a Short. Missing/ambiguous classification needs review. No generic marketing copy is invented. Project-level videos without clip IDs use explicit override copy. Missing media/copy blocks only the affected destination.

## D. Platform connectivity

| Platform | Actual read-only result | Remaining proof |
|---|---|---|
| YouTube | Authenticated owner channel/inventory/visibility calls succeeded | A new scheduled transition has not been created as a live test |
| Google Drive | Original MP4 metadata read: 28,528,276 bytes, 70.799 seconds, 1080×1920 | Meta asynchronous fetch and acceptance |
| Facebook Page `119382491255956` | Existing `Facebook - ValorWell Page` credential returned HTTP 401, Meta code 190; expiry September 1, 2026 | Renew credential; verify Page publishing permissions; approved public post |
| LinkedIn organization `98694960` | Existing `LinkedIn - ValorWell Publisher` credential returned HTTP 200 for organization read | Write permission and approved post |
| LinkedIn personal `CfHqw9H6zg` | Destination identity preserved, disabled | Personal account permission/read/write checks if requested |
| Instagram | No verified account ID or connected account; route implemented and mocked | Identify professional account, renew Meta credential, verify publishing permissions, approved Reel |

Credential references are reused in n8n. No replacement platform token was fabricated and no token should be pasted into chat or committed.

## E. Verification and evidence

`docs/distributor-evidence/` contains sanitized production checks, isolated database results, five executed n8n mock routes, and the legacy snapshot/import. Mocks stripped real credentials and redirected every HTTP node to a container-local fake server; no third-party publishing endpoint was called.

| Acceptance case | Result and evidence type |
|---|---|
| 1. Public Short creates destination jobs | PASS, isolated SQL |
| 2. Long video excludes Instagram | PASS, isolated SQL |
| 3. First Private → Public queues | PASS, isolated SQL; production authenticated private reads also passed |
| 4. Scheduled release after Public | Shared visibility transition covered synthetically; actual timed YouTube transition NOT TESTED |
| 5. Manual upload independent of CRM | PASS, unmatched-video SQL; live channel inventory independent of CRM |
| 6. Videos outside the original playlist | PASS, owner-channel inventory with no playlist filter |
| 7. Platform-specific descriptions | PASS, SQL lookup and mock request routes |
| 8. Project episode without clip ID | PASS, SQL classification/override path |
| 9. Unknown video retained | PASS, SQL NEEDS_COPY/NEEDS_REVIEW |
| 10. Missing Instagram media independent | PASS, SQL NEEDS_MEDIA with Facebook still pending |
| 11. Missing LinkedIn copy independent | PASS, SQL NEEDS_COPY with Facebook still pending |
| 12. Repeated notifications | PASS, SQL unique jobs and send fence |
| 13. Concurrent claims | PASS, two actual Postgres sessions held locks and claimed distinct jobs |
| 14. Independent failure recovery | PASS, safe expired-lease retry and HTTP 429 mock |
| 15. Successful destination preserved | PASS, idempotent finish and replay SQL |
| 16. Repeated privacy transition | PASS, published row preserved in SQL |
| 17. Historical baseline exclusion | PASS, SQL and production baseline/import |
| 18. Interrupted workflows | PASS, SQL before-send retry / after-send NEEDS_REVIEW; HTTP 500 mock held for review |
| 19. Post result/URL persistence | PASS, SQL and FB/LI/IG mock routes; real publishing NOT TESTED |
| 20. Media/auth security | PASS, SQL privileges and private Drive metadata read; real Meta URL fetch/streaming NOT TESTED |

Five actual n8n mock executions passed: Facebook, LinkedIn and Instagram success, Facebook 429 safe retry, Facebook 500 ambiguous review. Each scenario made exactly one mocked public-send request; the Reel scenario completed the container/poll/publish route. Static graph checks cover references, disabled export activation, credential separation, retry configuration, proof classification and bounded polling.

Repository validation: 135 test files / 817 tests passed; application lint and both TypeScript projects passed; new Edge Function lint and Deno 2.5.4 check passed; production build passed with the existing large-chunk advisory. Independent database tests use PostgreSQL 16.14 and an isolated temporary database, never Billing Hub writes. Required GitHub checks are recorded on the implementation PR.

## F. GitHub

Repository: `https://github.com/LPredmore/valorwell-crm`. Branch: `codex/youtube-release-distributor`, based on current main `8f1c483`. Implementation PR and final merge evidence are recorded in the PR and final delivery message. This document does not imply a merge before GitHub confirms it.

The deployed migrations, gateway source, importable workflows, generators, test scripts and this report are versioned together. No existing upload/render/thumbnail implementation was edited.

## G. Outstanding blockers and limits

1. Facebook credential is expired. Renew it inside n8n and verify the Page permissions.
2. Instagram professional account ID and publishing permissions are missing. Register a verified destination only after those are known.
3. No exact public test content/destinations have been approved. Obtain approval, execute a single gated delivery, inspect the actual public result, and retain its URL before enabling production publishing.
4. n8n exposes only localhost. Secured webhook nodes exist, but a reachable HTTPS callback is needed for Billing Hub wakeups and a verified YouTube WebSub subscription. Neither outbound wakeup nor WebSub subscription is connected. Active polling is the current delivery-independent detection path; internal signals are acted on at the next poll, not instantaneously.
5. Legacy-to-new publisher cutover remains pending. Resnapshot legacy state immediately before cutover, then disable legacy before testing/enabling the replacement.
6. Meta's real asynchronous media fetch and LinkedIn write permission require production verification. Synthetic success is not that proof.
7. Ambiguous requests with no returned external ID require manual platform inspection; recovery never guesses that the post failed and resends it. Unknown short-duration uploads require classification review. There is no new management UI; use tenant-admin reads and authorized administrative operations.

Optional later improvements: dedicated management UI, proactive error notifications, and higher-throughput batching. None is used to bypass the above activation blockers.

## H. Operating instructions

### Inspect and verify

Open `http://localhost:5678/workflow/ytReleaseMonitor002` and run the monitor manually to refresh channel visibility. Or run `node scripts/run-distributor-workflow.mjs ytReleaseMonitor002` from this repository; output is sanitized. Run `ytDistributorPreflight002` with the same helper for read-only connectivity. The helper refuses a dispatcher test if global publishing or a test-delivery selection is enabled.

Use Billing Hub's SQL editor with authorized admin access (never place its service key in n8n):

```sql
select youtube_video_id,title,classification,visibility,baseline_excluded,last_checked_at
from public.ai_operations_youtube_release_registry
where tenant_id='00000000-0000-0000-0000-000000000001'
order by last_checked_at desc;

select id,youtube_video_id,platform,destination_id,status,attempt_count,
       external_post_id,external_post_url,last_error,next_retry_at
from public.ai_operations_social_distribution_deliveries
where tenant_id='00000000-0000-0000-0000-000000000001'
order by updated_at desc;
```

Inspect `ai_operations_social_distribution_attempts` and `ai_operations_distribution_events` by delivery ID for attempt and transition history. Avoid selecting the worker-token hash or media leases into shared reports.

### Resolve and retry one destination

Fix source clip metadata or add an explicit `ai_operations_distribution_overrides` row for the release. `distribution_prepare(tenant_uuid,release_uuid)` refreshes only unattempted jobs; the recovery schedule also prepares eligible Public releases. A project-level video needs explicit platform copy when no clip description exists. Confirm Shorts classification before adding an Instagram override.

After repairing credentials, verify them and update the matching destination's `credential_verified_at`; do not enable unverified destinations. Unattempted blocked jobs can be prepared again. Previously attempted BLOCKED_AUTH/FAILED/NEEDS_MEDIA jobs require an operator to inspect attempt history and establish a definitive non-publication before moving that one delivery to RETRY_WAIT with `next_retry_at=now()`. Preserve attempt count/history, baseline/exclusion flags and external IDs. Do not reset PUBLISHED or blindly reset NEEDS_REVIEW. For an uncertain result, locate/verify the actual platform post, attach its exact ID if needed, and use `distribution_confirm_existing` to confirm it without sending again. If non-publication cannot be established, leave it for review.

### Approved test and cutover

Keep `publishing_enabled=false`. Refresh preflight and monitor. Disable legacy `ytReleaseDist001`, then run `node scripts/snapshot-legacy-distributor.mjs` and apply its generated `docs/distributor-evidence/import-legacy.sql` in Billing Hub; the idempotent import preserves known legacy results. Retain the existing data table.

Record explicit approval for the exact video, copy and account. Choose one delivery, enable/verify only that approved destination, set config `test_delivery_id` and a nonempty `test_approval_reference`, and prepare only that reviewed delivery. Historical tests require deliberately changing that selected SKIPPED_BASELINE delivery to PENDING; keep its registry baseline exclusion. Never reset a previously successful delivery to reuse it for a test. Manually execute the dispatcher once from n8n (the non-public helper intentionally refuses this). Inspect and record the actual public ID/permalink, then clear both test fields. Repeat only for separately approved destinations.

After all required live tests and preflight checks pass, verify legacy is inactive, select intended enabled destinations, set `publishing_enabled=true`, and activate the replacement dispatcher. Review queued releases accumulated since the baseline before enabling; explicitly exclude any that should not post. Never clear baseline exclusions in bulk. Monitor and recovery stay active.

### Suspend, resume and rollback

For an immediate stop, set `publishing_enabled=false` AND clear `test_delivery_id`/`test_approval_reference`, then deactivate the dispatcher. The send fence rechecks the gate, although a request already in flight cannot be recalled. Leave monitor/recovery active. Resume only after resolving the cause, inspecting ambiguous jobs, and confirming legacy is still inactive.

The legacy export is saved at `C:\Users\predm\OneDrive\Documents\Database Migration\ytReleaseDist001-before-20261009.json`; its original workflow/data table remain intact. Before any rollback to legacy, stop the new dispatcher and reconcile every new successful delivery into legacy deduplication state; otherwise legacy could repost. Never run both publishers. Retain all registry, delivery and attempt history; do not roll back by dropping tables.

### Reproduce non-public checks

- `node scripts/test-distributor-workflows.mjs`
- `node scripts/test-release-distributor.mjs` (isolated PostgreSQL container `valorwell-distributor-test`)
- `node scripts/test-n8n-distributor-routes.mjs` (inactive, loopback-only n8n fixture)
- `npm test`, `npm run build`, app/tooling TypeScript checks and repository lint

Do not rerun credential provisioning unless intentionally rotating the worker token in both n8n and Billing Hub. The temporary media URLs and credentials must not be logged or committed.
