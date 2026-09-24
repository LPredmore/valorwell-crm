import { httpFailure, TransientYoutubeError } from '../../../supabase/functions/_shared/youtube-publish/errors';
import type { ChunkUploadResult, UploadOffset, VideoSnippetStatus, YoutubeDeliveryStatus } from '../../../supabase/functions/_shared/youtube-publish/api';
import type { PublishDriveClient, PublishYoutubeClient } from '../../../supabase/functions/video-youtube-publish-dispatcher/worker';
import type { FakeSupabase } from './fake-supabase';

type Session = { url: string; body: VideoSnippetStatus; totalBytes: number; received: number; videoId: string | null; notifySubscribers: boolean };
export type FakeVideo = {
  id: string;
  snippet: VideoSnippetStatus['snippet'];
  status: VideoSnippetStatus['status'];
  uploadStatus: string;
  processingStatus: string;
  publishedAt: string | null;
  thumbnailsSet: number;
  deleted: boolean;
};

type Method = keyof PublishYoutubeClient;

/**
 * In-memory YouTube Data API: resumable sessions that assemble uploaded bytes into videos,
 * video status, playlists and thumbnails, plus one-shot failure injection per method.
 */
export class FakeYoutube implements PublishYoutubeClient {
  sessions: Session[] = [];
  videos = new Map<string, FakeVideo>();
  playlistItems = new Map<string, string[]>();
  calls: { method: Method; args: unknown[] }[] = [];
  private failures: { method: Method; error: Error; afterEffect?: boolean }[] = [];
  /** Processing state a newly assembled video starts in. */
  processingOnCreate: 'succeeded' | 'processing' | 'failed' = 'succeeded';
  /** Simulates an unaudited API project: every upload is forced Private. */
  lockUploadsPrivate = false;
  now: () => number = () => Date.now();

  failNext(method: Method, error: Error, options: { afterEffect?: boolean } = {}) {
    this.failures.push({ method, error, afterEffect: options.afterEffect });
  }

  private enter(method: Method, args: unknown[]) {
    this.calls.push({ method, args });
    const index = this.failures.findIndex((failure) => failure.method === method && !failure.afterEffect);
    if (index >= 0) throw this.failures.splice(index, 1)[0].error;
  }

  private exit(method: Method) {
    const index = this.failures.findIndex((failure) => failure.method === method && failure.afterEffect);
    if (index >= 0) throw this.failures.splice(index, 1)[0].error;
  }

  count(method: Method) {
    return this.calls.filter((call) => call.method === method).length;
  }

  video(id?: string | null): FakeVideo {
    const video = id ? this.videos.get(id) : [...this.videos.values()][0];
    if (!video) throw new Error('no such fake video');
    return video;
  }

  async createResumableUploadSession(_token: string, body: VideoSnippetStatus, totalBytes: number, _mime: string, options: { notifySubscribers: boolean }) {
    this.enter('createResumableUploadSession', [body, totalBytes, options]);
    const url = `https://upload.fake/session-${this.sessions.length + 1}`;
    this.sessions.push({ url, body: JSON.parse(JSON.stringify(body)), totalBytes, received: 0, videoId: null, notifySubscribers: options.notifySubscribers });
    return url;
  }

  private session(url: string) {
    const session = this.sessions.find((candidate) => candidate.url === url);
    if (!session) throw httpFailure(404, 'Upload session not found');
    return session;
  }

  async queryUploadOffset(sessionUrl: string): Promise<UploadOffset> {
    this.enter('queryUploadOffset', [sessionUrl]);
    const session = this.session(sessionUrl);
    if (session.videoId) return { complete: true, videoId: session.videoId, response: { id: session.videoId } };
    return { complete: false, nextByte: session.received };
  }

