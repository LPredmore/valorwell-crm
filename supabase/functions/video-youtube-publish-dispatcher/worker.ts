/**
 * One dispatcher tick of the YouTube publish worker: atomically claim one publish_youtube
 * job, advance it by one step, and release the claim. All I/O (database, YouTube, Drive,
 * clock) is injected so the full publishing contract can be exercised in tests.
 *
 * Duplicate-upload guarantees, in order of defence:
 *   1. claim_next_youtube_publish_job hands a job to exactly one live worker (lease).
 *   2. The resumable session URL is persisted before any byte is sent, fenced on the
 *      lease; a resumed job asks YouTube for the authoritative offset first.
 *   3. A session YouTube reports complete yields the created video id, never a re-upload.
 *   4. Once external_video_id is stored the job only runs finishing steps -- videos.insert
 *      is unreachable for that publication, and a unique index backs this in the database.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";
import { isVerifiedCurrentShortRender } from "../_shared/short-render-profile.ts";
import {
  buildYoutubeStatus, type ChunkUploadResult, type UploadOffset, type VideoSnippetStatus, type YoutubeDeliveryStatus,
} from "../_shared/youtube-publish/api.ts";
import {
  classifyPublishFailure, PermanentYoutubeError, retryDelayMs, safeError,
} from "../_shared/youtube-publish/errors.ts";
import {
  thumbnailProcessingDecision, verifyImmediateDelivery, verifyScheduledDelivery,
} from "../_shared/youtube-publish/status.ts";

type Db = SupabaseClient;
type Job = Record<string, unknown>;
type Publication = Record<string, unknown>;

export type PublishYoutubeClient = {
  createResumableUploadSession(token: string, body: VideoSnippetStatus, totalBytes: number, mimeType: string, options: { notifySubscribers: boolean }): Promise<string>;
  queryUploadOffset(sessionUrl: string, totalBytes: number): Promise<UploadOffset>;
  uploadChunk(sessionUrl: string, bytes: ArrayBuffer, start: number, totalBytes: number): Promise<ChunkUploadResult>;
  getYoutubeDeliveryStatus(token: string, videoId: string): Promise<YoutubeDeliveryStatus>;
  getYoutubeThumbnailStatus(token: string, videoId: string): Promise<{ hasCustomThumbnail: boolean | null; processingStatus: string | null; thumbnails: Record<string, { url?: string }> | null }>;
  setThumbnail(token: string, videoId: string, bytes: ArrayBuffer, mimeType: string): Promise<void>;
  isVideoInPlaylist(token: string, playlistId: string, videoId: string): Promise<boolean>;
  addToPlaylist(token: string, playlistId: string, videoId: string): Promise<void>;
};

export type PublishDriveClient = {
  fileMetadata(token: string, fileId: string): Promise<{ size: number; mimeType: string; name: string }>;
  fileRange(token: string, fileId: string, start: number, end: number): Promise<ArrayBuffer>;
};

export type PublishWorkerDeps = {
  db: Db;
  workerId: string;
  now: () => number;
  youtubeToken: () => Promise<string>;
  driveToken: () => Promise<string>;
  youtube: PublishYoutubeClient;
  drive: PublishDriveClient;
  log?: (event: string, detail: Record<string, unknown>) => void;
  chunkBytes?: number;
};

export type TickResult = Record<string, unknown> & { ok: boolean; action: string };

/** A live lease is never taken over for this long; a longer silence means the holder died. */
export const PUBLISH_LEASE_SECONDS = 600;
/** Takeovers of a crashed holder's lease allowed before the job needs a human. */
export const MAX_STALE_RECOVERIES = 3;
const CHUNK_BYTES = 32 * 1024 * 1024; // a multiple of 256KB, as YouTube's resumable protocol requires
/** How long a job waiting on YouTube processing yields the queue to other work. */
export const PROCESSING_POLL_MS = 2 * 60 * 1000;

/** The worker's lease was taken over (it stalled past PUBLISH_LEASE_SECONDS); stop without writing. */
class LeaseLostError extends Error {}

type Ctx = PublishWorkerDeps & { job: Job; pub: Publication; nowIso: () => string };

async function insertEvent(ctx: Ctx, eventType: string, detail: Record<string, unknown> = {}) {
  const { error } = await ctx.db.from("ai_operations_social_publication_events").insert({
    tenant_id: ctx.pub.tenant_id, publication_id: ctx.pub.id, event_type: eventType, detail,
  });
  if (error) ctx.log?.("event_insert_failed", { eventType, error: error.message });
}

