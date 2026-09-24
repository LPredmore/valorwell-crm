import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { YoutubeDeliveryStatus } from '../../supabase/functions/_shared/youtube-publish/api';
import { authorizeAction, MUTATE_ACTIONS, VIEW_ACTIONS } from '../../supabase/functions/social-media-manager/actions';
import { canTransition, PUBLICATION_TRANSITIONS } from '../../supabase/functions/social-media-manager/lifecycle';
import {
  applyFilters, defaultPlaylistResolver, listLibrary, pickPublications,
} from '../../supabase/functions/social-media-manager/handlers/library';
import {
  approvePublication, cancelPublication, createPublication, queuePublish, reschedulePublication, retryPublication,
  updatePublication, type YoutubeScheduleClient,
} from '../../supabase/functions/social-media-manager/handlers/publications';
import { getYoutubeConnectionStatus } from '../../supabase/functions/social-media-manager/handlers/youtube-status';
import type { PublicationStatus, SocialMediaLibraryItem } from '../../supabase/functions/social-media-manager/types';
import {
  authFor, PART_CLIP_A, PLAYLIST_PARTS_A, publication, SHORT_CLIP_A, socialDb, TENANT_A,
} from './helpers/social-fixtures';

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

describe('publication lifecycle', () => {
  it('allows the documented happy paths', () => {
    const path: PublicationStatus[] = ['draft', 'approved', 'upload_queued', 'uploading', 'scheduled', 'published'];
    for (let index = 0; index < path.length - 1; index += 1) expect(canTransition(path[index], path[index + 1])).toBe(true);
    expect(canTransition('uploading', 'uploaded')).toBe(true);
    expect(canTransition('uploading', 'published')).toBe(true);
    expect(canTransition('failed', 'approved')).toBe(true);
  });

  it.each([
    ['draft', 'upload_queued'], ['draft', 'published'], ['approved', 'published'], ['uploaded', 'published'],
    ['published', 'scheduled'], ['scheduled', 'cancelled'], ['uploading', 'cancelled'], ['cancelled', 'draft'],
    ['published', 'failed'], ['uploaded', 'cancelled'],
  ] as [PublicationStatus, PublicationStatus][])('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('never lets a video leave YouTube-owned states from the CRM', () => {
    expect(PUBLICATION_TRANSITIONS.uploaded).toEqual([]);
    expect(PUBLICATION_TRANSITIONS.published).toEqual([]);
    expect(PUBLICATION_TRANSITIONS.scheduled).toEqual(['published']);
  });

  it('walks draft -> approved -> upload_queued and rejects invalid handler transitions', async () => {
    const db = socialDb();
    const auth = authFor(db);
    const created = await createPublication(auth, { sourceType: 'clip', clipId: PART_CLIP_A });
    await expect(queuePublish(auth, { id: created.id })).rejects.toThrow('Invalid publication transition: draft -> upload_queued');
    await approvePublication(auth, { id: created.id });
    await expect(approvePublication(auth, { id: created.id })).rejects.toThrow('Invalid publication transition: approved -> approved');
    await queuePublish(auth, { id: created.id });
    expect(publication(db, created.id).status).toBe('upload_queued');
    await expect(retryPublication(auth, { id: created.id })).rejects.toThrow('Only failed publications can be retried');
    await expect(updatePublication(auth, { id: created.id, changes: { title: 'x' } })).rejects.toThrow('locked');
  });

  it('clears approval when approved metadata is edited', async () => {
    const db = socialDb();
    const auth = authFor(db);
    const created = await createPublication(auth, { sourceType: 'clip', clipId: PART_CLIP_A });
    await approvePublication(auth, { id: created.id });
    const edited = await updatePublication(auth, { id: created.id, changes: { title: 'New title' } });
    expect(edited.status).toBe('ready');
    expect(edited.approvedAt).toBeNull();
  });

  it('lets a failed publication that never reached YouTube be fixed and re-approved', async () => {
    const db = socialDb();
    const auth = authFor(db);
    const created = await createPublication(auth, { sourceType: 'clip', clipId: PART_CLIP_A });
    Object.assign(publication(db, created.id), { status: 'failed', error_code: 'validation', error_message: 'invalidTitle' });
    const fixed = await updatePublication(auth, { id: created.id, changes: { title: 'Valid title' } });
    expect(fixed.status).toBe('ready');
    expect(fixed.errorCode).toBeNull();

    Object.assign(publication(db, created.id), { status: 'failed', external_video_id: 'vid-9' });
    await expect(updatePublication(auth, { id: created.id, changes: { title: 'x' } })).rejects.toThrow('locked');
  });
});