  async uploadChunk(sessionUrl: string, bytes: ArrayBuffer, start: number, totalBytes: number): Promise<ChunkUploadResult> {
    this.enter('uploadChunk', [sessionUrl, bytes.byteLength, start, totalBytes]);
    const session = this.session(sessionUrl);
    if (start !== session.received) throw httpFailure(400, `Chunk starts at ${start}, expected ${session.received}`);
    session.received += bytes.byteLength;
    if (session.received < totalBytes) {
      this.exit('uploadChunk');
      return { done: false, nextByte: session.received };
    }
    const id = `vid-${this.videos.size + 1}`;
    const status = { ...session.body.status };
    if (this.lockUploadsPrivate) status.privacyStatus = 'private';
    this.videos.set(id, {
      id, snippet: session.body.snippet, status,
      uploadStatus: this.processingOnCreate === 'succeeded' ? 'processed' : this.processingOnCreate === 'failed' ? 'failed' : 'uploaded',
      processingStatus: this.processingOnCreate,
      publishedAt: status.privacyStatus === 'public' ? new Date(this.now()).toISOString() : null,
      thumbnailsSet: 0, deleted: false,
    });
    session.videoId = id;
    // afterEffect failures model "YouTube created the video but the response was lost".
    this.exit('uploadChunk');
    return { done: true, videoId: id, response: { id } };
  }

  private status(video: FakeVideo): YoutubeDeliveryStatus {
    return {
      privacyStatus: video.status.privacyStatus,
      publishAt: video.status.publishAt ?? null,
      uploadStatus: video.uploadStatus,
      processingStatus: video.processingStatus,
      rejectionReason: null,
      failureReason: video.processingStatus === 'failed' ? 'transcodeFailed' : null,
      publishedAt: video.publishedAt,
    };
  }

  async getYoutubeDeliveryStatus(_token: string, videoId: string): Promise<YoutubeDeliveryStatus> {
    this.enter('getYoutubeDeliveryStatus', [videoId]);
    const video = this.videos.get(videoId);
    if (!video || video.deleted) throw httpFailure(404, `YouTube returned no video ${videoId}`);
    return this.status(video);
  }

  /** Batched lookup used by reconciliation (not part of the worker client). */
  async getDeliveryStatuses(_token: string, videoIds: string[]) {
    const result = new Map<string, YoutubeDeliveryStatus | null>();
    for (const id of videoIds) {
      const video = this.videos.get(id);
      result.set(id, video && !video.deleted ? this.status(video) : null);
    }
    return result;
  }

  async getYoutubeThumbnailStatus(_token: string, videoId: string) {
    this.enter('getYoutubeThumbnailStatus', [videoId]);
    const video = this.video(videoId);
    return { hasCustomThumbnail: video.thumbnailsSet > 0, processingStatus: video.processingStatus, thumbnails: null };
  }

  async setThumbnail(_token: string, videoId: string) {
    this.enter('setThumbnail', [videoId]);
    this.video(videoId).thumbnailsSet += 1;
  }

  async isVideoInPlaylist(_token: string, playlistId: string, videoId: string) {
    this.enter('isVideoInPlaylist', [playlistId, videoId]);
    return (this.playlistItems.get(playlistId) ?? []).includes(videoId);
  }

  async addToPlaylist(_token: string, playlistId: string, videoId: string) {
    this.enter('addToPlaylist', [playlistId, videoId]);
    this.playlistItems.set(playlistId, [...(this.playlistItems.get(playlistId) ?? []), videoId]);
  }

  /** What YouTube does at publishAt: a scheduled Private video becomes Public. */
  releaseScheduled(at: number) {
    for (const video of this.videos.values()) {
      if (video.status.privacyStatus === 'private' && video.status.publishAt && Date.parse(video.status.publishAt) <= at) {
        video.status = { ...video.status, privacyStatus: 'public' };
        delete video.status.publishAt;
        video.publishedAt = new Date(at).toISOString();
      }
    }
  }
}

export class FakeDrive implements PublishDriveClient {
  files = new Map<string, { size: number; mimeType: string }>();
  reads: { fileId: string; start: number; end: number }[] = [];
  private failures: { fileId: string | null; error: Error }[] = [];

