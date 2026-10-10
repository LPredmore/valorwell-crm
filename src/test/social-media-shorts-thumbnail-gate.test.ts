import { describe, expect, it } from 'vitest';
import { httpFailure } from '../../supabase/functions/_shared/youtube-publish/errors';
import {
  isShortsThumbnailApiEnabled, MAX_SHORT_THUMBNAIL_ATTEMPTS, resolveShortsThumbnailFeature, SHORTS_THUMBNAIL_METADATA_KEY,
  TEST_CONFIRMATION_PREFIX, VISUAL_CONFIRMATION_PHRASE,
} from '../../supabase/functions/_shared/youtube-publish/shorts-thumbnail';
import {
  backfillShortThumbnails, confirmShortsThumbnailVisual, disableShortsThumbnailApi, getShortsThumbnailFeature,
  runShortsThumbnailCompatTest, type ShortsThumbnailClient,
} from '../../supabase/functions/social-media-manager/handlers/shorts-thumbnail';
import { markThumbnailManualDone } from '../../supabase/functions/social-media-manager/handlers/publications';
import { publishHarness } from './helpers/publish-harness';
import { ACCOUNT_A, SHORT_CLIP_A, TENANT_B } from './helpers/social-fixtures';

type H = ReturnType<typeof publishHarness>;
type Payload = Record<string, Record<string, unknown>>;
const thumb = (h: H, id: string) => (h.pub(id).platform_payload as Payload).thumbnail;
const settings = (h: H) => h.db.table('ai_operations_social_settings').find((row) => row.account_id === ACCOUNT_A)!;
const admin = (h: H) => ({ ...h.auth, crmRole: 'crm_admin' });
const operator = (h: H) => ({ ...h.auth, crmRole: 'crm_operator' });

function enableGate(h: H) {
  settings(h).metadata = {
    [SHORTS_THUMBNAIL_METADATA_KEY]: {
      state: 'api_verified', enabledBy: 'admin-user', enabledAt: '2026-10-08T00:00:00Z', enabledFromTestRunId: 'run-1',
      testRuns: [{ id: 'run-1', apiAccepted: true, visualResult: 'confirmed', visualReviewedBy: 'admin-user' }],
    },
  };
}

function fakeClient(over: Partial<Awaited<ReturnType<ShortsThumbnailClient['getVideo']>>> = {}, setError?: Error) {
  const calls = { setThumbnail: 0 };
  const video = { id: 'testVideo01', channelId: 'UC-A', privacyStatus: 'private', publishAt: null, uploadStatus: 'processed', durationSeconds: 30, hasCustomThumbnail: true, ...over };
  const client: ShortsThumbnailClient = {
    getVideo: async () => video,
    getThumbnailStatus: async () => ({
      hasCustomThumbnail: video.hasCustomThumbnail,
      processingStatus: video.uploadStatus,
      thumbnails: null,
    }),
    setThumbnail: async () => { calls.setThumbnail += 1; if (setError) throw setError; },
    fileMetadata: async () => ({ size: 2048, mimeType: 'image/png' }),
    fileBytes: async () => new ArrayBuffer(2048),
  };
  return { client, calls };
}

const testParams = (videoId = 'testVideo01') => ({ videoId, sourceType: 'clip', sourceId: SHORT_CLIP_A, confirmation: TEST_CONFIRMATION_PREFIX + videoId });

async function scheduledShort(h: H) {
  return h.prepare('short', 'scheduled', { scheduledFor: new Date(h.now() + 60 * 60_000).toISOString() });
}

