import { describe, expect, it } from 'vitest';
import {
  createPublication, getPublication, listPublicationEvents, queuePublish, setPublicationPlaylists,
} from '../../supabase/functions/social-media-manager/handlers/publications';
import {
  ACCOUNT_A, authFor, CLIP_B, PART_CLIP_A, PLAYLIST_B, PLAYLIST_EXTRA_A, PLAYLIST_INACTIVE_A,
  PLAYLIST_OTHER_ACCOUNT_A, PLAYLIST_PARTS_A, PLAYLIST_SHORTS_A, PROJECT_A, PROJECT_B, publication,
  SHORT_CLIP_A, socialDb, TENANT_A, TENANT_B,
} from './helpers/social-fixtures';

const insertedPublications = (db: ReturnType<typeof socialDb>) =>
  db.mutations.filter((mutation) => mutation.table === 'ai_operations_social_publications' && mutation.op === 'insert');

describe('Social Media Manager tenant isolation: publication creation', () => {
  it('allows a same-tenant clip and derives tenant, account and default playlist', async () => {
    const db = socialDb();
    const created = await createPublication(authFor(db), { sourceType: 'clip', clipId: SHORT_CLIP_A });
    expect(created.tenantId).toBe(TENANT_A);
    expect(created.accountId).toBe(ACCOUNT_A);
    expect(created.contentFormat).toBe('short');
    expect(created.playlists).toEqual([{ playlistId: PLAYLIST_SHORTS_A, displayName: 'BTY Shorts', isDefault: true }]);
  });

  it('allows a same-tenant project as a full episode', async () => {
    const db = socialDb();
    const created = await createPublication(authFor(db), { sourceType: 'project', projectId: PROJECT_A });
    expect(created.tenantId).toBe(TENANT_A);
    expect(created.contentFormat).toBe('full_episode');
    expect(created.thumbnailFileId).toBe('drive-cover-episode-a');
  });

  it('rejects a foreign-tenant clip UUID before any service-role write', async () => {
    const db = socialDb();
    await expect(createPublication(authFor(db), { sourceType: 'clip', clipId: CLIP_B }))
      .rejects.toThrow('Source video not found in your CRM tenant.');
    expect(insertedPublications(db)).toHaveLength(0);
    expect(db.table('ai_operations_social_publications')).toHaveLength(0);
  });

  it('rejects a foreign-tenant project UUID before any service-role write', async () => {
    const db = socialDb();
    await expect(createPublication(authFor(db), { sourceType: 'project', projectId: PROJECT_B }))
      .rejects.toThrow('Source video not found in your CRM tenant.');
    expect(insertedPublications(db)).toHaveLength(0);
  });

  it('gives the same answer for a foreign source and a non-existent one', async () => {
    const db = socialDb();
    const missing = 'cccccccc-2222-4000-8000-000000000009';
    await expect(createPublication(authFor(db), { sourceType: 'clip', clipId: missing }))
      .rejects.toThrow('Source video not found in your CRM tenant.');
    await expect(createPublication(authFor(db), { sourceType: 'clip', clipId: 'not-a-uuid' }))
      .rejects.toThrow('Source video not found in your CRM tenant.');
  });

  it('ignores browser-supplied tenant, account and format fields', async () => {
    const db = socialDb();
    const created = await createPublication(authFor(db), {
      sourceType: 'clip', clipId: SHORT_CLIP_A,
      tenantId: TENANT_B, tenant_id: TENANT_B, accountId: 'x', content_format: 'full_episode',
    } as never);
    expect(created.tenantId).toBe(TENANT_A);
    expect(created.contentFormat).toBe('short');
    const insert = insertedPublications(db)[0].rows[0];
    expect(insert.tenant_id).toBe(TENANT_A);
  });

  it('a tenant-B caller cannot claim tenant A sources either', async () => {
    const db = socialDb();
    await expect(createPublication(authFor(db, TENANT_B), { sourceType: 'clip', clipId: SHORT_CLIP_A }))
      .rejects.toThrow('Source video not found in your CRM tenant.');
  });

  it('rejects a duplicate active publication for the same source', async () => {
    const db = socialDb();
    await createPublication(authFor(db), { sourceType: 'clip', clipId: PART_CLIP_A });
    await expect(createPublication(authFor(db), { sourceType: 'clip', clipId: PART_CLIP_A }))
      .rejects.toThrow('An active publication already exists for this source');
  });

  it('rejects a scheduled draft whose time is not in the future', async () => {
    const db = socialDb();
    await expect(createPublication(authFor(db), {
      sourceType: 'clip', clipId: SHORT_CLIP_A, deliveryMode: 'scheduled', scheduledFor: '2020-01-01T00:00:00.000Z',
    })).rejects.toThrow('at least 1 minute in the future');
  });
});

