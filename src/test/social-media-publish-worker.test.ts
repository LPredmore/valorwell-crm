import { describe, expect, it } from 'vitest';
import { httpFailure, MAX_PUBLISH_ATTEMPTS, PermanentYoutubeError, TransientYoutubeError } from '../../supabase/functions/_shared/youtube-publish/errors';
import { markThumbnailManualDone, retryPublication } from '../../supabase/functions/social-media-manager/handlers/publications';
import { MAX_STALE_RECOVERIES, runPublishTicks } from '../../supabase/functions/video-youtube-publish-dispatcher/worker';
import { networkError } from './helpers/fake-youtube';
import { MB, publishHarness } from './helpers/publish-harness';
import {
  PLAYLIST_EPISODES_A, PLAYLIST_OTHER_ACCOUNT_A, PLAYLIST_SHORTS_A,
} from './helpers/social-fixtures';

type PayloadSections = Record<string, Record<string, unknown>>;
const platformPayload = (pub: Record<string, unknown>) => pub.platform_payload as PayloadSections;

describe('YouTube publish worker: privacy modes', () => {
  it('Private: uploads once, verifies YouTube state, attaches the default playlist, ends Uploaded (never Published)', async () => {
    const h = publishHarness();
    const id = await h.prepare('short', 'private');
    await h.drain(id);

    const pub = h.pub(id);
    expect(pub.status).toBe('uploaded');
    expect(pub.published_at ?? null).toBeNull();
    expect(h.youtube.videos.size).toBe(1);
    expect(h.youtube.count('createResumableUploadSession')).toBe(1);
    const video = h.youtube.video();
    expect(pub.external_video_id).toBe(video.id);
    expect(video.status.privacyStatus).toBe('private');
    expect(video.snippet.title).toBe('Short A');
    expect(video.snippet.description).toContain('#bty');
    expect(h.youtube.playlistItems.get('PL-bty_shorts')).toEqual([video.id]);
    expect(pub.platform_upload_status).toBe('processed');
    expect(pub.platform_processing_status).toBe('succeeded');
    expect(platformPayload(pub).youtubeVerification).toMatchObject({ state: 'verified', privacyStatus: 'private' });
    expect(h.jobsFor(id).find((job) => job.job_type === 'publish_youtube')?.status).toBe('complete');
  });

  it('Unlisted: one upload with Unlisted privacy and recorded verification evidence', async () => {
    const h = publishHarness();
    const id = await h.prepare('part', 'unlisted');
    await h.drain(id);
    expect(h.pub(id).status).toBe('published');
    expect(h.youtube.videos.size).toBe(1);
    expect(h.youtube.video().status.privacyStatus).toBe('unlisted');
    expect(platformPayload(h.pub(id)).youtubeVerification.privacyStatus).toBe('unlisted');
    expect(h.youtube.playlistItems.get('PL-bty_parts')).toHaveLength(1);
  });

  it('Public now: publishes, sets published_at from YouTube, and passes notifySubscribers from the publication', async () => {
    const h = publishHarness();
    const id = await h.prepare('short', 'public');
    expect(h.pub(id).notify_subscribers).toBe(false);
    await h.drain(id);
    expect(h.pub(id).status).toBe('published');
    expect(h.pub(id).published_at).toBeTruthy();
    expect(h.youtube.video().status.privacyStatus).toBe('public');
    expect(h.youtube.sessions[0].notifySubscribers).toBe(false);
  });

  it('passes notifySubscribers=true when the publication asks for it', async () => {
    const h = publishHarness();
    const id = await h.prepare('part', 'public', { skipQueue: true });
    h.pub(id).notify_subscribers = true;
    h.pub(id).status = 'approved';
    const { queuePublish } = await import('../../supabase/functions/social-media-manager/handlers/publications');
    await queuePublish(h.auth, { id });
    await h.drain(id);
    expect(h.youtube.sessions[0].notifySubscribers).toBe(true);
  });

  it('Scheduled Short: uploads Private with publishAt, requires the manual thumbnail, and reconciles to Published', async () => {
    const h = publishHarness();
    const scheduledFor = new Date(h.now() + 20 * 60_000).toISOString();
    const id = await h.prepare('short', 'scheduled', { scheduledFor });
    await h.drain(id);

    const pub = h.pub(id);
    const video = h.youtube.video();
    expect(pub.status).toBe('scheduled');
    expect(video.status.privacyStatus).toBe('private');
    expect(video.status.publishAt).toBe(scheduledFor);
    expect(h.youtube.count('setThumbnail')).toBe(0);
    const payload = platformPayload(pub);
    expect(payload.thumbnail.apiStatus).toBe('manual_required');
    expect(payload.youtubeSchedule).toMatchObject({ apiStatus: 'verified', youtubePublishAt: scheduledFor });
    expect(h.eventsFor(id).map((event) => event.event_type)).toContain('youtube_schedule_verified');

    await markThumbnailManualDone(h.auth, { id });
    expect(platformPayload(h.pub(id)).thumbnail.apiStatus).toBe('manual_confirmed');

    // Before publishAt: still Scheduled, even if the clock is close.
    expect((await h.reconcile()).published).toBe(0);
    h.setClock(Date.parse(scheduledFor) + 30_000);
    // The clock passing is not proof: YouTube has not flipped it yet.
    await h.reconcile();
    expect(h.pub(id).status).toBe('scheduled');

    h.youtube.releaseScheduled(h.now());
    h.advance(61_000);
    const summary = await h.reconcile();
    expect(summary.published).toBe(1);
    expect(h.pub(id).status).toBe('published');
    expect(h.pub(id).published_at).toBeTruthy();
    expect(platformPayload(h.pub(id)).thumbnail.apiStatus).toBe('manual_confirmed');
    expect(h.eventsFor(id).map((event) => event.event_type)).toContain('youtube_publication_reconciled');
    expect(h.youtube.videos.size).toBe(1);
  });
});