describe('Shorts thumbnail gate', () => {
  it('defaults OFF and stays off for incomplete or merely accepted states', () => {
    expect(resolveShortsThumbnailFeature(null).state).toBe('disabled');
    expect(isShortsThumbnailApiEnabled({})).toBe(false);
    expect(isShortsThumbnailApiEnabled({ [SHORTS_THUMBNAIL_METADATA_KEY]: { state: 'api_verified' } })).toBe(false);
    // HTTP 200 + hasCustomThumbnail without a human visual confirmation is not proof.
    expect(isShortsThumbnailApiEnabled({ [SHORTS_THUMBNAIL_METADATA_KEY]: {
      state: 'api_verified', enabledBy: 'u', enabledFromTestRunId: 'r',
      testRuns: [{ id: 'r', apiAccepted: true, hasCustomThumbnail: true, httpStatus: 200, visualResult: 'pending' }],
    } })).toBe(false);
    expect(isShortsThumbnailApiEnabled({ [SHORTS_THUMBNAIL_METADATA_KEY]: { state: 'testing' } })).toBe(false);
  });

  it('gate OFF: scheduled Short keeps the manual Studio flow and never calls thumbnails.set', async () => {
    const h = publishHarness();
    const id = await scheduledShort(h);
    await h.drain(id);
    expect(h.pub(id).status).toBe('scheduled');
    expect(h.youtube.count('setThumbnail')).toBe(0);
    expect(thumb(h, id).apiStatus).toBe('manual_required');
  });
});

describe('Compatibility test workflow', () => {
  it('requires admin, typed confirmation, and records an accepted test as testing (not enabled)', async () => {
    const h = publishHarness();
    const { client, calls } = fakeClient();
    await expect(runShortsThumbnailCompatTest(operator(h), testParams(), client)).rejects.toThrow('FORBIDDEN');
    await expect(runShortsThumbnailCompatTest(admin(h), { ...testParams(), confirmation: 'yes' }, client)).rejects.toThrow('Type exactly');
    expect(calls.setThumbnail).toBe(0);

    const result = await runShortsThumbnailCompatTest(admin(h), testParams(), client);
    expect(calls.setThumbnail).toBe(1);
    expect(result.run).toMatchObject({ httpStatus: 200, apiAccepted: true, hasCustomThumbnail: true, visualResult: 'pending' });
    expect(result.feature.state).toBe('testing');
    expect(result.feature.automaticUploadsEnabled).toBe(false);
    expect(isShortsThumbnailApiEnabled(settings(h).metadata)).toBe(false);
  });

  it.each([
    [{ channelId: 'UC-OTHER' }, 'not owned'],
    [{ privacyStatus: 'public' }, 'must be Private'],
    [{ publishAt: '2026-12-01T00:00:00Z' }, 'scheduled publish time'],
    [{ durationSeconds: 900 }, 'must be a Short'],
  ])('rejects an ineligible test video %o without writing', async (over, message) => {
    const h = publishHarness();
    const { client, calls } = fakeClient(over);
    await expect(runShortsThumbnailCompatTest(admin(h), testParams(), client)).rejects.toThrow(message);
    expect(calls.setThumbnail).toBe(0);
  });

  it('refuses all CRM-linked videos, even uploaded or manual-confirmed, and rejects other tenants', async () => {
    const h = publishHarness();
    const id = await scheduledShort(h);
    await h.drain(id);
    const videoId = String(h.pub(id).external_video_id).padEnd(11, 'x');
    h.pub(id).external_video_id = videoId;
    const { client, calls } = fakeClient();
    await expect(runShortsThumbnailCompatTest(admin(h), testParams(videoId), client)).rejects.toThrow('linked to a CRM publication');
    h.pub(id).status = 'uploaded';
    await markThumbnailManualDone(h.auth, { id }).catch(() => undefined);
    (h.pub(id).platform_payload as Payload).thumbnail = { apiStatus: 'manual_confirmed' };
    await expect(runShortsThumbnailCompatTest(admin(h), testParams(videoId), client)).rejects.toThrow('linked to a CRM publication');
    h.pub(id).tenant_id = TENANT_B;
    await expect(runShortsThumbnailCompatTest(admin(h), testParams(videoId), client)).rejects.toThrow('does not belong');
    expect(calls.setThumbnail).toBe(0);
  });

  it('cross-tenant cover source is rejected (resolved server-side)', async () => {
    const h = publishHarness();
    const { client } = fakeClient();
    await expect(runShortsThumbnailCompatTest(admin(h), { ...testParams(), sourceId: 'bbbbbbbb-2222-4000-8000-000000000001' }, client)).rejects.toThrow('no saved cover');
  });

  it('a refused API test stays disabled-capable and cannot be confirmed', async () => {
    const h = publishHarness();
    const { client } = fakeClient({}, httpFailure(403, 'forbidden'));
    const { run } = await runShortsThumbnailCompatTest(admin(h), testParams(), client);
    expect(run).toMatchObject({ apiAccepted: false, httpStatus: 403 });
    await expect(confirmShortsThumbnailVisual(admin(h), { testRunId: run.id, result: 'confirmed', confirmation: VISUAL_CONFIRMATION_PHRASE })).rejects.toThrow('did not accept');
  });

  it('only a typed human visual confirmation enables; not_visible and disable turn it off', async () => {
    const h = publishHarness();
    const { client } = fakeClient();
    const { run } = await runShortsThumbnailCompatTest(admin(h), testParams(), client);
    await expect(confirmShortsThumbnailVisual(admin(h), { testRunId: run.id, result: 'confirmed', confirmation: 'ok' })).rejects.toThrow('Type exactly');
    const enabled = await confirmShortsThumbnailVisual(admin(h), { testRunId: run.id, result: 'confirmed', confirmation: VISUAL_CONFIRMATION_PHRASE });
    expect(enabled.automaticUploadsEnabled).toBe(true);
    expect(isShortsThumbnailApiEnabled(settings(h).metadata)).toBe(true);
    expect((await disableShortsThumbnailApi(h.auth)).automaticUploadsEnabled).toBe(false);
    expect((await getShortsThumbnailFeature(h.auth)).state).toBe('disabled');

    const second = await runShortsThumbnailCompatTest(admin(h), testParams(), client);
    const off = await confirmShortsThumbnailVisual(admin(h), { testRunId: second.run.id, result: 'not_visible' });
    expect(off.state).toBe('disabled');
  });
});

