# Social Media Manager — Architecture and Publishing Contract

This is the authoritative description of how the CRM's Social Media Manager publishes
Beyond The Yellow video to YouTube. It supersedes the original implementation plan,
in particular its expectation that scheduled Shorts receive their thumbnail through
`thumbnails.set`.

## Components

| Piece | Location | Role |
| --- | --- | --- |
| Control plane | `supabase/functions/social-media-manager/` | Authenticated CRM API (browser → Edge Function). Tenant-scoped reads and mutations. |
| Publish worker | `supabase/functions/video-youtube-publish-dispatcher/` (`worker.ts`, `index.ts`) | Every minute (pg_cron `video-youtube-publish-dispatcher-1min`): reconciles Scheduled videos, then claims and advances publish jobs. |
| YouTube client and rules | `supabase/functions/_shared/youtube-publish/` | `api.ts` (YouTube Data API calls), `errors.ts` (failure classes), `status.ts` (verification rules), `reconciliation.ts` (Scheduled → Published). Shared by the control plane and the worker. |
| Claim RPCs | `supabase/migrations/20260924120000_social_media_atomic_publish_claim.sql` | `claim_next_youtube_publish_job`, `release_youtube_publish_job`. |
| Queue RPC | `supabase/migrations/20260922190000_social_media_publish_queue.sql` | `social_queue_publish` (approved → upload_queued + one active job). |
| UI | `src/components/crm/social-media/`, `src/lib/crm/social-media.ts` | Library, Publishing Queue, Calendar, Settings, publication editor. |

## Security model

* `authenticate()` resolves the caller's CRM tenant and capabilities with
  `get_crm_operating_context()`; neither is ever read from the request body.
* All handler I/O uses a service-role client, so every handler scopes its own reads
  and writes to `auth.tenantId`. The database triggers are not the authorization
  boundary.
* **Publication creation** proves ownership before the insert
  (`assertSourceOwnedByTenant`): a clip is resolved to its project and the project's
  `tenant_id` must equal the caller's. A foreign, missing or malformed source id gets
  the same "not found in your CRM tenant" answer. The `ai_ops_social_prepare_publication`
  trigger then derives tenant, account, format and defaults.
* **Playlists**: every requested playlist must belong to the caller's tenant, to the
  publication's YouTube account, and be active; otherwise the whole request is rejected
  before any link is written. The worker also skips any legacy link to another account.
* **Actions** are classified in `actions.ts`. View actions (including
  `validate_publication` and `get_youtube_connection_status`) never write. Every
  mutation, including `verify_youtube_connection`, requires `capabilities.mutate`.
* **Readonly UI**: readonly users can browse, inspect publications, history, settings and
  connection state. They are not offered Create Publication (opening the editor on an
  unpublished source would create a draft), and editor fields are disabled.

## Publication state machine

Defined once in `social-media-manager/lifecycle.ts`:

```
draft/ready --approve--> approved --queue--> upload_queued --claim--> uploading
uploading --finalize--> uploaded (Private) | scheduled (publishAt verified) | published
scheduled --YouTube reports Public--> published          (reconciliation only)
approved --metadata edit--> ready
failed (never reached YouTube) --metadata edit--> ready
draft/ready/approved/upload_queued --cancel--> cancelled
upload_queued/uploading --permanent failure--> failed --retry--> approved --queue--> ...
```

* `uploaded`, `scheduled` and `published` are owned by YouTube: the CRM cannot cancel
  them, and only reconciliation moves `scheduled` to `published`.
* A Private immediate upload ends `uploaded` and is shown as "Uploaded / Private". It is
  never labelled Published.
* Every CRM status write after upload is guarded by the expected current status, so
  concurrent writers cannot skip or repeat a transition.

## Publishing flows

| Mode | YouTube upload | Final CRM state | Evidence required |
| --- | --- | --- | --- |
| Private | `privacyStatus=private` | `uploaded` | YouTube reports private + processed |
| Unlisted | `privacyStatus=unlisted` | `published` | YouTube reports unlisted + processed |
| Public now | `privacyStatus=public` | `published` | YouTube reports public + processed |
| Scheduled | `privacyStatus=private`, `publishAt=scheduled_for` | `scheduled`, then `published` via reconciliation | YouTube reports private + matching publishAt; later Public |