describe('YouTube publish worker: content formats and playlists', () => {
  it('Long-form Part: uploads the rendered part in chunks, applies its cover via the API, routes to Parts', async () => {
    const h = publishHarness();
    const id = await h.prepare('part', 'public');
    await h.drain(id);
    expect(h.pub(id).content_format).toBe('long_form');
    expect(h.youtube.count('uploadChunk')).toBe(3); // 70 MB in 32 MB chunks
    expect(h.drive.reads.filter((read) => read.fileId === 'drive-part-a')).toHaveLength(3);
    expect(h.youtube.video().thumbnailsSet).toBe(1);
    expect(platformPayload(h.pub(id)).thumbnail.apiStatus).toBe('accepted_unverified');
    expect(h.youtube.playlistItems.get('PL-bty_parts')).toHaveLength(1);
    expect(h.pub(id).status).toBe('published');
  });

  it('Full Episode: uploads the project source file with the explicit episode cover to Full Episodes', async () => {
    const h = publishHarness();
    const id = await h.prepare('episode', 'public');
    await h.drain(id);
    const pub = h.pub(id);
    expect(pub.content_format).toBe('full_episode');
    expect(h.drive.reads.some((read) => read.fileId === 'drive-episode-a')).toBe(true);
    expect(pub.thumbnail_file_id).toBe('drive-cover-episode-a');
    expect(h.youtube.video().thumbnailsSet).toBe(1);
    expect(h.youtube.playlistItems.get('PL-bty_full')).toHaveLength(1);
    expect(pub.status).toBe('published');
    expect(h.db.table('ai_operations_social_publication_playlists').find((link) => link.publication_id === id)?.playlist_id).toBe(PLAYLIST_EPISODES_A);
  });

  it('Full Episode without explicit cover art never falls back to the guest portrait', async () => {
    const h = publishHarness();
    const project = h.db.table('ai_operations_video_projects')[0];
    Object.assign(project, { cover_image_file_id: null, cover_image_url: null, guest_image_url: 'https://drive/guest-portrait' });
    const id = await h.prepare('episode', 'public');
    await h.drain(id);
    expect(h.pub(id).thumbnail_file_id).toBeNull();
    expect(h.youtube.count('setThumbnail')).toBe(0);
    expect(h.pub(id).status).toBe('published');
  });

  it('does not add a video to a playlist that already contains it', async () => {
    const h = publishHarness();
    const id = await h.prepare('short', 'public', { skipQueue: true });
    const { queuePublish } = await import('../../supabase/functions/social-media-manager/handlers/publications');
    await queuePublish(h.auth, { id });
    // Pre-seed: YouTube already lists the next video id in the Shorts playlist.
    h.youtube.playlistItems.set('PL-bty_shorts', ['vid-1']);
    await h.drain(id);
    expect(h.youtube.count('addToPlaylist')).toBe(0);
    expect(h.youtube.playlistItems.get('PL-bty_shorts')).toEqual(['vid-1']);
  });

  it('skips a legacy playlist link that belongs to another YouTube account', async () => {
    const h = publishHarness();
    const id = await h.prepare('short', 'public');
    h.db.table('ai_operations_social_publication_playlists').push({ publication_id: id, playlist_id: PLAYLIST_OTHER_ACCOUNT_A, is_default: false });
    await h.drain(id);
    expect(h.youtube.playlistItems.has('PL-second')).toBe(false);
    expect(h.eventsFor(id).map((event) => event.event_type)).toContain('playlist_skipped');
    expect(h.db.table('ai_operations_social_publication_playlists').some((link) => link.playlist_id === PLAYLIST_SHORTS_A)).toBe(true);
  });
});