describe('Worker with the gate ON (scheduled Shorts)', () => {
  it('uploads the stored cover after native schedule verification, without changing schedule/playlists, and never claims visual proof', async () => {
    const h = publishHarness();
    enableGate(h);
    const scheduledFor = new Date(h.now() + 60 * 60_000).toISOString();
    const id = await h.prepare('short', 'scheduled', { scheduledFor });
    await h.drain(id);
    const video = h.youtube.video();
    expect(h.pub(id).status).toBe('scheduled');
    expect(video.status).toMatchObject({ privacyStatus: 'private', publishAt: scheduledFor });
    expect(h.youtube.count('setThumbnail')).toBe(1);
    expect(h.youtube.count('createResumableUploadSession')).toBe(1);
    expect(thumb(h, id)).toMatchObject({ apiStatus: 'api_confirmed', visuallyVerified: false, idempotencyKey: `${video.id}:drive-cover-short-a` });
    expect(h.youtube.playlistItems.get('PL-bty_shorts')).toEqual([video.id]);
    const types = h.eventsFor(id).map((e) => e.event_type);
    expect(types.indexOf('youtube_schedule_verified')).toBeLessThan(types.indexOf('thumbnail_api_confirmed'));
  });

  it('waits (bounded) for YouTube processing before thumbnails.set', async () => {
    const h = publishHarness();
    enableGate(h);
    h.youtube.processingOnCreate = 'processing';
    const id = await scheduledShort(h);
    for (let i = 0; i < 4; i += 1) await h.tick();
    h.youtube.video().uploadStatus = 'uploaded';
    expect(h.youtube.count('setThumbnail')).toBe(0);
    h.youtube.video().processingStatus = 'succeeded';
    h.youtube.video().uploadStatus = 'processed';
    h.advance(3 * 60_000);
    await h.drain(id);
    expect(h.youtube.count('setThumbnail')).toBe(1);
  });

  it('preserves a pre-existing custom thumbnail', async () => {
    const h = publishHarness();
    enableGate(h);
    const id = await scheduledShort(h);
    const original = h.youtube.uploadChunk.bind(h.youtube);
    h.youtube.uploadChunk = async (...args) => { const r = await original(...args); if (r.done) h.youtube.video(r.videoId).thumbnailsSet = 1; return r; };
    await h.drain(id);
    expect(h.youtube.count('setThumbnail')).toBe(0);
    expect(thumb(h, id).apiStatus).toBe('already_present_not_overwritten');
  });

  it('403 degrades to manual_required with a Studio link; the video is still Scheduled', async () => {
    const h = publishHarness();
    enableGate(h);
    h.youtube.failNext('setThumbnail', httpFailure(403, 'The authenticated user does not have permissions'));
    const id = await scheduledShort(h);
    await h.drain(id);
    expect(h.pub(id).status).toBe('scheduled');
    expect(h.pub(id).error_message ?? null).toBeNull();
    expect(thumb(h, id)).toMatchObject({ apiStatus: 'manual_required', degradedReason: 'api_refused', httpStatus: 403 });
    expect(String(thumb(h, id).studioUrl)).toContain('studio.youtube.com');
  });

  it('429/5xx retry with backoff then succeed; exhausted retries degrade instead of looping', async () => {
    const h = publishHarness();
    enableGate(h);
    h.youtube.failNext('setThumbnail', httpFailure(429, 'rate', 120_000));
    h.youtube.failNext('setThumbnail', httpFailure(503, 'unavailable'));
    const id = await scheduledShort(h);
    await h.drain(id, 80);
    expect(h.youtube.count('setThumbnail')).toBe(3);
    expect(thumb(h, id).apiStatus).toBe('api_confirmed');

    const h2 = publishHarness();
    enableGate(h2);
    for (let i = 0; i < MAX_SHORT_THUMBNAIL_ATTEMPTS + 2; i += 1) h2.youtube.failNext('setThumbnail', httpFailure(500, 'boom'));
    const id2 = await scheduledShort(h2);
    await h2.drain(id2, 120);
    expect(h2.youtube.count('setThumbnail')).toBe(MAX_SHORT_THUMBNAIL_ATTEMPTS);
    expect(thumb(h2, id2)).toMatchObject({ apiStatus: 'manual_required', degradedReason: 'retries_exhausted' });
    expect(h2.pub(id2).status).toBe('scheduled');
  });

  it('is idempotent across restarts: a crash after thumbnails.set does not upload again', async () => {
    const h = publishHarness();
    enableGate(h);
    const original = h.youtube.setThumbnail.bind(h.youtube);
    let crashed = false;
    h.youtube.setThumbnail = async (token: string, videoId: string) => {
      await original(token, videoId);
      if (!crashed) { crashed = true; throw new Error('lost response'); }
    };
    const id = await scheduledShort(h);
    await h.drain(id, 80);
    // second pass recognises its own 'uploading' key + custom thumbnail and records success.
    expect(thumb(h, id)).toMatchObject({ apiStatus: 'api_confirmed', recoveredAfterRestart: true });
    expect(h.youtube.video().thumbnailsSet).toBe(1);
    const before = h.youtube.count('setThumbnail');
    h.db.table('ai_operations_video_jobs').push({
      id: 9100, tenant_id: h.pub(id).tenant_id, project_id: h.pub(id).project_id, clip_id: h.pub(id).clip_id, job_type: 'publish_youtube',
      status: 'queued', social_publication_id: id, payload: { thumbnail_only: true, source: 'operator_backfill' }, attempts: 0, created_at: new Date(h.now()).toISOString(),
    });
    await h.drain(id);
    expect(h.youtube.count('setThumbnail')).toBe(before); // same video+file already applied
  });

  it('never overwrites a manual_confirmed thumbnail from background work, but explicit Change Photo replaces it', async () => {
    const h = publishHarness();
    const id = await scheduledShort(h);
    await h.drain(id); // gate off -> manual_required
    await markThumbnailManualDone(h.auth, { id });
    enableGate(h);
    const push = (jobId: number, source: string) => h.db.table('ai_operations_video_jobs').push({
      id: jobId, tenant_id: h.pub(id).tenant_id, project_id: h.pub(id).project_id, clip_id: h.pub(id).clip_id, job_type: 'publish_youtube',
      status: 'queued', social_publication_id: id, payload: { thumbnail_only: true, source }, attempts: 0, created_at: new Date(h.now()).toISOString(),
    });
    push(9200, 'operator_backfill');
    await h.drain(id);
    expect(h.youtube.count('setThumbnail')).toBe(0);
    expect(thumb(h, id).apiStatus).toBe('manual_confirmed');

    h.pub(id).thumbnail_file_id = 'drive-cover-part-a';
    push(9201, 'crm_library_cover_editor');
    await h.drain(id);
    expect(h.youtube.count('setThumbnail')).toBe(1);
    expect(h.youtube.count('createResumableUploadSession')).toBe(1); // video never re-uploaded
    expect(thumb(h, id).apiStatus).toBe('api_confirmed');
  });

  async function replacementSetup() {
    const h = publishHarness();
    const id = await scheduledShort(h);
    await h.drain(id);
    await markThumbnailManualDone(h.auth, { id });
    enableGate(h);
    h.youtube.video().thumbnailsSet = 1; // OLD custom thumbnail already on YouTube
    h.pub(id).thumbnail_file_id = 'drive-cover-part-a';
    const push = (jobId: number) => h.db.table('ai_operations_video_jobs').push({
      id: jobId, tenant_id: h.pub(id).tenant_id, project_id: h.pub(id).project_id, clip_id: h.pub(id).clip_id, job_type: 'publish_youtube',
      status: 'queued', social_publication_id: id, payload: { thumbnail_only: true, source: 'crm_library_cover_editor' }, attempts: 0, created_at: new Date(h.now()).toISOString(),
    });
    return { h, id, push, key: `${h.youtube.video().id}:drive-cover-part-a` };
  }

  it('Change Photo over an OLD custom thumbnail: 429 after sentKey is retried, never confirmed from the stale flag', async () => {
    const { h, id, push } = await replacementSetup();
    h.youtube.failNext('setThumbnail', httpFailure(429, 'rate', 60_000));
    push(9400);
    await h.tick();
    expect(thumb(h, id)).toMatchObject({ apiStatus: 'retry_pending', sentPriorCustom: true });
    expect(h.youtube.video().thumbnailsSet).toBe(1); // still the old image; hasCustomThumbnail=true
    h.advance(10 * 60_000);
    await h.drain(id, 40);
    expect(h.youtube.count('setThumbnail')).toBe(2);
    expect(h.youtube.video().thumbnailsSet).toBe(2);
    expect(thumb(h, id).recoveredAfterRestart).toBeUndefined();
    expect(thumb(h, id).apiStatus).toBe('api_confirmed');
    expect(h.youtube.count('createResumableUploadSession')).toBe(1);
  });

  it('Change Photo over an OLD custom thumbnail: crash after sentKey but before the request re-attempts the set', async () => {
    const { h, id, push, key } = await replacementSetup();
    const payload = h.pub(id).platform_payload as Payload;
    payload.thumbnail = { ...payload.thumbnail, apiStatus: 'uploading', idempotencyKey: key, sentKey: key, sentPriorCustom: true, attempts: 0 };
    push(9401);
    await h.drain(id, 40);
    expect(h.youtube.count('setThumbnail')).toBe(1);
    expect(thumb(h, id).recoveredAfterRestart).toBeUndefined();
    expect(h.eventsFor(id).map((e) => e.event_type)).not.toContain('thumbnail_api_recovered_after_restart');
  });

  it('legacy sentKey without prior-state evidence is not trusted; background retry still re-sets the same file', async () => {
    const { h, id, key } = await replacementSetup();
    const payload = h.pub(id).platform_payload as Payload;
    payload.thumbnail = { ...payload.thumbnail, apiStatus: 'retry_pending', idempotencyKey: key, sentKey: key, attempts: 1 };
    delete payload.thumbnail.sentPriorCustom;
    h.db.table('ai_operations_video_jobs').push({
      id: 9402, tenant_id: h.pub(id).tenant_id, project_id: h.pub(id).project_id, clip_id: h.pub(id).clip_id, job_type: 'publish_youtube',
      status: 'queued', social_publication_id: id, payload: { thumbnail_only: true, source: 'operator_backfill' }, attempts: 0, created_at: new Date(h.now()).toISOString(),
    });
    await h.drain(id, 40);
    expect(h.youtube.count('setThumbnail')).toBe(1);
    expect(thumb(h, id).apiStatus).not.toBe('already_present_not_overwritten');
  });

  it('Change Photo over an OLD custom thumbnail: 403 degrades to manual without claiming success', async () => {
    const { h, id, push } = await replacementSetup();
    h.youtube.failNext('setThumbnail', httpFailure(403, 'forbidden'));
    push(9403);
    await h.drain(id, 40);
    expect(thumb(h, id)).toMatchObject({ apiStatus: 'manual_required', manualRequired: true, sentPriorCustom: true });
    expect(h.pub(id).status).toBe('scheduled');
  });

  it('thumbnail-only Change Photo with the gate OFF keeps the manual flow', async () => {
    const h = publishHarness();
    const id = await scheduledShort(h);
    await h.drain(id);
    h.db.table('ai_operations_video_jobs').push({
      id: 9300, tenant_id: h.pub(id).tenant_id, project_id: h.pub(id).project_id, clip_id: h.pub(id).clip_id, job_type: 'publish_youtube',
      status: 'queued', social_publication_id: id, payload: { thumbnail_only: true, source: 'crm_library_cover_editor' }, attempts: 0, created_at: new Date(h.now()).toISOString(),
    });
    await h.drain(id);
    expect(h.youtube.count('setThumbnail')).toBe(0);
    expect(thumb(h, id).apiStatus).toBe('manual_required');
  });
});