`notify_subscribers` is sent as the `notifySubscribers` parameter of `videos.insert`.

### Scheduled Shorts and the manual thumbnail

Scheduled Shorts **intentionally do not use `thumbnails.set`**. On this channel,
API-submitted Shorts thumbnails have not reliably displayed on Shorts surfaces. The only
documented path for a custom Shorts thumbnail is YouTube Studio, and a scheduled video
stays Private until its publish time, which leaves room for that manual step. The
workflow is:

1. The operator saves a cover in the Library. Validation requires one before a Short can
   be scheduled.
2. On approval and queueing, the worker uploads immediately as **Private** with YouTube's
   native `publishAt`.
3. The worker reads the video back. The publication becomes `scheduled` only when YouTube
   reports Private and a `publishAt` within 10 s of the requested instant. It polls for up
   to 5 minutes and otherwise fails.
4. The thumbnail state is set to `manual_required` ("Thumbnail needed" in the UI), with
   links to the saved cover and the YouTube Studio editor.
5. The operator applies the cover in YouTube Studio.
6. The operator clicks **Mark thumbnail done**, which records `manual_confirmed`.
7. YouTube makes the video Public at `publishAt`. The CRM never does this.
8. Reconciliation moves the publication to `published`.

Thumbnail-only jobs (Library "Change photo") for a scheduled Short are completed without
calling `thumbnails.set`. They also never re-run schedule verification, so they are safe
after the video is live.

Immediate Shorts keep the bounded best-effort API thumbnail: the worker waits up to
12 minutes for processing, preserves any thumbnail already present, then calls
`thumbnails.set`. Long-form Parts and Full Episodes use `thumbnails.set` normally. A Full
Episode only ever uses the explicit episode cover (`cover_image_file_id`), never the guest
portrait.

## Atomic job claiming

Each dispatcher invocation advances a job by one step: create the resumable session,
upload one 32 MB chunk, or run a finishing step. A job therefore stays `running` across
many invocations. Claims are leases:

* `claim_next_youtube_publish_job(p_worker_id, p_lease_seconds := 600)` picks one
  eligible job with `FOR UPDATE SKIP LOCKED` and sets `status=running`, `claimed_by`,
  and `claimed_at`. `attempts` is incremented only on `queued → running`. Eligible jobs:
  * `running`/`claimed` with a released lease (`claimed_at is null`) whose publication
    is not waiting (`next_attempt_at` null or past);
  * `running`/`claimed` whose lease is older than 10 minutes (the holder crashed; always
    recovered);
  * `queued` whose publication is not backing off.
  In-flight jobs come before new ones, oldest first.
* The worker releases its lease at the end of every step
  (`release_youtube_publish_job`, fenced on `claimed_by`). Every job write the worker
  makes is also fenced on its lease. A worker that stalls past its lease stops without
  writing (`lease_lost`).
* Taking over a stale lease records `stale_recovery_count` in the job payload and emits
  `publish_worker_recovered`. After more than 3 recoveries the job fails and asks for a
  human check.
* While waiting on YouTube processing or schedule confirmation, the worker sets the
  publication's `next_attempt_at` 2 minutes ahead so the job yields the queue. Each
  invocation advances up to 5 cheap steps (or one media step) within a 25 s budget.

The claim was verified against PostgreSQL 16 with 20 concurrent sessions contending for
one job (exactly one winner) and 10 sessions for 5 jobs (5 distinct winners). The
single-connection claim rules are tested in CI with PGlite
(`src/test/social-media-publish-claim.test.ts`).

## Duplicate-upload guarantees

1. A job is held by exactly one live worker (lease above).
2. The resumable session URL is persisted, fenced on the lease, before any byte is sent.
   Every resume first asks YouTube for the authoritative offset (`bytes */total`).