describe('YouTube publish worker: immediate verification', () => {
  it('polls bounded while YouTube processes, yielding the queue, then publishes', async () => {
    const h = publishHarness();
    h.youtube.processingOnCreate = 'processing';
    const id = await h.prepare('part', 'public');
    for (let i = 0; i < 6; i += 1) await h.tick();
    expect(h.pub(id).status).toBe('uploading');
    expect(h.pub(id).next_attempt_at).toBeTruthy();
    expect(platformPayload(h.pub(id)).youtubeVerification.state).toBe('wait');

    const video = h.youtube.video();
    video.processingStatus = 'succeeded';
    video.uploadStatus = 'processed';
    await h.drain(id);
    expect(h.pub(id).status).toBe('published');
    expect(h.youtube.videos.size).toBe(1);
  });

  it('never marks a video Published when YouTube locked it Private', async () => {
    const h = publishHarness();
    h.youtube.lockUploadsPrivate = true;
    const id = await h.prepare('part', 'public');
    await h.drain(id);
    expect(h.pub(id).status).toBe('failed');
    expect(String(h.pub(id).error_message)).toContain('kept the video Private');
    expect(h.pub(id).external_video_id).toBe('vid-1');
  });

  it('fails a video whose processing failed without uploading it again', async () => {
    const h = publishHarness();
    h.youtube.processingOnCreate = 'failed';
    const id = await h.prepare('part', 'public');
    await h.drain(id);
    expect(h.pub(id).status).toBe('failed');
    expect(h.youtube.count('createResumableUploadSession')).toBe(1);
  });
});