/** Writes to the job only while this worker still holds its lease. */
async function updateLeasedJob(ctx: Ctx, patch: Record<string, unknown>) {
  const { data, error } = await ctx.db.from("ai_operations_video_jobs")
    .update(patch)
    .eq("id", ctx.job.id as number)
    .eq("claimed_by", ctx.workerId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new LeaseLostError(`Lease on job ${ctx.job.id} was lost.`);
}

async function updatePublication(ctx: Ctx, patch: Record<string, unknown>) {
  const { error } = await ctx.db.from("ai_operations_social_publications").update(patch).eq("id", ctx.pub.id as string);
  if (error) throw new Error(error.message);
  Object.assign(ctx.pub, patch);
}

/** Yields the queue while YouTube finishes asynchronous work; the claim RPC skips the job until then. */
async function waitForYoutube(ctx: Ctx, result: TickResult): Promise<TickResult> {
  const nextAttemptAt = new Date(ctx.now() + PROCESSING_POLL_MS).toISOString();
  await updatePublication(ctx, { next_attempt_at: nextAttemptAt });
  return { ...result, nextCheckAt: nextAttemptAt };
}

function jobPayload(ctx: Ctx): Record<string, unknown> {
  return (ctx.job.payload ?? {}) as Record<string, unknown>;
}

async function saveJobPayload(ctx: Ctx, payload: Record<string, unknown>) {
  await updateLeasedJob(ctx, { payload });
  ctx.job.payload = payload;
}

function platformPayload(ctx: Ctx): Record<string, unknown> {
  return { ...((ctx.pub.platform_payload ?? {}) as Record<string, unknown>) };
}

async function savePlatformPayloadKey(ctx: Ctx, key: string, value: unknown, extra: Record<string, unknown> = {}) {
  await updatePublication(ctx, { platform_payload: { ...platformPayload(ctx), [key]: value }, ...extra });
}

function buildDescriptionWithHashtags(description: string, hashtags: string[]): string {
  if (!hashtags.length) return description;
  const alreadyPresent = hashtags.every((tag) => description.includes(tag));
  if (alreadyPresent) return description;
  const block = hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ");
  return description ? `${description}\n\n${block}` : block;
}

async function resolveSourceFileId(ctx: Ctx): Promise<string> {
  const { db, pub } = ctx;
  if (pub.source_type === "clip") {
    const { data, error } = await db.from("ai_operations_video_clips").select("drive_file_id").eq("id", pub.clip_id as string).maybeSingle();
    if (error || !data?.drive_file_id) throw new PermanentYoutubeError("Source clip has no rendered Drive file.");
    return data.drive_file_id as string;
  }
  const { data, error } = await db.from("ai_operations_video_projects").select("source_file_id").eq("id", pub.project_id as string).maybeSingle();
  if (error || !data?.source_file_id) throw new PermanentYoutubeError("Source project has no Drive file.");
  return data.source_file_id as string;
}

async function assertShortRenderProfile(ctx: Ctx) {
  const { db, pub } = ctx;
  if (pub.content_format !== "short" || pub.source_type !== "clip" || !pub.clip_id) return;

  const { data, error } = await db
    .from("ai_operations_video_jobs")
    .select("payload,status,completed_at")
    .eq("job_type", "render_clip")
    .eq("clip_id", pub.clip_id as string)
    .eq("status", "complete")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new PermanentYoutubeError(`Could not verify the Short render profile: ${error.message}`);
  const payload = (data?.payload ?? {}) as Record<string, unknown>;
  // A correct profile on an older render is not proof that the CURRENT Drive
  // object is vertical. Match the artifact id to the source file being uploaded.
  const { data: currentClip, error: clipError } = await db
    .from("ai_operations_video_clips")
    .select("drive_file_id")
    .eq("id", pub.clip_id as string)
    .maybeSingle();
  if (clipError || !currentClip?.drive_file_id) {
    throw new PermanentYoutubeError("Could not verify the current Short file.");
  }

  if (!isVerifiedCurrentShortRender(payload, currentClip.drive_file_id)) {
    throw new PermanentYoutubeError("Short upload blocked: the rendered media is not verified as 1080x1920 (9:16). Re-render the clip before publishing.");
  }
}

/** Stores the created video id before anything else can fail: this is the idempotency key. */
async function recordCreatedVideo(ctx: Ctx, videoId: string, response: Record<string, unknown> | null, recoveredFromSession: boolean): Promise<TickResult> {
  const { data, error } = await ctx.db.from("ai_operations_social_publications").update({
    external_video_id: videoId,
    external_url: `https://www.youtube.com/watch?v=${videoId}`,
    uploaded_at: ctx.nowIso(),
    platform_response: response ?? {},
  }).eq("id", ctx.pub.id as string).is("external_video_id", null).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new PermanentYoutubeError("A different YouTube video id is already recorded for this publication. Manual reconciliation required.");
  await insertEvent(ctx, "youtube_video_created", { videoId, recoveredFromSession });
  return { ok: true, action: "video_created", publicationId: ctx.pub.id, videoId, recoveredFromSession };
}

async function runUploadStage(ctx: Ctx): Promise<TickResult> {
  const { pub } = ctx;
  await assertShortRenderProfile(ctx);
  const payload = { ...jobPayload(ctx) };

  const driveToken = await ctx.driveToken();
  let fileId = payload.drive_file_id as string | undefined;
  let totalBytes = payload.total_bytes as number | undefined;
  let mimeType = payload.mime_type as string | undefined;

  if (!fileId || !totalBytes) {
    fileId = await resolveSourceFileId(ctx);
    const meta = await ctx.drive.fileMetadata(driveToken, fileId);
    if (!meta.size) throw new PermanentYoutubeError("Source Drive file has no known size.");
    totalBytes = meta.size;
    mimeType = meta.mimeType || "video/mp4";
    Object.assign(payload, { drive_file_id: fileId, total_bytes: totalBytes, mime_type: mimeType });
    await saveJobPayload(ctx, payload);
  }

  let sessionUrl = payload.upload_session_url as string | undefined;
  if (!sessionUrl) {
    const youtubeToken = await ctx.youtubeToken();
    const body: VideoSnippetStatus = {
      snippet: {
        title: String(pub.title ?? "").slice(0, 100),
        description: buildDescriptionWithHashtags(String(pub.description ?? ""), (pub.hashtags as string[]) ?? []),
        tags: (pub.tags as string[]) ?? [],
        categoryId: String(pub.category_id ?? "29"),
        defaultLanguage: String(pub.default_language ?? "en"),
      },
      // Scheduled publications upload Private with YouTube's native publishAt.
      status: buildYoutubeStatus(pub),
    };
    sessionUrl = await ctx.youtube.createResumableUploadSession(youtubeToken, body, totalBytes, mimeType ?? "video/mp4", {
      notifySubscribers: pub.notify_subscribers !== false,
    });
    // Persist before sending a byte, fenced on the lease: a later tick resumes this exact
    // session instead of opening a second one.
    Object.assign(payload, { upload_session_url: sessionUrl, upload_session_created_at: ctx.nowIso() });
    await saveJobPayload(ctx, payload);
    await insertEvent(ctx, "youtube_upload_session_created", { totalBytes, notifySubscribers: pub.notify_subscribers !== false });
  }

  // YouTube's own reported offset is authoritative -- never trust our own bytes_uploaded
  // bookkeeping across a job restart or a stale-lease takeover.
  const offset = await ctx.youtube.queryUploadOffset(sessionUrl, totalBytes);
  if (!("nextByte" in offset)) {
    if (offset.videoId) return await recordCreatedVideo(ctx, offset.videoId, offset.response, true);
    throw new PermanentYoutubeError("Upload session reports complete but YouTube returned no video id. Manual reconciliation required in YouTube Studio; no new upload was attempted.");
  }

  const nextByte = offset.nextByte;
  const chunkEnd = Math.min(nextByte + (ctx.chunkBytes ?? CHUNK_BYTES), totalBytes) - 1;
  const bytes = await ctx.drive.fileRange(driveToken, fileId, nextByte, chunkEnd);
  const result = await ctx.youtube.uploadChunk(sessionUrl, bytes, nextByte, totalBytes);

  if ("nextByte" in result) {
    await saveJobPayload(ctx, { ...payload, bytes_uploaded: result.nextByte });
    return { ok: true, action: "chunk_uploaded", publicationId: pub.id, bytesUploaded: result.nextByte, totalBytes };
  }
  return await recordCreatedVideo(ctx, result.videoId, result.response, false);
}

function deliveryEvidence(actual: YoutubeDeliveryStatus, state: string, checkedAt: string, reason: string | null) {
  return {
    state,
    privacyStatus: actual.privacyStatus,
    publishAt: actual.publishAt,
    uploadStatus: actual.uploadStatus,
    processingStatus: actual.processingStatus,
    rejectionReason: actual.rejectionReason,
    failureReason: actual.failureReason,
    checkedAt,
    reason,
  };
}

async function runVerifyOnly(ctx: Ctx, youtubeToken: string, videoId: string): Promise<TickResult> {
  // Read-only diagnostic for an already published video. It never inserts or
  // re-uploads a video, changes visibility, or changes playlists.
  const payload = jobPayload(ctx);
  const verification = await ctx.youtube.getYoutubeThumbnailStatus(youtubeToken, videoId);
  const existing = platformPayload(ctx).thumbnail;
  const oldThumbnail = existing && typeof existing === "object" ? existing as Record<string, unknown> : {};
  const verifiedAt = ctx.nowIso();
  await savePlatformPayloadKey(ctx, "thumbnail", {
    ...oldThumbnail,
    verifiedAt,
    hasCustomThumbnail: verification.hasCustomThumbnail,
    processingStatus: verification.processingStatus,
    reportedThumbnailUrl: verification.thumbnails?.high?.url ?? verification.thumbnails?.default?.url ?? null,
    apiStatus: verification.hasCustomThumbnail === true
      ? "confirmed_by_youtube" : verification.hasCustomThumbnail === false
      ? "not_applied" : "accepted_unverified",
  });
  await insertEvent(ctx, "thumbnail_verification_checked", {
    hasCustomThumbnail: verification.hasCustomThumbnail,
    processingStatus: verification.processingStatus,
  });
  await updateLeasedJob(ctx, {
    payload: {
      ...payload,
      verified_at: verifiedAt,
      youtube_has_custom_thumbnail: verification.hasCustomThumbnail,
      youtube_processing_status: verification.processingStatus,
    },
    status: "complete",
    completed_at: verifiedAt,
  });
  return {
    ok: true, action: "thumbnail_verification_complete", videoId,
    hasCustomThumbnail: verification.hasCustomThumbnail, processingStatus: verification.processingStatus,
  };
}

async function runFinishingSteps(ctx: Ctx): Promise<TickResult> {
  const { pub } = ctx;
  const youtubeToken = await ctx.youtubeToken();
  const videoId = pub.external_video_id as string;
  const payload = { ...jobPayload(ctx) };

  if (payload.thumbnail_verify_only === true) return await runVerifyOnly(ctx, youtubeToken, videoId);

  const thumbnailOnly = payload.thumbnail_only === true;
  const scheduled = pub.delivery_mode === "scheduled";
  const scheduledShort = scheduled && pub.content_format === "short";
  const saveThumbnailState = (thumbnail: Record<string, unknown>) => savePlatformPayloadKey(ctx, "thumbnail", thumbnail);
  const previousThumbnail = () => {
    const existing = platformPayload(ctx).thumbnail;
    return existing && typeof existing === "object" ? existing as Record<string, unknown> : {};
  };

  // A scheduled CRM publication is not considered Scheduled until YouTube itself
  // confirms: private visibility + the requested future publishAt value. Thumbnail-only
  // jobs run long after this and must not re-verify a video that may already be live.
  if (scheduled && !thumbnailOnly) {
    const actual = await ctx.youtube.getYoutubeDeliveryStatus(youtubeToken, videoId);
    const decision = verifyScheduledDelivery(
      actual,
      typeof pub.scheduled_for === "string" ? pub.scheduled_for : null,
      typeof pub.uploaded_at === "string" ? pub.uploaded_at : null,
      ctx.now(),
    );
    const checkedAt = ctx.nowIso();
    const reason = "reason" in decision ? decision.reason : null;
    const nextPayload = platformPayload(ctx);
    nextPayload.youtubeSchedule = {
      apiStatus: decision.state === "verified" ? "verified" : decision.state,
      expectedPublishAt: pub.scheduled_for ?? null,
      youtubePublishAt: actual.publishAt,
      privacyStatus: actual.privacyStatus,
      uploadStatus: actual.uploadStatus,
      processingStatus: actual.processingStatus,
      checkedAt,
      reason,
    };
    nextPayload.youtubeVerification = deliveryEvidence(actual, decision.state, checkedAt, reason);
    await updatePublication(ctx, {
      platform_upload_status: actual.uploadStatus,
      platform_processing_status: actual.processingStatus,
      platform_payload: nextPayload,
    });

    if (decision.state === "wait") {
      return await waitForYoutube(ctx, { ok: true, action: "waiting_for_youtube_schedule_confirmation", publicationId: pub.id, videoId, expectedPublishAt: pub.scheduled_for });
    }
    if (decision.state === "failed") throw new PermanentYoutubeError(decision.reason);
    if (!payload.youtube_schedule_verified) {
      payload.youtube_schedule_verified = true;
      payload.youtube_schedule_verified_at = checkedAt;
      await insertEvent(ctx, "youtube_schedule_verified", {
        expectedPublishAt: pub.scheduled_for, youtubePublishAt: actual.publishAt, privacyStatus: actual.privacyStatus,
      });
    }
  }

  // Custom Shorts thumbnail display has not been reliable through thumbnails.set
  // for this channel. Scheduled Shorts deliberately skip the thumbnail API:
  // upload/schedule the video now, then let the operator use YouTube Studio while
  // it is private. This is a manual finishing step, not a publishing failure.
  if (scheduledShort) {
    const previous = previousThumbnail();
    if (previous.apiStatus !== "manual_confirmed") {
      await saveThumbnailState({
        ...previous,
        apiStatus: "manual_required",
        manualRequired: true,
        fileId: pub.thumbnail_file_id ?? null,
        attemptedAt: null,
        error: null,
        studioUrl: `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/edit`,
      });
      if (previous.apiStatus !== "manual_required") {
        await insertEvent(ctx, "thumbnail_manual_required", { videoId, thumbnailFileId: pub.thumbnail_file_id ?? null });
      }
    }

    // If Change Photo queued a thumbnail-only job for a scheduled Short, complete it
    // without sending thumbnails.set. The saved photo stays available for Studio.
    if (thumbnailOnly) {
      await updateLeasedJob(ctx, {
        payload: { ...payload, thumbnail_api_status: "skipped_scheduled_short_manual", thumbnail_error: null },
        status: "complete",
        completed_at: ctx.nowIso(),
        error_message: null,
      });
      return { ok: true, action: "scheduled_short_thumbnail_manual", publicationId: pub.id, videoId };
    }
  }

  // For immediate Shorts, keep the existing best-effort API behavior. Wait for
  // YouTube processing so we do not send thumbnails.set while the video is still
  // being assembled. Full-length videos continue using the standard thumbnail API.
  let thumbnailProcessingStatus: string | null = null;
  let processingLookupError: string | null = null;
  if (!scheduledShort && pub.content_format === "short" && pub.thumbnail_file_id && !payload.thumbnail_applied && !thumbnailOnly) {
    let preexistingCustomThumbnail = false;
    try {
      const details = await ctx.youtube.getYoutubeThumbnailStatus(youtubeToken, videoId);
      thumbnailProcessingStatus = details.processingStatus;
      preexistingCustomThumbnail = details.hasCustomThumbnail === true;
    } catch (error) {
      processingLookupError = safeError(error);
    }

    if (preexistingCustomThumbnail) {
      payload.thumbnail_applied = true;
      payload.thumbnail_api_status = "already_present_not_overwritten";
      payload.thumbnail_manual_or_preexisting_detected_at = ctx.nowIso();
      await saveThumbnailState({
        ...previousThumbnail(),
        apiStatus: "already_present_not_overwritten",
        attemptedAt: null,
        error: null,
        note: "YouTube already reported a custom thumbnail; no API overwrite attempted.",
      });
      await insertEvent(ctx, "thumbnail_preexisting_preserved", { videoId });
    } else {
      const decision = thumbnailProcessingDecision(
        thumbnailProcessingStatus,
        typeof pub.uploaded_at === "string" ? pub.uploaded_at : null,
        ctx.now(),
      );
      if (decision === "processing_failed") {
        throw new PermanentYoutubeError(
          "YouTube reports that video processing failed. The video already exists; no duplicate upload was attempted.",
        );
      }
      if (decision === "wait") {
        const checkedAt = ctx.nowIso();
        await saveJobPayload(ctx, {
          ...payload,
          thumbnail_processing_last_status: thumbnailProcessingStatus,
          thumbnail_processing_last_checked_at: checkedAt,
          thumbnail_processing_lookup_error: processingLookupError,
        });
        await saveThumbnailState({
          ...previousThumbnail(),
          apiStatus: "waiting_processing",
          processingStatus: thumbnailProcessingStatus,
          processingLookupError,
          checkedAt,
        });
        return await waitForYoutube(ctx, { ok: true, action: "waiting_for_youtube_processing", publicationId: pub.id, videoId, processingStatus: thumbnailProcessingStatus });
      }
      payload.thumbnail_processing_last_status = thumbnailProcessingStatus;
      payload.thumbnail_processing_lookup_error = processingLookupError;
      payload.thumbnail_processing_verified = decision === "ready";
    }
  }

  if (!scheduledShort && pub.thumbnail_file_id && !payload.thumbnail_applied) {
    try {
      const driveToken = await ctx.driveToken();
      const meta = await ctx.drive.fileMetadata(driveToken, pub.thumbnail_file_id as string);
      if (!meta.size || meta.size <= 0) throw new Error("Thumbnail Drive file is empty.");
      const bytes = await ctx.drive.fileRange(driveToken, pub.thumbnail_file_id as string, 0, meta.size - 1);
      await ctx.youtube.setThumbnail(youtubeToken, videoId, bytes, meta.mimeType || "image/png");
      payload.thumbnail_applied = true;
      payload.thumbnail_api_status = "accepted_unverified";
      payload.thumbnail_error = null;
      payload.thumbnail_attempted_at = ctx.nowIso();
      payload.thumbnail_uploaded_file_id = pub.thumbnail_file_id;
      payload.thumbnail_processing_status_at_upload = thumbnailProcessingStatus;
      await insertEvent(ctx, "thumbnail_api_accepted", {
        contentFormat: pub.content_format,
        note: "YouTube accepted thumbnail media upload; visible Shorts thumbnail is not independently verified.",
      });
    } catch (error) {
      payload.thumbnail_api_status = "failed";
      payload.thumbnail_error = safeError(error);
      payload.thumbnail_attempted_at = ctx.nowIso();
      await insertEvent(ctx, "thumbnail_failed", { error: safeError(error), contentFormat: pub.content_format });
    }
    await saveThumbnailState({
      apiStatus: payload.thumbnail_api_status,
      attemptedAt: payload.thumbnail_attempted_at,
      error: payload.thumbnail_error ?? null,
      fileId: pub.thumbnail_file_id,
      processingStatusAtUpload: payload.thumbnail_processing_status_at_upload ?? null,
      processingVerifiedAtUpload: payload.thumbnail_processing_verified === true,
    });
  }

  if (thumbnailOnly) {
    await updateLeasedJob(ctx, {
      payload,
      status: "complete",
      completed_at: ctx.nowIso(),
      error_message: payload.thumbnail_error ? String(payload.thumbnail_error).slice(0, 4000) : null,
    });
    return {
      ok: !payload.thumbnail_error, action: "thumbnail_only_complete", publicationId: pub.id, videoId,
      thumbnailApiStatus: payload.thumbnail_api_status ?? "not_requested",
    };
  }

  const { data: playlistLinks, error: playlistError } = await ctx.db
    .from("ai_operations_social_publication_playlists")
    .select("playlist_id, ai_operations_social_playlists(external_playlist_id, display_name, account_id, is_active)")
    .eq("publication_id", pub.id as string);
  if (playlistError) throw new Error(playlistError.message);
  const applied = new Set<string>((payload.playlists_applied as string[] | undefined) ?? []);
  for (const link of playlistLinks ?? []) {
    const playlist = link.ai_operations_social_playlists as unknown as { external_playlist_id: string; account_id: string; is_active: boolean } | null;
    const externalId = playlist?.external_playlist_id;
    if (!externalId || applied.has(externalId)) continue;
    // Defence in depth for rows written before playlist validation existed.
    if (playlist.account_id !== pub.account_id) {
      await insertEvent(ctx, "playlist_skipped", { playlistId: externalId, reason: "playlist belongs to a different YouTube account" });
      continue;
    }
    const already = await ctx.youtube.isVideoInPlaylist(youtubeToken, externalId, videoId);
    if (!already) await ctx.youtube.addToPlaylist(youtubeToken, externalId, videoId);
    applied.add(externalId);
    payload.playlists_applied = [...applied];
    await saveJobPayload(ctx, payload);
    await insertEvent(ctx, "playlist_attached", { playlistId: externalId, alreadyPresent: already });
  }
  await saveJobPayload(ctx, { ...payload, playlists_applied: [...applied] });

  let finalStatus: "scheduled" | "uploaded" | "published";
  let publishedAt: string | null = null;
  if (scheduled) {
    finalStatus = "scheduled";
  } else {
    // Immediate uploads are finalized from YouTube's reported state, not the upload response.
    const actual = await ctx.youtube.getYoutubeDeliveryStatus(youtubeToken, videoId);
    const desired = String(pub.desired_privacy_status);
    const decision = verifyImmediateDelivery(actual, desired, typeof pub.uploaded_at === "string" ? pub.uploaded_at : null, ctx.now());
    const checkedAt = ctx.nowIso();
    const reason = "reason" in decision ? decision.reason : null;
    const nextPayload = platformPayload(ctx);
    nextPayload.youtubeVerification = deliveryEvidence(actual, decision.state, checkedAt, reason);
    await updatePublication(ctx, {
      platform_upload_status: actual.uploadStatus,
      platform_processing_status: actual.processingStatus,
      platform_payload: nextPayload,
    });
    if (decision.state === "failed") throw new PermanentYoutubeError(decision.reason);
    if (decision.state === "wait") {
      return await waitForYoutube(ctx, { ok: true, action: "waiting_for_youtube_processing", publicationId: pub.id, videoId, uploadStatus: actual.uploadStatus });
    }
    if (decision.state === "unconfirmed") await insertEvent(ctx, "youtube_processing_unconfirmed", { reason });
    await insertEvent(ctx, "youtube_delivery_verified", {
      privacyStatus: actual.privacyStatus, uploadStatus: actual.uploadStatus, processingStatus: actual.processingStatus, state: decision.state,
    });
    // A Private upload is Uploaded, never Published.
    finalStatus = desired === "private" ? "uploaded" : "published";
    if (finalStatus === "published") publishedAt = (pub.published_at as string | null) ?? actual.publishedAt ?? checkedAt;
  }

  const update: Record<string, unknown> = { status: finalStatus, next_attempt_at: null, error_code: null, error_message: null };
  if (publishedAt) update.published_at = publishedAt;
  const { data: finalized, error: finalizeError } = await ctx.db.from("ai_operations_social_publications")
    .update(update)
    .eq("id", pub.id as string)
    .in("status", ["uploading", "upload_queued"])
    .select("id");
  if (finalizeError) throw new Error(finalizeError.message);
  if (!finalized?.length) throw new PermanentYoutubeError(`Publication left the uploading state before it could be finalized as ${finalStatus}.`);
  await updateLeasedJob(ctx, { status: "complete", completed_at: ctx.nowIso(), error_message: null });

  return { ok: true, action: "finalized", publicationId: pub.id, status: finalStatus };
}

function isAuxiliaryJob(job: Job): boolean {
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  return payload.thumbnail_only === true || payload.thumbnail_verify_only === true;
}

async function markFailed(ctx: Ctx, error: unknown): Promise<TickResult> {
  const message = safeError(error).slice(0, 4000);
  const attempts = Number(ctx.job.attempts ?? 0);
  const classification = classifyPublishFailure(error, attempts);
  const auxiliary = isAuxiliaryJob(ctx.job);

  if (classification.retryable) {
    const delayMs = retryDelayMs(attempts, classification.retryAfterMs);
    const nextAttemptAt = new Date(ctx.now() + delayMs).toISOString();
    await ctx.db.from("ai_operations_video_jobs").update({
      status: "queued", error_message: message, claimed_by: null, claimed_at: null,
    }).eq("id", ctx.job.id as number).eq("claimed_by", ctx.workerId);
    await ctx.db.from("ai_operations_social_publications").update({
      next_attempt_at: nextAttemptAt,
      ...(auxiliary ? {} : { error_code: classification.kind, error_message: message }),
    }).eq("id", ctx.pub.id as string);
    await insertEvent(ctx, "publish_retry_scheduled", { kind: classification.kind, attempts, nextAttemptAt, retryAfterMs: classification.retryAfterMs, error: message });
    ctx.log?.("transient_failure", { jobId: ctx.job.id, publicationId: ctx.pub.id, kind: classification.kind, message });
    return { ok: false, action: "retry_scheduled", publicationId: ctx.pub.id, kind: classification.kind, nextAttemptAt, error: message };
  }

  await ctx.db.from("ai_operations_video_jobs").update({
    status: "error", error_message: message, completed_at: ctx.nowIso(), claimed_by: null, claimed_at: null,
  }).eq("id", ctx.job.id as number).eq("claimed_by", ctx.workerId);
  if (auxiliary) {
    // A failed thumbnail/verification job never changes an uploaded video's publication state.
    await insertEvent(ctx, "auxiliary_job_failed", { kind: classification.kind, error: message });
  } else {
    await ctx.db.from("ai_operations_social_publications").update({
      status: "failed", error_code: classification.kind, error_message: message, next_attempt_at: null,
    }).eq("id", ctx.pub.id as string).in("status", ["upload_queued", "uploading"]);
  }
  ctx.log?.("permanent_failure", { jobId: ctx.job.id, publicationId: ctx.pub.id, kind: classification.kind, message });
  return { ok: false, action: "failed", publicationId: ctx.pub.id, kind: classification.kind, error: message };
}

async function processJob(ctx: Ctx): Promise<TickResult> {
  const { db, job, pub } = ctx;

  if (pub.status === "cancelled") {
    await updateLeasedJob(ctx, { status: "cancelled", completed_at: ctx.nowIso() });
    return { ok: true, action: "cancelled", publicationId: pub.id };
  }

  const staleRecoveries = Number(jobPayload(ctx).stale_recovery_count ?? 0);
  if (staleRecoveries > MAX_STALE_RECOVERIES) {
    throw new PermanentYoutubeError(
      `The publish worker was interrupted ${staleRecoveries} times on this job. Check YouTube Studio for a partial or duplicate upload before retrying.`,
    );
  }
  if (staleRecoveries > 0 && !jobPayload(ctx).stale_recovery_logged) {
    await insertEvent(ctx, "publish_worker_recovered", {
      staleRecoveryCount: staleRecoveries,
      resumedSession: Boolean(jobPayload(ctx).upload_session_url),
      recoveredFrom: jobPayload(ctx).stale_recovered_from ?? null,
    });
    await saveJobPayload(ctx, { ...jobPayload(ctx), stale_recovery_logged: true });
  }

  if (pub.status === "upload_queued") {
    const startedAt = ctx.nowIso();
    const { data, error } = await db.from("ai_operations_social_publications").update({
      status: "uploading",
      upload_started_at: pub.upload_started_at ?? startedAt,
      attempt_count: Number(pub.attempt_count ?? 0) + 1,
      last_attempt_at: startedAt,
    }).eq("id", pub.id as string).eq("status", "upload_queued").select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) {
      // Cancelled (or otherwise moved) between the claim and now.
      await updateLeasedJob(ctx, { status: "cancelled", completed_at: ctx.nowIso() });
      return { ok: true, action: "cancelled", publicationId: pub.id };
    }
    pub.status = "uploading";
    await insertEvent(ctx, "upload_started", { jobId: job.id, attempt: job.attempts });
  } else if (pub.status === "uploading" && !isAuxiliaryJob(job)) {
    await db.from("ai_operations_social_publications").update({ last_attempt_at: ctx.nowIso() }).eq("id", pub.id as string);
  }

  // Idempotency: never call videos.insert again once a video id exists -- resume
  // whatever remains (verification / thumbnail / playlists / finalize).
  if (pub.external_video_id) return await runFinishingSteps(ctx);
  if (isAuxiliaryJob(job)) throw new PermanentYoutubeError("Thumbnail job has no uploaded YouTube video to update.");
  return await runUploadStage(ctx);
}