describe('cancellation semantics', () => {
  async function at(status: PublicationStatus, externalVideoId: string | null = null) {
    const db = socialDb();
    const created = await createPublication(authFor(db), { sourceType: 'clip', clipId: PART_CLIP_A });
    Object.assign(publication(db, created.id), { status, external_video_id: externalVideoId });
    return { db, id: created.id };
  }

  it.each(['draft', 'ready', 'approved', 'upload_queued'] as PublicationStatus[])('cancels %s before anything reaches YouTube', async (status) => {
    const { db, id } = await at(status);
    const result = await cancelPublication(authFor(db), { id });
    expect(result.status).toBe('cancelled');
  });

  it.each(['scheduled', 'uploaded', 'published'] as PublicationStatus[])('refuses to cancel an uploaded %s video and says to use YouTube Studio', async (status) => {
    const { db, id } = await at(status, 'vid-1');
    await expect(cancelPublication(authFor(db), { id })).rejects.toThrow('YouTube Studio');
    expect(publication(db, id).status).toBe(status);
  });

  it('refuses to cancel while an upload is in flight', async () => {
    const { db, id } = await at('uploading');
    await expect(cancelPublication(authFor(db), { id })).rejects.toThrow('in progress');
  });
});

describe('rescheduling', () => {
  function youtubeClient(initial: Partial<YoutubeDeliveryStatus>, options: { ignoreUpdate?: boolean } = {}) {
    const state: YoutubeDeliveryStatus = {
      privacyStatus: 'private', publishAt: null, uploadStatus: 'processed', processingStatus: 'succeeded',
      rejectionReason: null, failureReason: null, publishedAt: null, ...initial,
    };
    const client: YoutubeScheduleClient & { updates: unknown[] } = {
      updates: [],
      getDeliveryStatus: vi.fn(async () => ({ ...state })),
      updateStatus: vi.fn(async (_videoId, status) => {
        client.updates.push(status);
        if (!options.ignoreUpdate) Object.assign(state, { privacyStatus: status.privacyStatus, publishAt: status.publishAt ?? null });
      }),
    };
    return client;
  }

  async function scheduledOnYoutube() {
    const db = socialDb();
    const auth = authFor(db);
    const created = await createPublication(auth, { sourceType: 'clip', clipId: SHORT_CLIP_A });
    const scheduledFor = inMinutes(60);
    Object.assign(publication(db, created.id), {
      status: 'scheduled', delivery_mode: 'scheduled', desired_privacy_status: 'public', scheduled_for: scheduledFor,
      external_video_id: 'vid-1', embeddable: false, license: 'creativeCommon',
      platform_payload: { thumbnail: { apiStatus: 'manual_confirmed' } },
    });
    return { db, auth, id: created.id, scheduledFor };
  }

  it('changes the CRM only, and clears approval, before upload', async () => {
    const db = socialDb();
    const auth = authFor(db);
    const created = await createPublication(auth, { sourceType: 'clip', clipId: SHORT_CLIP_A });
    await approvePublication(auth, { id: created.id });
    const client = youtubeClient({});
    const next = inMinutes(90);
    const result = await reschedulePublication(auth, { id: created.id, scheduledFor: next }, client);
    expect(result.scheduledFor).toBe(next);
    expect(result.deliveryMode).toBe('scheduled');
    expect(result.status).toBe('ready');
    expect(client.getDeliveryStatus).not.toHaveBeenCalled();
    expect(client.updateStatus).not.toHaveBeenCalled();
  });

  it('after upload, updates YouTube with the complete status, verifies it, then records it', async () => {
    const { db, auth, id, scheduledFor } = await scheduledOnYoutube();
    const client = youtubeClient({ publishAt: scheduledFor });
    const next = inMinutes(120);
    const result = await reschedulePublication(auth, { id, scheduledFor: next }, client);

    expect(client.updates).toEqual([{
      privacyStatus: 'private', publishAt: next, license: 'creativeCommon', embeddable: false,
      publicStatsViewable: true, selfDeclaredMadeForKids: false, containsSyntheticMedia: false,
    }]);
    expect(result.scheduledFor).toBe(next);
    expect(result.youtubeSchedule).toMatchObject({ apiStatus: 'verified', youtubePublishAt: next });
    expect(result.thumbnailDelivery?.apiStatus).toBe('manual_confirmed');
    const event = db.table('ai_operations_social_publication_events').find((row) => row.event_type === 'youtube_rescheduled');
    expect(event?.detail).toMatchObject({ from: scheduledFor, to: next, actorProfileId: 'profile-1' });
  });

  it('leaves the CRM schedule unchanged when YouTube does not confirm the new time', async () => {
    const { db, auth, id, scheduledFor } = await scheduledOnYoutube();
    const client = youtubeClient({ publishAt: scheduledFor }, { ignoreUpdate: true });
    await expect(reschedulePublication(auth, { id, scheduledFor: inMinutes(120) }, client)).rejects.toThrow('YouTube did not confirm');
    expect(publication(db, id).scheduled_for).toBe(scheduledFor);
    expect(publication(db, id).error_code).toBe('reschedule_unverified');
    expect(db.table('ai_operations_social_publication_events').some((row) => row.event_type === 'youtube_reschedule_unverified')).toBe(true);
  });

  it('refuses once YouTube reports the video is already public', async () => {
    const { auth, id } = await scheduledOnYoutube();
    const client = youtubeClient({ privacyStatus: 'public' });
    await expect(reschedulePublication(auth, { id, scheduledFor: inMinutes(120) }, client)).rejects.toThrow('already public');
    expect(client.updateStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['a past time', () => '2020-01-01T00:00:00.000Z', 'at least 1 minute in the future'],
    ['garbage', () => 'not-a-date', 'valid ISO timestamp'],
  ])('rejects %s', async (_label, value, message) => {
    const { auth, id } = await scheduledOnYoutube();
    await expect(reschedulePublication(auth, { id, scheduledFor: value() }, youtubeClient({}))).rejects.toThrow(message);
  });

  it('refuses statuses that cannot be rescheduled', async () => {
    const { db, auth, id } = await scheduledOnYoutube();
    publication(db, id).status = 'uploading';
    await expect(reschedulePublication(auth, { id, scheduledFor: inMinutes(120) }, youtubeClient({}))).rejects.toThrow('Cannot reschedule');
  });
});

describe('readonly users', () => {
  const readonly = { capabilities: { mutate: false, communicate: false, manage_campaigns: false, report: false } };
  const operator = { capabilities: { mutate: true, communicate: false, manage_campaigns: false, report: false } };

  it('cannot run any mutation action', () => {
    for (const action of MUTATE_ACTIONS) expect(() => authorizeAction(readonly, action)).toThrow('FORBIDDEN');
    for (const action of MUTATE_ACTIONS) expect(() => authorizeAction(operator, action)).not.toThrow();
  });

  it('can run every view action', () => {
    for (const action of VIEW_ACTIONS) expect(() => authorizeAction(readonly, action)).not.toThrow();
    expect(() => authorizeAction(readonly, 'drop_everything')).toThrow('Invalid action');
  });

  it('classifies every dispatched action, and classifies every writing action as a mutation', () => {
    const source = readFileSync(resolve(__dirname, '../../supabase/functions/social-media-manager/index.ts'), 'utf8');
    const dispatched = [...source.matchAll(/case "([a-z_]+)":/g)].map((match) => match[1]);
    expect(dispatched.length).toBeGreaterThan(15);
    for (const action of dispatched) expect(VIEW_ACTIONS.has(action) || MUTATE_ACTIONS.has(action)).toBe(true);
    for (const action of ['create_publication', 'update_publication', 'approve_publication', 'set_publication_playlists',
      'queue_publish', 'reschedule_publication', 'cancel_publication', 'retry_publication', 'replace_thumbnail',
      'mark_thumbnail_manual_done', 'verify_youtube_connection']) {
      expect(MUTATE_ACTIONS.has(action)).toBe(true);
    }
  });

  it('reads the YouTube connection state without writing anything', async () => {
    const db = socialDb();
    const status = await getYoutubeConnectionStatus(authFor(db, TENANT_A, false));
    expect(status).toMatchObject({ state: 'connected', channelId: 'UC-A', source: 'recorded', lastVerifiedAt: '2026-09-20T00:00:00.000Z' });
    expect(db.mutations).toHaveLength(0);
  });
});

describe('Library', () => {
  const row = (id: string, status: string, createdAt: string) => ({
    id, created_at: createdAt, status, delivery_mode: 'immediate', scheduled_for: null, desired_privacy_status: 'public',
    external_video_id: null, external_url: null, clip_id: 'c', project_id: 'p', content_format: 'short', platform_payload: {},
  });

  it('surfaces a failed publication only while it is the latest attempt', () => {
    const failedLatest = pickPublications([row('a', 'published', '2026-09-01'), row('b', 'failed', '2026-09-02')]);
    expect(failedLatest.failed?.id).toBe('b');
    expect(failedLatest.published?.id).toBe('a');
    expect(failedLatest.active).toBeNull();

    const retriedSince = pickPublications([row('b', 'failed', '2026-09-02'), row('c', 'draft', '2026-09-03')]);
    expect(retriedSince.failed).toBeNull();
    expect(retriedSince.active?.id).toBe('c');
    expect(retriedSince.latest?.id).toBe('c');
  });

  it('orders by creation time, not by id', () => {
    const picked = pickPublications([row('zzz', 'cancelled', '2026-09-01'), row('aaa', 'failed', '2026-09-05')]);
    expect(picked.latest?.id).toBe('aaa');
    expect(picked.failed?.id).toBe('aaa');
  });

  it('the Failed filter returns failed items, and Unscheduled excludes them', () => {
    const item = (overrides: Partial<SocialMediaLibraryItem>) => ({
      sourceType: 'clip', sourceId: 'x', title: 't', guestName: 'G', organizationName: 'O', contentFormat: 'short',
      readiness: { ready: true, reasons: [] }, activePublication: null, publishedPublication: null, failedPublication: null, latestPublication: null,
      ...overrides,
    }) as SocialMediaLibraryItem;
    const failed = item({ sourceId: 'failed', failedPublication: { id: 'f', status: 'failed' } as SocialMediaLibraryItem['failedPublication'] });
    const fresh = item({ sourceId: 'fresh', guestName: 'Other' });
    expect(applyFilters([failed, fresh], { publicationState: 'failed' }).map((i) => i.sourceId)).toEqual(['failed']);
    expect(applyFilters([failed, fresh], { publicationState: 'unscheduled' }).map((i) => i.sourceId)).toEqual(['fresh']);
    expect(applyFilters([failed, fresh], { guest: 'Other' }).map((i) => i.sourceId)).toEqual(['fresh']);
    expect(applyFilters([failed, fresh], { organization: 'O' })).toHaveLength(2);
  });

  it('resolves default playlist names from routing rules for the default account only', () => {
    const resolveName = defaultPlaylistResolver('acct-1', [
      { account_id: 'acct-1', source_type: 'clip', source_clip_type: 'short', default_playlist_id: 'p1', priority: 2, enabled: true },
      { account_id: 'acct-1', source_type: 'clip', source_clip_type: 'short', default_playlist_id: 'p2', priority: 1, enabled: true },
      { account_id: 'acct-1', source_type: 'clip', source_clip_type: 'part', default_playlist_id: 'p3', priority: 1, enabled: false },
      { account_id: 'acct-2', source_type: 'project', source_clip_type: null, default_playlist_id: 'p4', priority: 1, enabled: true },
    ], [
      { id: 'p1', display_name: 'Low priority', is_active: true },
      { id: 'p2', display_name: 'Renamed Shorts', is_active: true },
      { id: 'p3', display_name: 'Disabled rule', is_active: true },
      { id: 'p4', display_name: 'Other account', is_active: true },
    ]);
    expect(resolveName('clip', 'short')).toBe('Renamed Shorts');
    expect(resolveName('clip', 'part')).toBeNull();
    expect(resolveName('project', null)).toBeNull();
  });

  it('listLibrary returns database playlist names and never hard-coded labels', async () => {
    const db = socialDb();
    db.table('ai_operations_social_playlists').find((playlist) => playlist.id === PLAYLIST_PARTS_A)!.display_name = 'BTY Parts (renamed)';
    const items = await listLibrary(authFor(db));
    const byId = new Map(items.map((item) => [item.sourceId, item]));
    expect(byId.get(SHORT_CLIP_A)?.defaultPlaylistName).toBe('BTY Shorts');
    expect(byId.get(PART_CLIP_A)?.defaultPlaylistName).toBe('BTY Parts (renamed)');
    expect(items.find((item) => item.sourceType === 'project')?.defaultPlaylistName).toBe('Beyond The Yellow - Full Episodes');
    expect(items.every((item) => !String(item.guestName).includes('Secret'))).toBe(true);
  });
});