describe('YouTube publish worker: duplicate prevention', () => {
  it('overlapping workers never claim the same job or open two upload sessions', async () => {
    const h = publishHarness();
    const first = await h.prepare('part', 'public');
    const second = await h.prepare('episode', 'public');
    const results = await Promise.all([
      runPublishTicks(h.deps('worker-a'), { maxJobs: 1 }),
      runPublishTicks(h.deps('worker-b'), { maxJobs: 1 }),
      runPublishTicks(h.deps('worker-c'), { maxJobs: 1 }),
    ]);
    expect(results.flat().filter((result) => result.action === 'idle')).toHaveLength(1);
    expect(h.youtube.sessions).toHaveLength(2);
    await h.drain(first);
    await h.drain(second);
    expect(h.youtube.videos.size).toBe(2);
    expect(h.youtube.count('createResumableUploadSession')).toBe(2);
  });

  it('rejects a second publish job for a publication that already has one', async () => {
    const h = publishHarness();
    const id = await h.prepare('short', 'public');
    const { queuePublish } = await import('../../supabase/functions/social-media-manager/handlers/publications');
    await expect(queuePublish(h.auth, { id })).rejects.toThrow('Invalid publication transition: upload_queued -> upload_queued');
  });

  it('resumes the stored resumable session after a crashed worker instead of opening another', async () => {
    const h = publishHarness();
    const id = await h.prepare('part', 'public');
    await h.tick(); // creates session + uploads chunk 1
    const job = h.jobsFor(id)[0];
    // Simulate the invocation being killed mid-step: the lease is never released.
    Object.assign(job, { claimed_by: 'crashed-worker', claimed_at: new Date(h.now()).toISOString() });

    const blocked = await h.tick();
    expect(blocked.action).toBe('idle');
    h.advance(11 * 60_000);
    await h.drain(id);

    expect(h.youtube.sessions).toHaveLength(1);
    expect(h.youtube.videos.size).toBe(1);
    expect(h.pub(id).status).toBe('published');
    expect(h.eventsFor(id).map((event) => event.event_type)).toContain('publish_worker_recovered');
  });

  it('recovers the video id when YouTube created the video but the final response was lost', async () => {
    const h = publishHarness();
    const id = await h.prepare('short', 'public');
    h.youtube.failNext('uploadChunk', networkError(), { afterEffect: true });
    const lost = await h.tick();
    expect(lost.action).toBe('retry_scheduled');
    expect(h.pub(id).external_video_id ?? null).toBeNull();

    h.advance(10 * 60_000);
    await h.drain(id);
    expect(h.youtube.videos.size).toBe(1);
    expect(h.youtube.count('createResumableUploadSession')).toBe(1);
    expect(h.pub(id).external_video_id).toBe('vid-1');
    expect(h.eventsFor(id).find((event) => event.event_type === 'youtube_video_created')?.detail).toMatchObject({ recoveredFromSession: true });
  });

  it('a retry after the video exists only finishes -- videos.insert is never called again', async () => {
    const h = publishHarness();
    const id = await h.prepare('part', 'public');
    h.youtube.failNext('addToPlaylist', new PermanentYoutubeError('Playlist not found', { status: 404 }));
    await h.drain(id);
    expect(h.pub(id).status).toBe('failed');
    expect(h.pub(id).external_video_id).toBe('vid-1');

    await retryPublication(h.auth, { id });
    await h.drain(id);
    expect(h.pub(id).status).toBe('published');
    expect(h.youtube.count('createResumableUploadSession')).toBe(1);
    expect(h.youtube.count('uploadChunk')).toBe(3);
    expect(h.youtube.videos.size).toBe(1);
  });

  it('gives up after repeated worker crashes and asks for a human check', async () => {
    const h = publishHarness();
    h.drive.files.set('drive-part-a', { size: 900 * MB, mimeType: 'video/mp4' });
    const id = await h.prepare('part', 'public');
    await h.tick();
    const job = h.jobsFor(id)[0];
    for (let i = 0; i <= MAX_STALE_RECOVERIES; i += 1) {
      Object.assign(job, { claimed_by: `crashed-${i}`, claimed_at: new Date(h.now() - 20 * 60_000).toISOString() });
      await h.tick();
    }
    expect(h.pub(id).status).toBe('failed');
    expect(String(h.pub(id).error_message)).toContain('interrupted');
    expect(h.youtube.sessions).toHaveLength(1);
  });
});

