import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildYoutubeStatus, createResumableUploadSession, isVideoInPlaylist, queryUploadOffset, uploadChunk, type YoutubeDeliveryStatus,
} from '../../supabase/functions/_shared/youtube-publish/api';
import {
  classifyPublishFailure, httpFailure, MAX_PUBLISH_ATTEMPTS, parseRetryAfter, PermanentYoutubeError, retryDelayMs, TransientYoutubeError,
} from '../../supabase/functions/_shared/youtube-publish/errors';
import {
  decideReconciliation, EXCEPTION_RECHECK_MS, reconciliationDue, UPCOMING_RECHECK_MS,
} from '../../supabase/functions/_shared/youtube-publish/reconciliation';
import { verifyImmediateDelivery } from '../../supabase/functions/_shared/youtube-publish/status';
import { publishHarness } from './helpers/publish-harness';

const status = (overrides: Partial<YoutubeDeliveryStatus> = {}): YoutubeDeliveryStatus => ({
  privacyStatus: 'private', publishAt: null, uploadStatus: 'processed', processingStatus: 'succeeded',
  rejectionReason: null, failureReason: null, publishedAt: null, ...overrides,
});

describe('immediate upload verification', () => {
  const uploadedAt = '2026-09-24T12:00:00.000Z';
  const at = (minutes: number) => Date.parse(uploadedAt) + minutes * 60_000;

  it('verifies a processed upload with the requested privacy', () => {
    expect(verifyImmediateDelivery(status({ privacyStatus: 'public' }), 'public', uploadedAt, at(1))).toEqual({ state: 'verified' });
    expect(verifyImmediateDelivery(status({ privacyStatus: 'unlisted' }), 'unlisted', uploadedAt, at(1)).state).toBe('verified');
  });

  it('waits for normal processing, then finalizes as unconfirmed after the bound', () => {
    const processing = status({ privacyStatus: 'public', uploadStatus: 'uploaded', processingStatus: 'processing' });
    expect(verifyImmediateDelivery(processing, 'public', uploadedAt, at(30)).state).toBe('wait');
    expect(verifyImmediateDelivery(processing, 'public', uploadedAt, at(61)).state).toBe('unconfirmed');
  });

  it.each([
    [status({ uploadStatus: 'rejected', rejectionReason: 'duplicate' }), 'duplicate'],
    [status({ uploadStatus: 'failed', failureReason: 'codec' }), 'codec'],
    [status({ processingStatus: 'failed' }), 'processing status "failed"'],
    [status({ privacyStatus: 'private' }), 'kept the video Private'],
  ])('fails abnormal states: %#', (actual, reason) => {
    const decision = verifyImmediateDelivery({ ...actual, privacyStatus: actual.privacyStatus }, 'public', uploadedAt, at(1));
    expect(decision.state).toBe('failed');
    expect('reason' in decision && decision.reason).toContain(reason);
  });
});