describe('Opt-in backfill', () => {
  it('requires admin + enabled gate + typed confirmation, and only queues selected manual_required Shorts', async () => {
    const h = publishHarness();
    const id = await scheduledShort(h);
    await h.drain(id);
    await expect(backfillShortThumbnails(admin(h), { publicationIds: [id], confirmation: 'BACKFILL' })).rejects.toThrow('not enabled');
    enableGate(h);
    await expect(backfillShortThumbnails(operator(h), { publicationIds: [id], confirmation: 'BACKFILL' })).rejects.toThrow('FORBIDDEN');
    await expect(backfillShortThumbnails(admin(h), { publicationIds: [id], confirmation: 'no' })).rejects.toThrow('BACKFILL');
    const result = await backfillShortThumbnails(admin(h), { publicationIds: [id], confirmation: 'BACKFILL' });
    expect(result.queued).toEqual([id]);
    const again = await backfillShortThumbnails(admin(h), { publicationIds: [id], confirmation: 'BACKFILL' });
    expect(again.queued).toEqual([]);
    await h.drain(id);
    expect(h.youtube.count('setThumbnail')).toBe(1);
    expect(thumb(h, id).apiStatus).toBe('api_confirmed');
    expect(h.pub(id).status).toBe('scheduled');
  });
});

