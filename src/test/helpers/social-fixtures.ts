import { FakeSupabase } from './fake-supabase';
import type { AuthContext } from '../../../supabase/functions/social-media-manager/context';

export const TENANT_A = '00000000-0000-0000-0000-000000000001';
export const TENANT_B = '00000000-0000-0000-0000-00000000000b';
export const ACCOUNT_A = 'aaaaaaaa-0000-4000-8000-000000000001';
export const ACCOUNT_A2 = 'aaaaaaaa-0000-4000-8000-000000000002';
export const ACCOUNT_B = 'bbbbbbbb-0000-4000-8000-000000000001';
export const PROJECT_A = 'aaaaaaaa-1111-4000-8000-000000000001';
export const PROJECT_B = 'bbbbbbbb-1111-4000-8000-000000000001';
export const SHORT_CLIP_A = 'aaaaaaaa-2222-4000-8000-000000000001';
export const PART_CLIP_A = 'aaaaaaaa-2222-4000-8000-000000000002';
export const CLIP_B = 'bbbbbbbb-2222-4000-8000-000000000001';
export const PLAYLIST_SHORTS_A = 'aaaaaaaa-3333-4000-8000-000000000001';
export const PLAYLIST_PARTS_A = 'aaaaaaaa-3333-4000-8000-000000000002';
export const PLAYLIST_EPISODES_A = 'aaaaaaaa-3333-4000-8000-000000000003';
export const PLAYLIST_EXTRA_A = 'aaaaaaaa-3333-4000-8000-000000000004';
export const PLAYLIST_INACTIVE_A = 'aaaaaaaa-3333-4000-8000-000000000005';
export const PLAYLIST_OTHER_ACCOUNT_A = 'aaaaaaaa-3333-4000-8000-000000000006';
export const PLAYLIST_B = 'bbbbbbbb-3333-4000-8000-000000000001';

const RELATIONS = [
  { from: 'ai_operations_social_publications', to: 'ai_operations_social_publication_playlists', localKey: 'id', foreignKey: 'publication_id', many: true },
  { from: 'ai_operations_social_publication_playlists', to: 'ai_operations_social_playlists', localKey: 'playlist_id', foreignKey: 'id', many: false },
  { from: 'ai_operations_video_clips', to: 'ai_operations_video_projects', localKey: 'project_id', foreignKey: 'id', many: false },
  { from: 'ai_operations_social_routing_rules', to: 'ai_operations_social_playlists', localKey: 'default_playlist_id', foreignKey: 'id', many: false },
];

const ACTIVE = ['draft', 'ready', 'approved', 'upload_queued', 'uploading', 'uploaded', 'scheduled'];

const SHORT_RENDER = {
  drive_file_id: 'drive-short-a', render_profile: 'youtube_short_9x16', render_width: 1080, render_height: 1920,
};

function playlist(id: string, tenant: string, account: string, key: string, name: string, active = true) {
  return { id, tenant_id: tenant, account_id: account, platform: 'youtube', canonical_key: key, external_playlist_id: `PL-${key}`, display_name: name, is_active: active };
}

/**
 * Builds a fake database holding two tenants' video sources, and emulates the production
 * triggers the handlers rely on: ai_ops_social_prepare_publication (derives tenant, format,
 * account and defaults from the source), ai_ops_social_attach_default_playlist (routing),
 * the active-source unique indexes, and the status_changed audit trigger.
 */