describe('Social Media Manager tenant isolation: reads and queueing', () => {
  it('cannot read, list events for, or queue another tenant\'s publication', async () => {
    const db = socialDb();
    const created = await createPublication(authFor(db), { sourceType: 'clip', clipId: SHORT_CLIP_A });
    publication(db, created.id).status = 'approved';
    const intruder = authFor(db, TENANT_B);
    await expect(getPublication(intruder, { id: created.id })).rejects.toThrow('Publication not found');
    await expect(listPublicationEvents(intruder, { id: created.id })).rejects.toThrow('Publication not found');
    await expect(queuePublish(intruder, { id: created.id })).rejects.toThrow('Publication not found');
    expect(db.table('ai_operations_video_jobs').filter((job) => job.job_type === 'publish_youtube')).toHaveLength(0);
  });
});

describe('Social Media Manager tenant isolation: playlists', () => {
  async function draft() {
    const db = socialDb();
    const created = await createPublication(authFor(db), { sourceType: 'clip', clipId: SHORT_CLIP_A });
    return { db, id: created.id };
  }
  const links = (db: ReturnType<typeof socialDb>, id: string) =>
    db.table('ai_operations_social_publication_playlists').filter((link) => link.publication_id === id);

  it('attaches an extra same-account playlist and keeps the routed default', async () => {
    const { db, id } = await draft();
    const updated = await setPublicationPlaylists(authFor(db), { id, playlistIds: [PLAYLIST_EXTRA_A] });
    expect(updated.playlists.map((p) => p.playlistId).sort()).toEqual([PLAYLIST_SHORTS_A, PLAYLIST_EXTRA_A].sort());
  });

  it('does not duplicate a playlist that is requested twice or is already linked', async () => {
    const { db, id } = await draft();
    await setPublicationPlaylists(authFor(db), { id, playlistIds: [PLAYLIST_EXTRA_A, PLAYLIST_EXTRA_A, PLAYLIST_SHORTS_A] });
    await setPublicationPlaylists(authFor(db), { id, playlistIds: [PLAYLIST_EXTRA_A] });
    expect(links(db, id)).toHaveLength(2);
  });

  it.each([
    ['a foreign-tenant playlist', PLAYLIST_B],
    ['a playlist of another YouTube account in the same tenant', PLAYLIST_OTHER_ACCOUNT_A],
    ['an inactive playlist', PLAYLIST_INACTIVE_A],
    ['an unknown playlist id', 'cccccccc-3333-4000-8000-000000000009'],
  ])('rejects %s and writes nothing', async (_label, badId) => {
    const { db, id } = await draft();
    const before = db.mutations.length;
    await expect(setPublicationPlaylists(authFor(db), { id, playlistIds: [PLAYLIST_EXTRA_A, badId] }))
      .rejects.toThrow('not available for this publication');
    expect(db.mutations.slice(before).filter((m) => m.table === 'ai_operations_social_publication_playlists')).toHaveLength(0);
    expect(links(db, id).map((link) => link.playlist_id)).toEqual([PLAYLIST_SHORTS_A]);
  });

  it('cannot change playlists on another tenant\'s publication', async () => {
    const { db, id } = await draft();
    await expect(setPublicationPlaylists(authFor(db, TENANT_B), { id, playlistIds: [PLAYLIST_B] }))
      .rejects.toThrow('Publication not found');
  });

  it('locks playlists once the worker owns the snapshot', async () => {
    const { db, id } = await draft();
    publication(db, id).status = 'upload_queued';
    await expect(setPublicationPlaylists(authFor(db), { id, playlistIds: [PLAYLIST_PARTS_A] }))
      .rejects.toThrow('Playlists are locked');
  });
});
