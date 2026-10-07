import { describe, expect, it } from 'vitest';
import {
  aggregateSeriesStatus, buildSeriesPlan, currentCentralWeekStart, isMondayKey, isYoutubeVerifiedSchedule,
  mondayWeekStart, seriesDispatchAt, seriesReadinessCutoff, SERIES_MAX_ITEMS,
} from '../../supabase/functions/social-media-manager/handlers/series-core';
import {
  assignSeriesSchedule, processSeriesSchedule, seriesOpsFor,
  type SeriesItemRow, type SeriesOps, type SeriesScheduleRow, type SeriesStore,
} from '../../supabase/functions/social-media-manager/handlers/series';
import { resolveFullEpisodeTitle } from '../../supabase/functions/social-media-manager/handlers/library';
import { authorizeAction } from '../../supabase/functions/social-media-manager/actions';
import type { SocialMediaLibraryItem } from '../../supabase/functions/social-media-manager/types';

const preferred = { short: ['12:00', '15:00', '18:00'], longForm: ['08:00', '14:00'] };
const PROJECT = 'project-1';
const WEEK = '2026-10-19';
const BEFORE_DISPATCH = Date.parse('2026-10-16T16:59:00Z'); // Fri 11:59 CDT
const AT_DISPATCH = Date.parse('2026-10-16T17:00:00Z'); // Fri 12:00 CDT

function lib(overrides: Partial<SocialMediaLibraryItem> & { sourceId: string }): SocialMediaLibraryItem {
  return {
    sourceType: 'clip', projectId: PROJECT, clipId: overrides.sourceId, partNumber: null, contentFormat: 'short',
    title: `Title ${overrides.sourceId}`, description: '', thumbnailUrl: null, thumbnailFileId: 'thumb', guestName: 'G',
    organizationName: 'Org', durationSeconds: 60, sourceFileId: 'file', sourceFileUrl: null,
    readiness: { ready: true, reasons: [] }, activePublication: null, publishedPublication: null,
    failedPublication: null, latestPublication: null, defaultPlaylistName: null, ...overrides,
  };
}
const part = (n: number, extra: Partial<SocialMediaLibraryItem> = {}) =>
  lib({ sourceId: `part-${n}`, contentFormat: 'long_form', partNumber: n, ...extra });
const short = (n: number, extra: Partial<SocialMediaLibraryItem> = {}) => lib({ sourceId: `short-${n}`, ...extra });
const full = (extra: Partial<SocialMediaLibraryItem> = {}) =>
  lib({ sourceId: PROJECT, sourceType: 'project', clipId: null, contentFormat: 'full_episode', title: 'Full Episode', thumbnailFileId: null, ...extra });
const project = { id: PROJECT, organizationName: 'Org', guestName: 'G', expectedPartCount: null, expectedShortCount: null };

function plan(items: SocialMediaLibraryItem[], extra: Partial<Parameters<typeof buildSeriesPlan>[0]> = {}) {
  return buildSeriesPlan({ project, libraryItems: items, weekStart: WEEK, preferred, occupiedSlots: new Set(), nowMs: AT_DISPATCH, ...extra });
}

describe('series week math (America/Chicago, DST aware)', () => {
  it('finds Monday week starts', () => {
    expect(mondayWeekStart('2026-10-25')).toBe('2026-10-19'); // Sunday
    expect(mondayWeekStart('2026-10-19')).toBe('2026-10-19');
    expect(isMondayKey('2026-10-20')).toBe(false);
    expect(currentCentralWeekStart(Date.parse('2026-10-19T04:30:00Z'))).toBe('2026-10-12'); // still Sunday night in Chicago
  });
  it('dispatches previous Friday at 12:00 Central in CDT and CST', () => {
    expect(seriesDispatchAt('2026-10-19')).toBe('2026-10-16T17:00:00.000Z');
    expect(seriesDispatchAt('2026-11-09')).toBe('2026-11-06T18:00:00.000Z');
    // Week right after fall-back (Nov 1 2026): Friday Oct 30 is still CDT.
    expect(seriesDispatchAt('2026-11-02')).toBe('2026-10-30T17:00:00.000Z');
    // Spring-forward Sunday Mar 8 2026: Friday Mar 6 is CST.
    expect(seriesDispatchAt('2026-03-09')).toBe('2026-03-06T18:00:00.000Z');
    expect(() => seriesDispatchAt('2026-10-20')).toThrow();
    expect(seriesReadinessCutoff(WEEK)).toBe('2026-10-19T11:00:00.000Z');
  });
});