describe('coverSourceOptions', () => {
  it('lists only clips/episodes with a saved cover, with readable labels', async () => {
    const { coverSourceOptions } = await import('@/lib/crm/social-media');
    const base = { projectId: 'p', clipId: null, description: null, thumbnailUrl: null, guestName: null, durationSeconds: null, sourceFileId: null, sourceFileUrl: null, readiness: { ready: true, reasons: [] }, activePublication: null, publishedPublication: null, failedPublication: null, latestPublication: null, defaultPlaylistName: null };
    const opts = coverSourceOptions([
      { ...base, sourceType: 'clip', sourceId: 'c1', contentFormat: 'short', partNumber: 2, title: 'Hello', thumbnailFileId: 'f1', organizationName: 'Org A' },
      { ...base, sourceType: 'project', sourceId: 'p1', contentFormat: 'full_episode', title: null, thumbnailFileId: 'f2', organizationName: null },
      { ...base, sourceType: 'clip', sourceId: 'c2', contentFormat: 'short', title: 'No cover', thumbnailFileId: null, organizationName: null },
    ] as never);
    expect(opts.map((o) => o.key)).toEqual(['clip:c1', 'project:p1']);
    expect(opts[0]).toMatchObject({ label: 'Hello', detail: 'Org A · Part 2', sourceType: 'clip', sourceId: 'c1' });
    expect(opts[1]).toMatchObject({ label: 'Untitled', detail: 'Episode' });
  });
});