/** Claims, advances and releases at most one publish_youtube job. */
export async function runPublishTick(deps: PublishWorkerDeps): Promise<TickResult> {
  const { data: claimed, error: claimError } = await deps.db.rpc("claim_next_youtube_publish_job", {
    p_worker_id: deps.workerId,
    p_lease_seconds: PUBLISH_LEASE_SECONDS,
  });
  if (claimError) throw new Error(`Could not claim a publish job: ${claimError.message}`);
  const job = (Array.isArray(claimed) ? claimed[0] : claimed) as Job | undefined;
  if (!job) return { ok: true, action: "idle" };

  const release = async () => {
    const { error } = await deps.db.rpc("release_youtube_publish_job", { p_job_id: job.id, p_worker_id: deps.workerId });
    if (error) deps.log?.("release_failed", { jobId: job.id, error: error.message });
  };

  const { data: pubRow, error: pubError } = await deps.db.from("ai_operations_social_publications")
    .select("*").eq("id", job.social_publication_id as string).maybeSingle();
  if (pubError || !pubRow) {
    await deps.db.from("ai_operations_video_jobs").update({
      status: "error", error_message: "Publication not found for job.", claimed_by: null, claimed_at: null,
    }).eq("id", job.id as number).eq("claimed_by", deps.workerId);
    return { ok: false, action: "orphaned_job", jobId: job.id };
  }

  const ctx: Ctx = { ...deps, job, pub: pubRow as Publication, nowIso: () => new Date(deps.now()).toISOString() };
  try {
    return await processJob(ctx);
  } catch (error) {
    if (error instanceof LeaseLostError) {
      deps.log?.("lease_lost", { jobId: job.id, publicationId: ctx.pub.id });
      return { ok: false, action: "lease_lost", jobId: job.id };
    }
    return await markFailed(ctx, error);
  } finally {
    await release();
  }
}

/** Actions that moved media; one of these is enough work for a single invocation. */
const HEAVY_ACTIONS = new Set(["chunk_uploaded", "video_created"]);

/**
 * Runs ticks until the queue is idle, a heavy upload step ran, or the time budget is
 * spent, so jobs polling YouTube never starve queued work behind a one-job-per-minute cron.
 */
export async function runPublishTicks(
  deps: PublishWorkerDeps,
  options: { maxJobs?: number; budgetMs?: number } = {},
): Promise<TickResult[]> {
  const maxJobs = options.maxJobs ?? 5;
  const budgetMs = options.budgetMs ?? 25_000;
  const startedAt = deps.now();
  const results: TickResult[] = [];
  while (results.length < maxJobs && deps.now() - startedAt < budgetMs) {
    const result = await runPublishTick(deps);
    results.push(result);
    if (result.action === "idle" || HEAVY_ACTIONS.has(result.action)) break;
  }
  return results;
}