  constructor(files: Record<string, number> = {}) {
    for (const [id, size] of Object.entries(files)) this.files.set(id, { size, mimeType: id.includes('cover') ? 'image/png' : 'video/mp4' });
  }

  failNext(error: Error, fileId: string | null = null) {
    this.failures.push({ fileId, error });
  }

  private maybeFail(fileId: string) {
    const index = this.failures.findIndex((failure) => failure.fileId === null || failure.fileId === fileId);
    if (index >= 0) throw this.failures.splice(index, 1)[0].error;
  }

  async fileMetadata(_token: string, fileId: string) {
    this.maybeFail(fileId);
    const file = this.files.get(fileId);
    if (!file) throw httpFailure(404, `Drive metadata fetch failed (404): File not found: ${fileId}`);
    return { size: file.size, mimeType: file.mimeType, name: fileId };
  }

  async fileRange(_token: string, fileId: string, start: number, end: number) {
    this.maybeFail(fileId);
    this.reads.push({ fileId, start, end });
    return new ArrayBuffer(end - start + 1);
  }
}

export const networkError = () => new TransientYoutubeError('Network error calling YouTube: connection reset');

/**
 * JS emulation of claim_next_youtube_publish_job / release_youtube_publish_job with the
 * same eligibility, ordering and lease rules as the SQL (which is tested against Postgres
 * in social-media-publish-claim.test.ts). Calls are atomic because JS is single-threaded.
 */
export function installClaimRpcs(db: FakeSupabase, now: () => number, leaseSeconds = 600) {
  db.rpcs.claim_next_youtube_publish_job = ({ p_worker_id, p_lease_seconds }) => {
    const lease = Number(p_lease_seconds ?? leaseSeconds) * 1000;
    const pubs = db.table('ai_operations_social_publications');
    const ready = (pubId: unknown) => {
      const next = pubs.find((pub) => pub.id === pubId)?.next_attempt_at as string | null | undefined;
      return !next || Date.parse(next) <= now();
    };
    const candidates = db.table('ai_operations_video_jobs').filter((job) => {
      if (job.job_type !== 'publish_youtube') return false;
      if (job.status === 'running' || job.status === 'claimed') {
        if (!job.claimed_at) return ready(job.social_publication_id);
        return Date.parse(String(job.claimed_at)) < now() - lease;
      }
      return job.status === 'queued' && ready(job.social_publication_id);
    }).sort((a, b) => (a.status === 'queued' ? 1 : 0) - (b.status === 'queued' ? 1 : 0) ||
      String(a.created_at).localeCompare(String(b.created_at)) || Number(a.id) - Number(b.id));
    const job = candidates[0];
    if (!job) return [];
    const wasQueued = job.status === 'queued';
    const payload = { ...(job.payload as Record<string, unknown>) };
    if (!wasQueued && job.claimed_at) {
      Object.assign(payload, {
        stale_recovery_count: Number(payload.stale_recovery_count ?? 0) + 1,
        stale_recovered_at: new Date(now()).toISOString(),
        stale_recovered_from: job.claimed_by,
      });
    }
    Object.assign(job, {
      status: 'running',
      attempts: wasQueued ? Number(job.attempts ?? 0) + 1 : job.attempts,
      started_at: wasQueued ? new Date(now()).toISOString() : job.started_at ?? new Date(now()).toISOString(),
      claimed_by: p_worker_id,
      claimed_at: new Date(now()).toISOString(),
      payload,
    });
    return [JSON.parse(JSON.stringify(job))];
  };
  db.rpcs.release_youtube_publish_job = ({ p_job_id, p_worker_id }) => {
    const job = db.table('ai_operations_video_jobs').find((candidate) => candidate.id === p_job_id && candidate.claimed_by === p_worker_id);
    if (!job) return false;
    job.claimed_by = null;
    job.claimed_at = null;
    return true;
  };
}
