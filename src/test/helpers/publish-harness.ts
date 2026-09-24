import {
  approvePublication, createPublication, queuePublish, updatePublication,
} from '../../../supabase/functions/social-media-manager/handlers/publications';
import { runPublishTick, type PublishWorkerDeps, type TickResult } from '../../../supabase/functions/video-youtube-publish-dispatcher/worker';
import { reconcileScheduledPublications } from '../../../supabase/functions/_shared/youtube-publish/reconciliation';
import { FakeDrive, FakeYoutube, installClaimRpcs } from './fake-youtube';
import { authFor, PART_CLIP_A, PROJECT_A, publication, SHORT_CLIP_A, socialDb } from './social-fixtures';

export const MB = 1024 * 1024;

export type Mode = 'private' | 'unlisted' | 'public' | 'scheduled';
export type Source = 'short' | 'part' | 'episode';

const TERMINAL = new Set(['uploaded', 'scheduled', 'published', 'failed', 'cancelled']);

/** A CRM + worker + fake YouTube/Drive world with a controllable clock. */
export function publishHarness() {
  const db = socialDb();
  // Starts at the real wall clock: CRM handlers validate schedules against Date.now().
  let clock = Math.floor(Date.now() / 60_000) * 60_000;
  const now = () => clock;
  installClaimRpcs(db, now);
  const youtube = new FakeYoutube();
  youtube.now = now;
  const drive = new FakeDrive({
    'drive-short-a': 5 * MB,
    'drive-part-a': 70 * MB,
    'drive-episode-a': 40 * MB,
    'drive-cover-short-a': 2048,
    'drive-cover-part-a': 2048,
    'drive-cover-episode-a': 2048,
  });
  const auth = authFor(db);
  const logs: { event: string; detail: Record<string, unknown> }[] = [];

  const deps = (workerId = 'worker-1'): PublishWorkerDeps => ({
    db: db as unknown as PublishWorkerDeps['db'],
    workerId,
    now,
    youtubeToken: async () => 'yt-token',
    driveToken: async () => 'drive-token',
    youtube,
    drive,
    log: (event, detail) => logs.push({ event, detail }),
  });

  async function prepare(source: Source, mode: Mode, options: { scheduledFor?: string; skipQueue?: boolean } = {}) {
    const created = source === 'episode'
      ? await createPublication(auth, { sourceType: 'project', projectId: PROJECT_A })
      : await createPublication(auth, { sourceType: 'clip', clipId: source === 'short' ? SHORT_CLIP_A : PART_CLIP_A });
    const changes: Record<string, unknown> = mode === 'scheduled'
      ? { deliveryMode: 'scheduled', desiredPrivacyStatus: 'public', scheduledFor: options.scheduledFor ?? new Date(clock + 30 * 60_000).toISOString() }
      : { deliveryMode: 'immediate', desiredPrivacyStatus: mode, scheduledFor: null };
    if (source === 'episode') changes.title = 'Beyond The Yellow: Full Episode';
    await updatePublication(auth, { id: created.id, changes });
    await approvePublication(auth, { id: created.id });
    if (!options.skipQueue) await queuePublish(auth, { id: created.id });
    return created.id;
  }

  async function tick(workerId = 'worker-1'): Promise<TickResult> {
    const result = await runPublishTick(deps(workerId));
    clock += 60_000;
    return result;
  }

  /** Runs dispatcher ticks (one per simulated minute) until the publication settles. */
  async function drain(id: string, maxTicks = 40): Promise<TickResult[]> {
    const results: TickResult[] = [];
    for (let i = 0; i < maxTicks; i += 1) {
      const pub = publication(db, id);
      const activeJob = db.table('ai_operations_video_jobs').some((job) =>
        job.social_publication_id === id && job.job_type === 'publish_youtube' && ['queued', 'running', 'claimed'].includes(String(job.status)));
      if (TERMINAL.has(String(pub.status)) && !activeJob) break;
      results.push(await tick());
    }
    return results;
  }

  function reconcile() {
    return reconcileScheduledPublications({
      db: db as unknown as PublishWorkerDeps['db'],
      now,
      youtubeToken: async () => 'yt-token',
      getDeliveryStatuses: (token, ids) => youtube.getDeliveryStatuses(token, ids),
    });
  }

  const jobsFor = (id: string) => db.table('ai_operations_video_jobs').filter((job) => job.social_publication_id === id);
  const eventsFor = (id: string) => db.table('ai_operations_social_publication_events').filter((event) => event.publication_id === id);

  return {
    db, youtube, drive, auth, logs, deps, prepare, tick, drain, reconcile, jobsFor, eventsFor,
    pub: (id: string) => publication(db, id),
    now,
    advance: (ms: number) => { clock += ms; },
    setClock: (ms: number) => { clock = ms; },
  };
}