describe('scheduled reconciliation decisions', () => {
  const scheduledFor = '2026-09-24T18:00:00.000Z';
  const pub = { scheduled_for: scheduledFor, platform_payload: {} };
  const before = Date.parse(scheduledFor) - 10 * 60_000;
  const after = (minutes: number) => Date.parse(scheduledFor) + minutes * 60_000;

  it('publishes only when YouTube reports Public, taking the publish time from YouTube', () => {
    expect(decideReconciliation(pub, status({ privacyStatus: 'public', publishedAt: '2026-09-24T18:00:03.000Z' }), after(2)))
      .toEqual({ action: 'publish', publishedAt: '2026-09-24T18:00:03.000Z' });
    // An upload-time publishedAt is not the publication time: fall back to the honoured schedule.
    expect(decideReconciliation(pub, status({ privacyStatus: 'public', publishedAt: '2026-09-23T10:00:00.000Z' }), after(2)))
      .toEqual({ action: 'publish', publishedAt: scheduledFor });
  });

  it('is healthy before the publish time and waiting just after it', () => {
    expect(decideReconciliation(pub, status({ publishAt: scheduledFor }), before)).toEqual({ action: 'healthy', state: 'healthy' });
    expect(decideReconciliation(pub, status({ publishAt: scheduledFor }), after(5))).toEqual({ action: 'healthy', state: 'waiting' });
  });

  it.each([
    ['deleted video', null, before, 'reconcile_video_missing'],
    ['rejected upload', status({ uploadStatus: 'rejected' }), before, 'reconcile_upload_rejected'],
    ['failed processing', status({ processingStatus: 'failed' }), before, 'reconcile_processing_failed'],
    ['unexpected privacy', status({ privacyStatus: 'unlisted' }), before, 'reconcile_unexpected_privacy'],
    ['publishAt removed before publication', status({ publishAt: null }), before, 'reconcile_publish_at_missing'],
    ['publishAt changed outside the CRM', status({ publishAt: '2026-09-25T18:00:00.000Z' }), before, 'reconcile_publish_at_mismatch'],
    ['still private long after publishAt', status({ publishAt: scheduledFor }), after(16), 'reconcile_publish_overdue'],
    ['past time with no publishAt', status({ publishAt: null }), after(1), 'reconcile_publish_overdue'],
  ])('flags %s without publishing', (_label, actual, now, code) => {
    const decision = decideReconciliation(pub, actual as YoutubeDeliveryStatus | null, now as number);
    expect(decision).toMatchObject({ action: 'exception', code });
  });

  it('throttles checks by how close the publication is to going live', () => {
    const now = Date.parse(scheduledFor) - 60 * 60_000;
    expect(reconciliationDue(pub, now)).toBe(true);
    const checked = (state: string, msAgo: number) => ({ scheduled_for: scheduledFor, platform_payload: { youtubeReconciliation: { state, checkedAt: new Date(now - msAgo).toISOString() } } });
    expect(reconciliationDue(checked('healthy', 5 * 60_000), now)).toBe(false);
    expect(reconciliationDue(checked('healthy', UPCOMING_RECHECK_MS), now)).toBe(true);
    expect(reconciliationDue(checked('exception', EXCEPTION_RECHECK_MS - 1000), now)).toBe(false);
    const dueNow = Date.parse(scheduledFor) + 60_000;
    const recent = { scheduled_for: scheduledFor, platform_payload: { youtubeReconciliation: { state: 'healthy', checkedAt: new Date(dueNow - 61_000).toISOString() } } };
    expect(reconciliationDue(recent, dueNow)).toBe(true);
  });
});

describe('scheduled reconciliation pass', () => {
  it('records an exception once, keeps Scheduled, and clears it when YouTube recovers', async () => {
    const h = publishHarness();
    const scheduledFor = new Date(h.now() + 20 * 60_000).toISOString();
    const id = await h.prepare('short', 'scheduled', { scheduledFor });
    await h.drain(id);
    const video = h.youtube.video();

    video.status = { ...video.status, publishAt: undefined };
    h.setClock(Date.parse(scheduledFor) - 16 * 60_000);
    let summary = await h.reconcile();
    expect(summary.exceptions).toBe(1);
    expect(h.pub(id).status).toBe('scheduled');
    expect(h.pub(id).error_code).toBe('reconcile_publish_at_missing');

    // Re-checking an unchanged exception does not add another event...
    h.advance(EXCEPTION_RECHECK_MS);
    await h.reconcile();
    const exceptionCodes = () => h.eventsFor(id)
      .filter((event) => event.event_type === 'youtube_reconciliation_exception')
      .map((event) => (event.detail as { code: string }).code);
    expect(exceptionCodes()).toEqual(['reconcile_publish_at_missing']);

    // ...but a changed one does: once the time passes it is overdue.
    h.setClock(Date.parse(scheduledFor) + EXCEPTION_RECHECK_MS);
    await h.reconcile();
    expect(exceptionCodes()).toEqual(['reconcile_publish_at_missing', 'reconcile_publish_overdue']);

    // Someone restores the schedule in Studio; YouTube publishes; the CRM follows.
    video.status = { ...video.status, publishAt: scheduledFor };
    h.youtube.releaseScheduled(Date.parse(scheduledFor));
    h.advance(EXCEPTION_RECHECK_MS);
    summary = await h.reconcile();
    expect(summary.published).toBe(1);
    expect(h.pub(id).status).toBe('published');
    expect(h.pub(id).error_code).toBeNull();
  });

  it('flags a deleted scheduled video instead of publishing it', async () => {
    const h = publishHarness();
    const scheduledFor = new Date(h.now() + 20 * 60_000).toISOString();
    const id = await h.prepare('short', 'scheduled', { scheduledFor });
    await h.drain(id);
    h.youtube.video().deleted = true;
    h.setClock(Date.parse(scheduledFor) + 60_000);
    await h.reconcile();
    expect(h.pub(id).status).toBe('scheduled');
    expect(h.pub(id).error_code).toBe('reconcile_video_missing');
  });
});