describe('buildSeriesPlan', () => {
  it('puts the full episode first on Monday morning and keeps Parts chronological', () => {
    const result = plan([part(3), part(1), part(2), short(1), short(2), full()]);
    expect(result.ok).toBe(true);
    const fullItem = result.items.find((i) => i.contentFormat === 'full_episode')!;
    expect(fullItem.localDate).toBe('2026-10-19');
    expect(fullItem.localTime).toBe('08:00');
    const parts = result.items.filter((i) => i.contentFormat === 'long_form');
    const times = parts.map((p) => Date.parse(p.scheduledFor!));
    expect(parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('schedules more than 30 videos (no bulk cap) without dropping any', () => {
    const items = [full(), ...Array.from({ length: 13 }, (_, i) => part(i + 1)), ...Array.from({ length: 21 }, (_, i) => short(i + 1))];
    const result = plan(items);
    expect(result.items.length).toBe(35);
    expect(result.ok).toBe(true);
    expect(result.items.every((i) => i.scheduledFor)).toBe(true);
    expect(new Set(result.items.map((i) => `${i.localDate}|${i.localTime}`)).size).toBe(35);
    expect(SERIES_MAX_ITEMS).toBeGreaterThan(30);
  });

  it('blocks rather than silently omitting when slots are insufficient', () => {
    const result = plan(Array.from({ length: 22 }, (_, i) => short(i + 1)));
    expect(result.ok).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/Only 21 preferred time slots/);
  });

  it('respects slots occupied by other publications', () => {
    const result = plan([full()], { occupiedSlots: new Set(['2026-10-19|08:00']) });
    expect(result.items[0].localTime).toBe('08:00');
    expect(result.items[0].localDate).toBe('2026-10-20');
  });

  it('blocks the whole series on any unready, untitled or thumbnail-less item', () => {
    expect(plan([part(1), short(1, { thumbnailFileId: null })]).blockers.join()).toMatch(/thumbnail/);
    expect(plan([part(1, { readiness: { ready: false, reasons: ['not rendered'] } })]).blockers.join()).toMatch(/not rendered/);
    expect(plan([part(1), full({ title: null })]).blockers.join()).toMatch(/Full episode needs a title/);
  });

  it('protects an incomplete pipeline using expected counts', () => {
    const result = buildSeriesPlan({ project: { ...project, expectedPartCount: 3, expectedShortCount: 1 }, libraryItems: [part(1), short(1)], weekStart: WEEK, preferred, occupiedSlots: new Set(), nowMs: AT_DISPATCH });
    expect(result.ok).toBe(false);
    expect(result.blockers.join()).toMatch(/1 of 3 expected Parts/);
  });

  it('never republishes and adopts in-flight publications', () => {
    const published = { id: 'pub-1', status: 'published' as const, deliveryMode: 'scheduled' as const, scheduledFor: null, desiredPrivacyStatus: 'public' as const, externalVideoId: 'yt', externalUrl: null, thumbnailStatus: null };
    const scheduled = { ...published, id: 'pub-2', status: 'scheduled' as const, scheduledFor: '2026-10-20T13:00:00Z' };
    const result = plan([part(1, { publishedPublication: published }), part(2, { activePublication: scheduled }), short(1)]);
    expect(result.ok).toBe(true);
    expect(result.items.find((i) => i.sourceId === 'part-1')!.kind).toBe('already_published');
    expect(result.items.find((i) => i.sourceId === 'part-2')!.kind).toBe('adopt');
    expect(result.counts.toSchedule).toBe(1);
  });

  it('ignores other projects (stale revisions are filtered by listLibrary)', () => {
    expect(plan([part(1), lib({ sourceId: 'x', projectId: 'other' })]).items.map((i) => i.sourceId)).toEqual(['part-1']);
  });
});

describe('full-episode title resolution', () => {
  it('uses prepared publication metadata', () => {
    const row = (status: string, title: string | null, created_at: string) => ({ id: created_at, created_at, status, title, delivery_mode: 'immediate', scheduled_for: null, desired_privacy_status: 'public', external_video_id: null, external_url: null, clip_id: null, project_id: PROJECT, content_format: 'full_episode', platform_payload: null });
    expect(resolveFullEpisodeTitle([row('draft', 'Draft Title', '2026-10-02'), row('cancelled', 'Old', '2026-10-03')])).toBe('Draft Title');
    expect(resolveFullEpisodeTitle([row('cancelled', 'Old', '2026-10-03')])).toBe('Old');
    expect(resolveFullEpisodeTitle([])).toBeNull();
  });
});

describe('YouTube verification and aggregation', () => {
  const pub = { id: 'p', status: 'scheduled', scheduledFor: '2026-10-19T13:00:00Z', errorMessage: null, youtubeSchedule: { apiStatus: 'verified', privacyStatus: 'private', youtubePublishAt: '2026-10-19T13:00:00.000Z' } };
  it('only counts private + matching publishAt as verified', () => {
    expect(isYoutubeVerifiedSchedule(pub)).toBe(true);
    expect(isYoutubeVerifiedSchedule({ ...pub, youtubeSchedule: { ...pub.youtubeSchedule, privacyStatus: 'public' } })).toBe(false);
    expect(isYoutubeVerifiedSchedule({ ...pub, youtubeSchedule: { ...pub.youtubeSchedule, youtubePublishAt: '2026-10-19T14:00:00Z' } })).toBe(false);
    expect(isYoutubeVerifiedSchedule({ ...pub, status: 'upload_queued' })).toBe(false);
  });
  it('aggregates series status', () => {
    expect(aggregateSeriesStatus(['queued', 'queued'])).toBe('queued');
    expect(aggregateSeriesStatus(['youtube_scheduled', 'queued'])).toBe('partially_scheduled');
    expect(aggregateSeriesStatus(['youtube_scheduled', 'already_published'])).toBe('youtube_scheduled');
    expect(aggregateSeriesStatus(['published', 'already_published'])).toBe('complete');
    expect(aggregateSeriesStatus(['failed', 'youtube_scheduled'])).toBe('partially_scheduled');
  });
});

// ---- processor with mocked publication pipeline + mocked YouTube state --------------------
function harness(libraryItems: SocialMediaLibraryItem[], options: { failValidateFor?: string; failQueueOnce?: string } = {}) {
  const schedule: SeriesScheduleRow = {
    id: 's1', tenant_id: 't1', project_id: PROJECT, week_start: WEEK, timezone: 'America/Chicago',
    dispatch_at: seriesDispatchAt(WEEK), status: 'assigned', attempt_count: 0, lease_id: 'L', lease_expires_at: null,
    next_attempt_at: null, blocked_reasons: [], last_error_code: null, last_error: null, unrecoverable: false,
    dispatch_started_at: null, queued_at: null, youtube_scheduled_at: null, completed_at: null, created_by: 'u1',
    created_at: '', updated_at: '', last_checked_at: null,
  };
  const items: SeriesItemRow[] = [];
  const pubs = new Map<string, { status: string; scheduledFor: string | null; sourceKey: string; youtube?: boolean }>();
  const calls: string[] = [];
  let queueFailed = false;
  const ops: SeriesOps = {
    plan: async (row, now) => buildSeriesPlan({ project, libraryItems, weekStart: row.week_start, preferred, occupiedSlots: new Set(), nowMs: now }),
    library: async () => libraryItems,
    create: async (item) => {
      const id = `pub-${item.source_id}`;
      if ([...pubs.values()].some((p) => p.sourceKey === item.source_id && p.status !== 'cancelled')) throw new Error('duplicate');
      pubs.set(id, { status: 'draft', scheduledFor: item.scheduled_for, sourceKey: item.source_id });
      calls.push(`create:${item.source_id}`);
      return id;
    },
    reschedule: async (id, at) => { const p = pubs.get(id)!; p.scheduledFor = at; p.status = 'ready'; },
    publicationStatus: async (id) => {
      const p = pubs.get(id);
      if (!p) return null;
      return { id, status: p.status, scheduledFor: p.scheduledFor, errorMessage: p.status === 'failed' ? 'Upload failed' : null,
        youtubeSchedule: p.youtube ? { apiStatus: 'verified', privacyStatus: 'private', youtubePublishAt: p.scheduledFor } : null };
    },
    validate: async (id) => (options.failValidateFor && id.endsWith(options.failValidateFor) ? { ok: false, errors: ['bad'] } : { ok: true, errors: [] }),
    approve: async (id) => { pubs.get(id)!.status = 'approved'; calls.push(`approve:${id}`); },
    queue: async (id) => {
      if (options.failQueueOnce && id.endsWith(options.failQueueOnce) && !queueFailed) { queueFailed = true; throw new Error('transient'); }
      const p = pubs.get(id)!;
      if (p.status !== 'approved') throw new Error('not approved');
      p.status = 'upload_queued'; calls.push(`queue:${id}`);
    },
  };
  const store: SeriesStore = {
    updateSchedule: async (_id, lease, patch, guard = {}) => {
      if (schedule.lease_id !== lease) return false;
      for (const [k, v] of Object.entries(guard)) if ((schedule as Record<string, unknown>)[k] !== v) return false;
      Object.assign(schedule, patch);
      if (patch.lease_id === null) schedule.lease_id = 'L'; // re-lease for the next simulated tick
      return true;
    },
    loadItems: async () => [...items].sort((a, b) => a.sequence - b.sequence),
    insertItems: async (rows) => {
      for (const r of rows) {
        if (items.some((i) => i.source_id === r.source_id)) continue;
        items.push({ id: `item-${r.source_id}`, attempt_count: 0, last_error: null, youtube_publish_at: null, ...r } as SeriesItemRow);
      }
    },
    updateItem: async (id, patch) => { Object.assign(items.find((i) => i.id === id)!, patch); },
  };
  const tick = (now = AT_DISPATCH) => processSeriesSchedule({ ...schedule }, 'L', ops, store, now);
  return { schedule, items, pubs, calls, tick };
}

describe('processSeriesSchedule', () => {
  it('does nothing before the Friday-noon deadline', async () => {
    const h = harness([part(1)]);
    await h.tick(BEFORE_DISPATCH);
    expect(h.schedule.status).toBe('assigned');
    expect(h.calls).toEqual([]);
  });

  it('blocks and retries, then fails unrecoverably after the Monday cutoff', async () => {
    const h = harness([part(1, { readiness: { ready: false, reasons: ['render pending'] } })]);
    await h.tick();
    expect(h.schedule.status).toBe('blocked');
    expect(h.schedule.next_attempt_at).toBeTruthy();
    expect(h.calls).toEqual([]);
    await h.tick(Date.parse(seriesReadinessCutoff(WEEK)));
    expect(h.schedule.status).toBe('failed');
    expect(h.schedule.unrecoverable).toBe(true);
  });

  it('runs create -> validate -> approve -> queue for every item in chunks, then tracks YouTube', async () => {
    const lib = [full(), ...Array.from({ length: 4 }, (_, i) => part(i + 1)), ...Array.from({ length: 6 }, (_, i) => short(i + 1))];
    const h = harness(lib);
    for (let i = 0; i < 8 && h.schedule.status === 'dispatching' || i === 0; i++) await h.tick();
    expect(h.schedule.status).toBe('queued');
    expect(h.calls.filter((c) => c.startsWith('create')).length).toBe(11);
    const firstQueue = h.calls.findIndex((c) => c.startsWith('queue'));
    const lastApprove = h.calls.map((c) => c.startsWith('approve')).lastIndexOf(true);
    expect(lastApprove).toBeLessThan(firstQueue); // nothing queued until all prepared

    // Mocked YouTube: worker uploaded half and verified them.
    const ids = [...h.pubs.keys()];
    ids.slice(0, 5).forEach((id) => Object.assign(h.pubs.get(id)!, { status: 'scheduled', youtube: true }));
    await h.tick();
    expect(h.schedule.status).toBe('partially_scheduled');
    ids.forEach((id) => Object.assign(h.pubs.get(id)!, { status: 'scheduled', youtube: true }));
    await h.tick();
    expect(h.schedule.status).toBe('youtube_scheduled');
    ids.forEach((id) => { h.pubs.get(id)!.status = 'published'; });
    await h.tick();
    expect(h.schedule.status).toBe('complete');
  });

  it('is idempotent after a crash and retries transient queue errors', async () => {
    const h = harness([part(1), part(2)], { failQueueOnce: 'part-2' });
    for (let i = 0; i < 6 && h.schedule.status !== 'queued'; i++) await h.tick();
    expect(h.schedule.status).toBe('queued');
    expect(h.calls.filter((c) => c === 'queue:pub-part-2').length).toBe(1);
    expect(h.calls.filter((c) => c.startsWith('create')).length).toBe(2);
  });

  it('surfaces per-item failures without queueing anything', async () => {
    const h = harness([part(1), part(2)], { failValidateFor: 'part-2' });
    for (let i = 0; i < 10 && h.schedule.status !== 'failed'; i++) await h.tick();
    expect(h.schedule.status).toBe('failed');
    expect(h.items.find((i) => i.source_id === 'part-2')!.last_error).toMatch(/bad/);
    expect(h.calls.some((c) => c.startsWith('queue'))).toBe(false);
  });
});

describe('series authorization', () => {
  it('requires mutate for assign/change/remove and allows reads', () => {
    const viewer = { capabilities: { mutate: false, communicate: false, manage_campaigns: false, report: false } };
    expect(() => authorizeAction(viewer, 'assign_series_schedule')).toThrow('FORBIDDEN');
    expect(() => authorizeAction(viewer, 'remove_series_schedule')).toThrow('FORBIDDEN');
    expect(() => authorizeAction(viewer, 'list_series_schedules')).not.toThrow();
  });
  it('rejects assignment without mutate before touching the database', async () => {
    const auth = { userId: 'u', tenantId: 't1', crmRole: 'crm_readonly', capabilities: { mutate: false, communicate: false, manage_campaigns: false, report: false }, db: {} as never };
    await expect(assignSeriesSchedule(auth, { weekStart: WEEK, projectId: PROJECT })).rejects.toThrow('FORBIDDEN');
  });
  it('automation refuses to plan another tenant\'s schedule', async () => {
    const auth = { userId: 'u', tenantId: 't1', crmRole: 'x', capabilities: { mutate: true, communicate: false, manage_campaigns: false, report: false }, db: {} as never };
    await expect(seriesOpsFor(auth).plan({ tenant_id: 't2' } as SeriesScheduleRow, AT_DISPATCH)).rejects.toThrow('Tenant mismatch');
  });
});