export function socialDb() {
  const db = new FakeSupabase({
    relations: RELATIONS,
    tables: {
      ai_operations_social_accounts: [
        { id: ACCOUNT_A, tenant_id: TENANT_A, platform: 'youtube', is_default: true, auth_status: 'connected', external_account_id: 'UC-A', display_name: 'ValorWell', last_verified_at: '2026-09-20T00:00:00.000Z', created_at: '2026-01-01' },
        { id: ACCOUNT_A2, tenant_id: TENANT_A, platform: 'youtube', is_default: false, auth_status: 'connected', external_account_id: 'UC-A2', display_name: 'Second', created_at: '2026-01-02' },
        { id: ACCOUNT_B, tenant_id: TENANT_B, platform: 'youtube', is_default: true, auth_status: 'connected', external_account_id: 'UC-B', display_name: 'Other org', created_at: '2026-01-01' },
      ],
      ai_operations_social_settings: [
        { account_id: ACCOUNT_A, tenant_id: TENANT_A, timezone: 'America/Chicago', default_notify_subscribers: false, default_immediate_privacy_status: 'public' },
      ],
      ai_operations_video_projects: [
        { id: PROJECT_A, tenant_id: TENANT_A, guest_name: 'Guest A', organization_name: 'Org A', duration_seconds: 3600, source_file_id: 'drive-episode-a', source_file_name: 'episode-a.mp4', source_web_url: null, status: 'ready', cover_image_file_id: 'drive-cover-episode-a', cover_image_url: 'https://drive/cover-a', created_at: '2026-09-01' },
        { id: PROJECT_B, tenant_id: TENANT_B, guest_name: 'Secret guest', organization_name: 'Other org', duration_seconds: 1200, source_file_id: 'drive-episode-b', source_file_name: 'b.mp4', source_web_url: null, status: 'ready', cover_image_file_id: null, cover_image_url: null, created_at: '2026-09-01' },
      ],
      ai_operations_video_clips: [
        { id: SHORT_CLIP_A, project_id: PROJECT_A, clip_type: 'short', youtube_title: 'Short A', youtube_description: 'desc', hashtags: ['#bty'], cover_image_file_id: 'drive-cover-short-a', cover_image_url: 'https://drive/short-a', start_seconds: 0, end_seconds: 45, drive_file_id: 'drive-short-a', drive_file_url: null, status: 'rendered', created_at: '2026-09-02' },
        { id: PART_CLIP_A, project_id: PROJECT_A, clip_type: 'part', youtube_title: 'Part A', youtube_description: 'part', hashtags: [], cover_image_file_id: 'drive-cover-part-a', cover_image_url: 'https://drive/part-a', start_seconds: 0, end_seconds: 900, drive_file_id: 'drive-part-a', drive_file_url: null, status: 'rendered', created_at: '2026-09-03' },
        { id: CLIP_B, project_id: PROJECT_B, clip_type: 'short', youtube_title: 'Other tenant short', youtube_description: 'private', hashtags: [], cover_image_file_id: null, cover_image_url: null, start_seconds: 0, end_seconds: 30, drive_file_id: 'drive-b', drive_file_url: null, status: 'rendered', created_at: '2026-09-02' },
      ],
      ai_operations_video_jobs: [
        { id: 1, tenant_id: TENANT_A, project_id: PROJECT_A, clip_id: SHORT_CLIP_A, job_type: 'render_clip', status: 'complete', payload: SHORT_RENDER, completed_at: '2026-09-02T00:00:00Z', created_at: '2026-09-02', attempts: 1 },
      ],
      ai_operations_social_playlists: [
        playlist(PLAYLIST_SHORTS_A, TENANT_A, ACCOUNT_A, 'bty_shorts', 'BTY Shorts'),
        playlist(PLAYLIST_PARTS_A, TENANT_A, ACCOUNT_A, 'bty_parts', 'Beyond The Yellow - Parts'),
        playlist(PLAYLIST_EPISODES_A, TENANT_A, ACCOUNT_A, 'bty_full', 'Beyond The Yellow - Full Episodes'),
        playlist(PLAYLIST_EXTRA_A, TENANT_A, ACCOUNT_A, 'highlights', 'Highlights'),
        playlist(PLAYLIST_INACTIVE_A, TENANT_A, ACCOUNT_A, 'retired', 'Retired', false),
        playlist(PLAYLIST_OTHER_ACCOUNT_A, TENANT_A, ACCOUNT_A2, 'second', 'Second channel list'),
        playlist(PLAYLIST_B, TENANT_B, ACCOUNT_B, 'b', 'Other org playlist'),
      ],
      ai_operations_social_routing_rules: [
        { id: 'r1', tenant_id: TENANT_A, account_id: ACCOUNT_A, platform: 'youtube', source_type: 'clip', source_clip_type: 'short', content_format: 'short', default_playlist_id: PLAYLIST_SHORTS_A, priority: 1, enabled: true },
        { id: 'r2', tenant_id: TENANT_A, account_id: ACCOUNT_A, platform: 'youtube', source_type: 'clip', source_clip_type: 'part', content_format: 'long_form', default_playlist_id: PLAYLIST_PARTS_A, priority: 1, enabled: true },
        { id: 'r3', tenant_id: TENANT_A, account_id: ACCOUNT_A, platform: 'youtube', source_type: 'project', source_clip_type: null, content_format: 'full_episode', default_playlist_id: PLAYLIST_EPISODES_A, priority: 1, enabled: true },
      ],
      ai_operations_social_publications: [],
      ai_operations_social_publication_playlists: [],
      ai_operations_social_publication_events: [],
    },
  });

  const events = () => db.table('ai_operations_social_publication_events');

  db.triggers.ai_operations_social_publications = {
    beforeInsert: (row, fake) => {
      let tenant: unknown;
      if (row.source_type === 'clip') {
        const clip = fake.table('ai_operations_video_clips').find((c) => c.id === row.clip_id);
        if (!clip) throw new Error(`clip ${row.clip_id} does not exist`);
        const project = fake.table('ai_operations_video_projects').find((p) => p.id === clip.project_id)!;
        tenant = project.tenant_id;
        Object.assign(row, {
          project_id: clip.project_id,
          content_format: clip.clip_type === 'short' ? 'short' : 'long_form',
          title: row.title ?? clip.youtube_title,
          description: row.description ?? clip.youtube_description ?? '',
          hashtags: row.hashtags ?? clip.hashtags ?? [],
          thumbnail_file_id: row.thumbnail_file_id ?? clip.cover_image_file_id,
          thumbnail_url: row.thumbnail_url ?? clip.cover_image_url,
        });
      } else {
        const project = fake.table('ai_operations_video_projects').find((p) => p.id === row.project_id);
        if (!project) throw new Error(`project ${row.project_id} does not exist`);
        tenant = project.tenant_id;
        Object.assign(row, {
          clip_id: null, content_format: 'full_episode', description: row.description ?? '',
          thumbnail_file_id: row.thumbnail_file_id ?? project.cover_image_file_id,
          thumbnail_url: row.thumbnail_url ?? project.cover_image_url,
        });
      }
      const account = fake.table('ai_operations_social_accounts').find((a) => a.tenant_id === tenant && a.is_default);
      if (!account) throw new Error(`No default youtube social account configured for tenant ${tenant}`);
      const settings = fake.table('ai_operations_social_settings').find((s) => s.account_id === account.id);
      const duplicate = fake.table('ai_operations_social_publications').some((p) =>
        p.account_id === account.id && ACTIVE.includes(String(p.status)) &&
        (row.clip_id ? p.clip_id === row.clip_id : p.source_type === 'project' && p.project_id === row.project_id));
      if (duplicate) throw new Error('duplicate key value violates unique constraint "ai_operations_social_publications_active_clip_uidx"');
      Object.assign(row, {
        tenant_id: tenant, account_id: account.id, platform: 'youtube', status: row.status ?? 'draft',
        desired_privacy_status: row.desired_privacy_status ?? settings?.default_immediate_privacy_status ?? 'public',
        notify_subscribers: settings?.default_notify_subscribers ?? true,
        tags: row.tags ?? [], category_id: '29', category_name: 'Nonprofits & Activism', default_language: 'en',
        license: 'youtube', made_for_kids: false, contains_synthetic_media: false, embeddable: true, public_stats_viewable: true,
        platform_payload: {}, platform_response: {}, attempt_count: 0, external_video_id: null, external_url: null,
        scheduled_for: row.scheduled_for ?? null, updated_at: row.created_at,
      });
      return row;
    },
    afterInsert: (row, fake) => {
      const clipType = row.source_type === 'clip' ? fake.table('ai_operations_video_clips').find((c) => c.id === row.clip_id)?.clip_type : null;
      const rule = fake.table('ai_operations_social_routing_rules').find((r) =>
        r.tenant_id === row.tenant_id && r.account_id === row.account_id && r.source_type === row.source_type &&
        (row.source_type === 'clip' ? r.source_clip_type === clipType : r.source_clip_type === null) && r.enabled);
      if (rule) fake.table('ai_operations_social_publication_playlists').push({ publication_id: row.id, playlist_id: rule.default_playlist_id, is_default: true });
      events().push({ id: fake.nextSerial(), tenant_id: row.tenant_id, publication_id: row.id, event_type: 'created', to_status: row.status, detail: {}, created_at: new Date().toISOString() });
    },
    afterUpdate: (before, after, fake) => {
      if (before.status !== after.status) {
        events().push({ id: fake.nextSerial(), tenant_id: after.tenant_id, publication_id: after.id, event_type: 'status_changed', from_status: before.status, to_status: after.status, detail: {}, created_at: new Date().toISOString() });
      }
    },
  };
  db.triggers.ai_operations_social_publication_events = {
    beforeInsert: (row, fake) => ({ ...row, id: fake.nextSerial() }),
  };

  // Mirrors public.social_queue_publish (20260922190000).
  db.rpcs.social_queue_publish = ({ p_publication_id }, fake) => {
    const pub = fake.table('ai_operations_social_publications').find((p) => p.id === p_publication_id);
    if (!pub) throw new Error(`Publication ${p_publication_id} does not exist`);
    if (pub.status !== 'approved') throw new Error(`Publication must be approved before it can be queued (current status: ${pub.status})`);
    const jobs = fake.table('ai_operations_video_jobs');
    if (jobs.some((j) => j.social_publication_id === pub.id && j.job_type === 'publish_youtube' && ['queued', 'claimed', 'running'].includes(String(j.status)))) {
      throw new Error(`Publication ${pub.id} already has an active publish job`);
    }
    const id = fake.nextSerial();
    jobs.push({ id, tenant_id: pub.tenant_id, project_id: pub.project_id, clip_id: pub.clip_id, job_type: 'publish_youtube', status: 'queued', social_publication_id: pub.id, payload: {}, attempts: 0, created_at: new Date().toISOString() });
    events().push({ id: fake.nextSerial(), tenant_id: pub.tenant_id, publication_id: pub.id, event_type: 'status_changed', from_status: pub.status, to_status: 'upload_queued', detail: {}, created_at: new Date().toISOString() });
    pub.status = 'upload_queued';
    return id;
  };

  return db;
}

export function authFor(db: FakeSupabase, tenantId = TENANT_A, mutate = true): AuthContext {
  return {
    userId: 'profile-1',
    tenantId,
    crmRole: mutate ? 'crm_admin' : 'crm_readonly',
    capabilities: { mutate, communicate: false, manage_campaigns: false, report: false },
    db: db as unknown as AuthContext['db'],
  };
}

export function publication(db: FakeSupabase, id: string) {
  return db.table('ai_operations_social_publications').find((p) => p.id === id) as Record<string, unknown>;
}
