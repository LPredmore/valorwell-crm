// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Runs the real claim/release migration against an embedded Postgres. PGlite is a single
 * connection, so these cases pin down the claim rules; true parallel contention on
 * FOR UPDATE SKIP LOCKED was additionally exercised against Postgres 16 (see
 * docs/social-media-manager-architecture.md, "Atomic job claiming").
 */
const root = resolve(__dirname, '../..');
const fixture = readFileSync(resolve(root, 'src/test/sql/social-publish-claim-fixture.sql'), 'utf8');
const migration = readFileSync(resolve(root, 'supabase/migrations/20260924131110_social_media_atomic_publish_claim.sql'), 'utf8');

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(fixture);
  await db.exec(migration);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec('truncate public.ai_operations_video_jobs, public.ai_operations_social_publications restart identity cascade');
});

type JobRow = { id: number; status: string; attempts: number; claimed_by: string | null; payload: Record<string, unknown> };

async function queueJob(options: { status?: string; createdMinutesAgo?: number; nextAttemptInMinutes?: number | null; claimedMinutesAgo?: number | null; claimedBy?: string | null; payload?: Record<string, unknown> } = {}) {
  const pub = await db.query<{ id: string }>(
    `insert into public.ai_operations_social_publications (id, next_attempt_at)
     values (gen_random_uuid(), case when $1::int is null then null else now() + make_interval(mins => $1::int) end) returning id`,
    [options.nextAttemptInMinutes ?? null],
  );
  const job = await db.query<{ id: number }>(
    `insert into public.ai_operations_video_jobs (job_type, status, social_publication_id, created_at, claimed_by, claimed_at, payload)
     values ('publish_youtube', $1, $2, now() - make_interval(mins => $3::int), $4,
             case when $5::int is null then null else now() - make_interval(mins => $5::int) end, $6::jsonb)
     returning id`,
    [options.status ?? 'queued', pub.rows[0].id, options.createdMinutesAgo ?? 0, options.claimedBy ?? null, options.claimedMinutesAgo ?? null, JSON.stringify(options.payload ?? {})],
  );
  return Number(job.rows[0].id);
}

async function claim(worker: string, leaseSeconds = 600): Promise<JobRow | null> {
  const result = await db.query<JobRow>('select * from public.claim_next_youtube_publish_job($1, $2)', [worker, leaseSeconds]);
  return result.rows[0] ? { ...result.rows[0], id: Number(result.rows[0].id) } : null;
}

async function release(jobId: number, worker: string) {
  const result = await db.query<{ release_youtube_publish_job: boolean }>('select public.release_youtube_publish_job($1, $2)', [jobId, worker]);
  return result.rows[0].release_youtube_publish_job;
}

describe('claim_next_youtube_publish_job', () => {
  it('claims the oldest queued job, marks it running, increments attempts and records the lease', async () => {
    const newer = await queueJob({ createdMinutesAgo: 1 });
    const older = await queueJob({ createdMinutesAgo: 5 });
    const job = await claim('worker-1');
    expect(job?.id).toBe(older);
    expect(job?.status).toBe('running');
    expect(job?.attempts).toBe(1);
    expect(job?.claimed_by).toBe('worker-1');
    expect(newer).not.toBe(older);
  });

  it('never hands the same job to two workers', async () => {
    await queueJob();
    expect(await claim('worker-1')).not.toBeNull();
    expect(await claim('worker-2')).toBeNull();
  });

  it('gives successive workers different jobs', async () => {
    await queueJob({ createdMinutesAgo: 3 });
    await queueJob({ createdMinutesAgo: 2 });
    const first = await claim('worker-1');
    const second = await claim('worker-2');
    expect(first?.id).not.toBe(second?.id);
    expect(await claim('worker-3')).toBeNull();
  });

  it('returns nothing when no job is available', async () => {
    expect(await claim('worker-1')).toBeNull();
  });

  it('skips a queued job whose publication is backing off, and claims it once the backoff passes', async () => {
    await queueJob({ nextAttemptInMinutes: 10 });
    expect(await claim('worker-1')).toBeNull();
    await db.exec('update public.ai_operations_social_publications set next_attempt_at = now() - interval \'1 second\'');
    expect(await claim('worker-1')).not.toBeNull();
  });

  it('resumes a released in-flight job before starting new work, without counting a new attempt', async () => {
    const inFlight = await queueJob({ createdMinutesAgo: 1 });
    const first = await claim('worker-1');
    expect(first?.id).toBe(inFlight);
    await queueJob({ createdMinutesAgo: 30 });
    expect(await release(inFlight, 'worker-1')).toBe(true);

    const resumed = await claim('worker-2');
    expect(resumed?.id).toBe(inFlight);
    expect(resumed?.attempts).toBe(1);
    expect(resumed?.payload.stale_recovery_count).toBeUndefined();
  });

  it('lets a released job that is polling YouTube yield the queue until its next check', async () => {
    const waiting = await queueJob({ status: 'running', createdMinutesAgo: 30, nextAttemptInMinutes: 2 });
    const queued = await queueJob({ createdMinutesAgo: 1 });
    expect((await claim('worker-1'))?.id).toBe(queued);
    await db.exec(`update public.ai_operations_social_publications set next_attempt_at = now() - interval '1 second'`);
    expect((await claim('worker-2'))?.id).toBe(waiting);
  });

  it('recovers a crashed holder even while its publication is waiting', async () => {
    const stale = await queueJob({ status: 'running', claimedBy: 'crashed', claimedMinutesAgo: 30, nextAttemptInMinutes: 5 });
    expect((await claim('worker-1'))?.id).toBe(stale);
  });

  it('does not take over a job whose lease is still live', async () => {
    await queueJob({ status: 'running', claimedBy: 'worker-1', claimedMinutesAgo: 2 });
    expect(await claim('worker-2')).toBeNull();
  });

  it('recovers a stale lease, preserving the upload session and counting the recovery', async () => {
    const stale = await queueJob({
      status: 'running', claimedBy: 'crashed-worker', claimedMinutesAgo: 30,
      payload: { upload_session_url: 'https://upload.example/session-1', bytes_uploaded: 1024 },
    });
    const recovered = await claim('worker-2');
    expect(recovered?.id).toBe(stale);
    expect(recovered?.claimed_by).toBe('worker-2');
    expect(recovered?.attempts).toBe(0);
    expect(recovered?.payload.upload_session_url).toBe('https://upload.example/session-1');
    expect(recovered?.payload.stale_recovery_count).toBe(1);
    expect(recovered?.payload.stale_recovered_from).toBe('crashed-worker');
  });

  it('fences release on the lease holder', async () => {
    const job = await queueJob();
    await claim('worker-1');
    expect(await release(job, 'worker-2')).toBe(false);
    expect(await claim('worker-3')).toBeNull();
    expect(await release(job, 'worker-1')).toBe(true);
  });

  it('ignores finished, cancelled and non-publish jobs', async () => {
    await queueJob({ status: 'complete' });
    await queueJob({ status: 'cancelled' });
    await queueJob({ status: 'error' });
    await db.exec(`insert into public.ai_operations_video_jobs (job_type, status) values ('render_clip', 'queued')`);
    expect(await claim('worker-1')).toBeNull();
  });

  it('rejects a blank worker id and an unsafe lease', async () => {
    await expect(db.query('select * from public.claim_next_youtube_publish_job($1, 600)', [' '])).rejects.toThrow('p_worker_id is required');
    await expect(db.query('select * from public.claim_next_youtube_publish_job($1, 5)', ['w'])).rejects.toThrow('at least 60');
  });
});