3. If YouTube reports the session complete, the created video id is taken from that
   response and recorded; the video is never uploaded again. Only when YouTube returns
   no id does the job stop for manual reconciliation.
4. Once `external_video_id` is stored (write guarded by `external_video_id is null`),
   the job only runs finishing steps, so `videos.insert` is unreachable. A retry of a
   failed publication with a video id resumes finishing only. The unique index
   `(account_id, external_video_id)` backs this in the database.
5. `social_queue_publish` and a partial unique index allow one active publish job per
   publication.

## Verification model

YouTube is the authority for every post-upload state. The worker never finalizes from the
upload response alone:

* **Immediate uploads** (`verifyImmediateDelivery`): the privacy must equal the requested
  privacy, and upload/processing must not be rejected, failed, deleted or terminated. A
  privacy mismatch fails the publication; this catches YouTube locking uploads from
  unaudited API projects to Private. Normal processing is polled for up to 60 minutes.
  After that the upload is finalized, with processing recorded as *unconfirmed* and a
  `youtube_processing_unconfirmed` event.
* **Scheduled uploads** (`verifyScheduledDelivery`): Private with a matching `publishAt`,
  as described above.
* Evidence is stored in `platform_payload.youtubeVerification`,
  `platform_payload.youtubeSchedule`, `platform_upload_status` and
  `platform_processing_status`, and shown in the editor's YouTube panel.

## Reconciliation (Scheduled → Published)

`reconcileScheduledPublications` runs at the start of every dispatcher invocation (and
whenever `ai-operations-youtube-sync` runs). It reads due Scheduled videos back with one
batched `videos.list` call (1 quota unit per 50 videos). Due-ness is throttled per
publication: every minute once the publish time has passed, every 30 minutes before it,
and every 15 minutes while an exception is recorded.

| YouTube reports | Result |
| --- | --- |
| Public | `scheduled → published`, with `published_at` from YouTube (or the honoured schedule), event `youtube_publication_reconciled` |
| Private, matching publishAt, before or within 15 min after it | healthy / waiting (no change) |
| Video missing | exception `reconcile_video_missing` |
| Upload rejected | exception `reconcile_upload_rejected` |
| Upload or processing failed | exception `reconcile_processing_failed` |
| Unlisted (or any other privacy) | exception `reconcile_unexpected_privacy` |
| No publishAt, before the time | exception `reconcile_publish_at_missing` |
| publishAt differs from the CRM by more than 10 s | exception `reconcile_publish_at_mismatch` |
| Still Private more than 15 min after the time, or no publishAt after it | exception `reconcile_publish_overdue` |

Exceptions are recorded in `error_code`/`error_message` and
`platform_payload.youtubeReconciliation`, and the status stays `scheduled`. The CRM never
infers publication from the clock. An exception event is written once per distinct code,
and a recovery emits `youtube_reconciliation_cleared`.

## Rescheduling

`reschedule_publication`:

* **Before upload** (draft/ready/approved with no video): CRM-only update. An approved
  publication returns to Ready.
* **After upload** (`scheduled` with `external_video_id`):
  1. The new time must be valid and at least 1 minute in the future.
  2. YouTube must still report the video Private.
  3. `videos.update` is called with the **complete** status part, built from the
     publication by `buildYoutubeStatus`. `videos.update` replaces the whole status, so
     omitting fields would reset them.
  4. The video is read back and verified.
  5. Only a verified `publishAt` is written to `scheduled_for`, with a
     `youtube_rescheduled` audit event (operator in `detail.actorProfileId`).
  6. If YouTube does not confirm, the CRM schedule is unchanged, `error_code =
     reschedule_unverified` is recorded, and the operator is told to check Studio.
* All other states are refused. The UI's Reschedule control shows the current and new
  Central Time and states that YouTube will change too. It does not unlock any other
  metadata.

## Cancellation

A CRM cancel is allowed only while nothing exists on YouTube
(`draft`/`ready`/`approved`/`upload_queued` with no video id). It is guarded against the
worker claiming the job at the same moment. Once a video exists, or while an upload is in
flight, cancellation is refused with instructions to change visibility or delete the video
in YouTube Studio. A CRM row is never marked Cancelled while its video lives on.