describe('failure classification', () => {
  it('parses Retry-After seconds and HTTP dates', () => {
    const now = Date.parse('2026-09-24T12:00:00.000Z');
    expect(parseRetryAfter('120', now)).toBe(120_000);
    expect(parseRetryAfter('Thu, 24 Sep 2026 12:05:00 GMT', now)).toBe(300_000);
    expect(parseRetryAfter('garbage', now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });

  it.each([
    [httpFailure(429, 'rateLimitExceeded', 5000), 'rate_limited', true],
    [httpFailure(503, 'backendError'), 'server_error', true],
    [httpFailure(500, 'internal'), 'server_error', true],
    [new TransientYoutubeError('Network error calling YouTube: reset'), 'server_error', true],
    [new Error('request timed out'), 'timeout', true],
    [new TypeError('fetch failed'), 'network', true],
    [httpFailure(401, 'Invalid Credentials'), 'auth', false],
    [httpFailure(403, 'forbidden'), 'auth', false],
    [httpFailure(400, 'invalidTitle'), 'validation', false],
    [httpFailure(404, 'Drive metadata fetch failed (404)'), 'not_found', false],
    [new PermanentYoutubeError('Short upload blocked'), 'permanent', false],
    [new Error('YouTube OAuth token refresh failed (400): invalid_grant'), 'auth', false],
  ])('classifies %s', (error, kind, retryable) => {
    expect(classifyPublishFailure(error, 1)).toMatchObject({ kind, retryable });
  });

  it('keeps Retry-After and stops retrying at the attempt budget', () => {
    expect(classifyPublishFailure(httpFailure(429, 'x', 90_000), 1).retryAfterMs).toBe(90_000);
    expect(classifyPublishFailure(httpFailure(503, 'x'), MAX_PUBLISH_ATTEMPTS)).toEqual({ kind: 'exhausted', retryable: false, retryAfterMs: null });
  });

  it('backs off exponentially but never sooner than Retry-After', () => {
    expect(retryDelayMs(1, null)).toBe(60_000);
    expect(retryDelayMs(3, null)).toBe(240_000);
    expect(retryDelayMs(20, null)).toBe(1_800_000);
    expect(retryDelayMs(1, 600_000)).toBe(600_000);
  });
});

describe('YouTube API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds the complete status part, private with publishAt for scheduled delivery', () => {
    expect(buildYoutubeStatus({
      delivery_mode: 'scheduled', desired_privacy_status: 'public', scheduled_for: '2026-09-24T18:00:00+00:00',
      license: 'youtube', embeddable: true, public_stats_viewable: true, made_for_kids: false, contains_synthetic_media: true,
    })).toEqual({
      privacyStatus: 'private', publishAt: '2026-09-24T18:00:00.000Z', license: 'youtube', embeddable: true,
      publicStatsViewable: true, selfDeclaredMadeForKids: false, containsSyntheticMedia: true,
    });
    expect(buildYoutubeStatus({ delivery_mode: 'immediate', desired_privacy_status: 'unlisted' }).privacyStatus).toBe('unlisted');
  });

  it('sends notifySubscribers on videos.insert', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200, headers: { location: 'https://upload/session' } }));
    vi.stubGlobal('fetch', fetchMock);
    await createResumableUploadSession('token', { snippet: { title: 't', description: '', tags: [], categoryId: '29' }, status: buildYoutubeStatus({ desired_privacy_status: 'public' }) }, 10, 'video/mp4', { notifySubscribers: false });
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get('notifySubscribers')).toBe('false');
    expect(url.searchParams.get('uploadType')).toBe('resumable');
  });

  it('surfaces Retry-After on a 429 as a transient failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429, headers: { 'retry-after': '30' } })));
    const error = await uploadChunk('https://upload/session', new ArrayBuffer(4), 0, 8).catch((caught) => caught);
    expect(error).toBeInstanceOf(TransientYoutubeError);
    expect(error.retryAfterMs).toBe(30_000);
  });

  it('turns a network failure into a transient error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(uploadChunk('https://upload/session', new ArrayBuffer(4), 0, 8)).rejects.toBeInstanceOf(TransientYoutubeError);
  });

  it('recovers the created video id from a completed upload session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'vid-7' }), { status: 200 })));
    expect(await queryUploadOffset('https://upload/session', 8)).toEqual({ complete: true, videoId: 'vid-7', response: { id: 'vid-7' } });
  });

  it('reports an expired upload session as permanent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(queryUploadOffset('https://upload/session', 8)).rejects.toBeInstanceOf(PermanentYoutubeError);
  });

  it('does not guess "not in playlist" when the lookup fails transiently', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    await expect(isVideoInPlaylist('token', 'PL', 'vid')).rejects.toBeInstanceOf(TransientYoutubeError);
  });
});