describe('YouTube publish worker: failure classification and retry', () => {
  it('retries a 429 honouring Retry-After and resumes the same session', async () => {
    const h = publishHarness();
    const id = await h.prepare('part', 'public');
    await h.tick(); // chunk 1
    h.youtube.failNext('uploadChunk', httpFailure(429, 'quotaExceeded', 45 * 60_000));
    const result = await h.tick();
    expect(result.action).toBe('retry_scheduled');
    expect(result.kind).toBe('rate_limited');
    const retryAt = Date.parse(String(h.pub(id).next_attempt_at));
    expect(retryAt - h.now()).toBeGreaterThanOrEqual(44 * 60_000);
    expect(h.pub(id).status).toBe('uploading');

    h.advance(46 * 60_000);
    await h.drain(id);
    expect(h.pub(id).status).toBe('published');
    expect(h.youtube.sessions).toHaveLength(1);
  });

  it('retries YouTube 5xx and transient network failures', async () => {
    const h = publishHarness();
    const id = await h.prepare('short', 'private');
    h.youtube.failNext('createResumableUploadSession', httpFailure(503, 'backendError'));
    expect((await h.tick()).kind).toBe('server_error');
    h.advance(5 * 60_000);
    h.youtube.failNext('queryUploadOffset', networkError());
    expect((await h.tick()).kind).toBe('server_error');
    h.advance(10 * 60_000);
    await h.drain(id);
    expect(h.pub(id).status).toBe('uploaded');
    expect(h.youtube.videos.size).toBe(1);
  });

  it('treats an authorization failure as terminal and visible', async () => {
    const h = publishHarness();
    const id = await h.prepare('short', 'public');
    h.youtube.failNext('createResumableUploadSession', httpFailure(401, 'Invalid Credentials'));
    await h.tick();
    expect(h.pub(id).status).toBe('failed');
    expect(h.pub(id).error_code).toBe('auth');
    expect(h.pub(id).error_message).toBe('Invalid Credentials');
    expect(h.jobsFor(id)[0].status).toBe('error');
  });

  it('treats an invalid video (400) as terminal', async () => {
    const h = publishHarness();
    const id = await h.prepare('short', 'public');
    h.youtube.failNext('createResumableUploadSession', httpFailure(400, 'invalidTitle'));
    await h.tick();
    expect(h.pub(id).status).toBe('failed');
    expect(h.pub(id).error_code).toBe('validation');
  });

  it('fails permanently when the Drive source is missing and retries a Drive outage', async () => {
    const h = publishHarness();
    const id = await h.prepare('short', 'public');
    h.drive.failNext(httpFailure(503, 'Drive range fetch failed (503).'));
    expect((await h.tick()).action).toBe('retry_scheduled');

    const missing = publishHarness();
    const other = await missing.prepare('part', 'public');
    missing.drive.files.delete('drive-part-a');
    await missing.tick();
    expect(missing.pub(other).status).toBe('failed');
    expect(missing.pub(other).error_code).toBe('not_found');
    expect(h.pub(id).status).toBe('uploading');
  });

  it('stops retrying after the attempt budget is exhausted', async () => {
    const h = publishHarness();
    const id = await h.prepare('short', 'public');
    for (let i = 0; i < MAX_PUBLISH_ATTEMPTS + 2 && h.pub(id).status !== 'failed'; i += 1) {
      h.youtube.failNext('createResumableUploadSession', new TransientYoutubeError('backendError', { status: 500 }));
      await h.tick();
      h.advance(60 * 60_000);
    }
    expect(h.pub(id).status).toBe('failed');
    expect(h.pub(id).error_code).toBe('exhausted');
    expect(Number(h.jobsFor(id)[0].attempts)).toBe(MAX_PUBLISH_ATTEMPTS);
  });

  it('a failed thumbnail-only job never marks a published video as failed', async () => {
    const h = publishHarness();
    const id = await h.prepare('short', 'public');
    await h.drain(id);
    expect(h.pub(id).status).toBe('published');
    h.db.table('ai_operations_video_jobs').push({
      id: 9001, tenant_id: h.pub(id).tenant_id, project_id: h.pub(id).project_id, clip_id: h.pub(id).clip_id,
      job_type: 'publish_youtube', status: 'queued', social_publication_id: id, payload: { thumbnail_only: true }, attempts: 0, created_at: new Date(h.now()).toISOString(),
    });
    h.youtube.failNext('getYoutubeThumbnailStatus', httpFailure(403, 'forbidden'));
    h.drive.failNext(httpFailure(403, 'Drive metadata fetch failed (403).'));
    await h.tick();
    expect(h.pub(id).status).toBe('published');
  });

  it('a thumbnail-only job on a published scheduled Short does not re-verify the schedule or call thumbnails.set', async () => {
    const h = publishHarness();
    const scheduledFor = new Date(h.now() + 20 * 60_000).toISOString();
    const id = await h.prepare('short', 'scheduled', { scheduledFor });
    await h.drain(id);
    h.setClock(Date.parse(scheduledFor) + 60_000);
    h.youtube.releaseScheduled(h.now());
    await h.reconcile();
    expect(h.pub(id).status).toBe('published');

    h.db.table('ai_operations_video_jobs').push({
      id: 9002, tenant_id: h.pub(id).tenant_id, project_id: h.pub(id).project_id, clip_id: h.pub(id).clip_id,
      job_type: 'publish_youtube', status: 'queued', social_publication_id: id, payload: { thumbnail_only: true }, attempts: 0, created_at: new Date(h.now()).toISOString(),
    });
    const result = await h.tick();
    expect(result.action).toBe('scheduled_short_thumbnail_manual');
    expect(h.pub(id).status).toBe('published');
    expect(h.youtube.count('setThumbnail')).toBe(0);
  });

  it('cancelling before the worker starts cancels the job without touching YouTube', async () => {
    const h = publishHarness();
    const id = await h.prepare('short', 'public');
    const { cancelPublication } = await import('../../supabase/functions/social-media-manager/handlers/publications');
    await cancelPublication(h.auth, { id });
    await h.tick();
    expect(h.pub(id).status).toBe('cancelled');
    expect(h.youtube.calls).toHaveLength(0);
    expect(h.jobsFor(id)[0].status).toBe('cancelled');
  });
});