## Failure handling

`errors.ts` classifies every failure:

* Retried with exponential backoff (60 s, doubling, capped at 30 min) and never sooner
  than `Retry-After`: HTTP 429, 408, 5xx, network errors and timeouts. The resumable
  session is kept.
* Terminal and shown to the operator: 400 (validation), 401/403 (auth), 404 (not found,
  e.g. a missing Drive file), OAuth refresh failures, blocked Short renders, abnormal
  YouTube states, and more than 8 attempts (`exhausted`).
* A failure in a thumbnail-only or verify-only job never changes the publication's
  status.

## Central Time

All scheduling is in America/Chicago. `centralTimeToUtcIso` re-evaluates the UTC offset
at the candidate instant, so times on DST transition days convert correctly. An ambiguous
fall-back time resolves to its first occurrence. The calendar groups events by their
Central calendar date (`centralDateKey`) and navigates in Central date keys, so the day
cell and the displayed time always agree, whatever the viewer's time zone.

## Tests

| Suite | Covers |
| --- | --- |
| `social-media-tenant-isolation.test.ts` | Cross-tenant clip/project/playlist rejection, account/inactive playlists, browser-supplied tenant fields |
| `social-media-publish-claim.test.ts` | Claim/lease/backoff/stale-recovery/fencing rules against real Postgres (PGlite) |
| `social-media-publish-worker.test.ts` | End-to-end worker runs for Private, Unlisted, Public now, Scheduled Short, Part, Full Episode; overlapping workers; crash recovery; lost final response; retries (429 + Retry-After, 5xx, network), auth/validation/Drive failures, attempt budget; thumbnail-only jobs |
| `social-media-control-plane.test.ts` | Lifecycle matrix, cancellation, rescheduling, readonly authorization, Library selection and routing |
| `social-media-youtube-rules.test.ts` | Immediate verification, reconciliation decisions and pass, error classification, API client |
| `social-media-ui-state.test.tsx`, `social-media-central-time.test.ts` | Readonly UI gating, queue sections, polling, Central Time/DST placement |

## Production end-to-end validation runbook

Run this after deploying the migration and the three functions (`social-media-manager`,
`video-youtube-publish-dispatcher`, `ai-operations-youtube-sync`). Use disposable test
content, and delete every test video from YouTube Studio afterward. After each test,
confirm with a channel search in YouTube Studio that exactly one video exists.

* **A — Private**: publish a test Short as Private. Expect one video with the right
  title, description and playlist, Private on YouTube, CRM `uploaded` with the external
  id and verification evidence.
* **B — Unlisted**: as A with Unlisted. Expect CRM `published` and Unlisted evidence.
* **C — Scheduled Short** (15–30 minutes ahead):
  1. The video uploads immediately.
  2. YouTube reports Private.
  3. `publishAt` equals the requested instant.
  4. The CRM reaches Scheduled only after the `youtube_schedule_verified` event.
  5. The CRM shows "Thumbnail needed".
  6. Apply the cover in Studio.
  7. Click **Mark thumbnail done**.
  8. At publish time YouTube makes the video Public.
  9. Within a minute the CRM shows Published (`youtube_publication_reconciled`).
  10. Exactly one video exists.

  Optionally, reschedule once before publish time and confirm YouTube's time changes.
* **D — Long-form Part**: a rendered `part` clip. Check `content_format=long_form`, the
  rendered Drive file as the source, the Parts playlist, the API thumbnail, metadata and
  final state.
* **E — Full Episode**: check the project source file, the explicit episode cover (never
  the guest portrait), the Full Episodes playlist, metadata and final state.
* **F — Retry/idempotency**: while a Part is mid-upload (after
  `youtube_upload_session_created`), stop the dispatcher cron or let an invocation time
  out. After the 10-minute lease expires, confirm `publish_worker_recovered`, the same
  `upload_session_url` in the job payload, and exactly one YouTube video.
