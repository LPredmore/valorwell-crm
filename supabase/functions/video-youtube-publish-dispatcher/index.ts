import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { adminClient, authorizeWorker, json, logEvent, safeError, classifyModelFailure, backoffSeconds } from "../_shared/ai-ops.ts";
import { youtubeAccessToken } from "../_shared/ai-ops-youtube.ts";
import { isVerifiedCurrentShortRender } from "../_shared/short-render-profile.ts";
import { thumbnailProcessingDecision } from "./thumbnail-readiness.ts";
import { driveAccessToken, driveFileMetadata, driveFileRange } from "./drive.ts";
import {
  addToPlaylist, createResumableUploadSession, isVideoInPlaylist, queryUploadOffset,
  setThumbnail, getYoutubeThumbnailStatus, uploadChunk, PermanentYoutubeError, TransientYoutubeError, type VideoSnippetStatus,
} from "./youtube.ts";

type Db = ReturnType<typeof adminClient>;
type Job = Record<string, unknown>;
type Publication = Record<string, unknown>;

const CHUNK_BYTES = 32 * 1024 * 1024; // 32MB, a multiple of 256KB as YouTube's resumable protocol requires

async function insertEvent(db: Db, publicationId: string, tenantId: string, eventType: string, detail: Record<string, unknown> = {}) {
  await db.from("ai_operations_social_publication_events").insert({
    tenant_id: tenantId, publication_id: publicationId, event_type: eventType, detail,
  });
}

function buildDescriptionWithHashtags(description: string, hashtags: string[]): string {
  if (!hashtags.length) return description;
  const alreadyPresent = hashtags.every((tag) => description.includes(tag));
  if (alreadyPresent) return description;
  const block = hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ");
  return description ? `${description}\n\n${block}` : block;
}

async function resolveSourceFileId(db: Db, pub: Publication): Promise<string> {
  if (pub.source_type === "clip") {
    const { data, error } = await db.from("ai_operations_video_clips").select("drive_file_id").eq("id", pub.clip_id as string).maybeSingle();
    if (error || !data?.drive_file_id) throw new PermanentYoutubeError("Source clip has no rendered Drive file.");
    return data.drive_file_id as string;
  }
  const { data, error } = await db.from("ai_operations_video_projects").select("source_file_id").eq("id", pub.project_id as string).maybeSingle();
  if (error || !data?.source_file_id) throw new PermanentYoutubeError("Source project has no Drive file.");
  return data.source_file_id as string;
}

async function assertShortRenderProfile(db: Db, pub: Publication) {
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

async function markFailed(db: Db, job: Job, pub: Publication, error: unknown) {
  const message = safeError(error);
  const status = error instanceof Error && "status" in error ? Number((error as { status?: number }).status) : null;
  const classification = classifyModelFailure(status, message);
  const retryable = classification.retryable && !(error instanceof PermanentYoutubeError);

  if (retryable) {
    const attempts = Number(job.attempts ?? 0);
    await db.from("ai_operations_video_jobs").update({
      status: "queued", error_message: message.slice(0, 4000),
    }).eq("id", job.id as number);
    await db.from("ai_operations_social_publications").update({
      next_attempt_at: new Date(Date.now() + backoffSeconds(attempts) * 1000).toISOString(),
      error_code: classification.kind, error_message: message.slice(0, 4000),
    }).eq("id", pub.id as string);
    logEvent("video-youtube-publish-dispatcher", "transient_failure", { jobId: job.id, publicationId: pub.id, message });
  } else {
    await db.from("ai_operations_video_jobs").update({ status: "error", error_message: message.slice(0, 4000) }).eq("id", job.id as number);
    await db.from("ai_operations_social_publications").update({
      status: "failed", error_code: classification.kind, error_message: message.slice(0, 4000),
    }).eq("id", pub.id as string);
    logEvent("video-youtube-publish-dispatcher", "permanent_failure", { jobId: job.id, publicationId: pub.id, message });
  }
}

async function runUploadStage(db: Db, job: Job, pub: Publication): Promise<Response> {
  await assertShortRenderProfile(db, pub);
  const youtubeToken = await youtubeAccessToken();
  const driveToken = await driveAccessToken(db);
  const payload = (job.payload ?? {}) as Record<string, unknown>;

  let fileId = payload.drive_file_id as string | undefined;
  let totalBytes = payload.total_bytes as number | undefined;
  let mimeType = payload.mime_type as string | undefined;

  if (!fileId || !totalBytes) {
    fileId = await resolveSourceFileId(db, pub);
    const meta = await driveFileMetadata(driveToken, fileId);
    if (!meta.size) throw new PermanentYoutubeError("Source Drive file has no known size.");
    totalBytes = meta.size;
    mimeType = meta.mimeType || "video/mp4";
    await db.from("ai_operations_video_jobs").update({
      payload: { ...payload, drive_file_id: fileId, total_bytes: totalBytes, mime_type: mimeType },
    }).eq("id", job.id as number);
  }

  let sessionUrl = payload.upload_session_url as string | undefined;
  if (!sessionUrl) {
    const isScheduledOrPrivate = pub.delivery_mode === "scheduled" || pub.desired_privacy_status === "private";
    const body: VideoSnippetStatus = {
      snippet: {
        title: String(pub.title ?? "").slice(0, 100),
        description: buildDescriptionWithHashtags(String(pub.description ?? ""), (pub.hashtags as string[]) ?? []),
        tags: (pub.tags as string[]) ?? [],
        categoryId: String(pub.category_id ?? "29"),
        defaultLanguage: String(pub.default_language ?? "en"),
      },
      status: {
        privacyStatus: isScheduledOrPrivate ? "private" : (pub.desired_privacy_status as "public" | "unlisted" | "private"),
        ...(pub.delivery_mode === "scheduled" ? { publishAt: pub.scheduled_for as string } : {}),
        license: (pub.license as "youtube" | "creativeCommon") ?? "youtube",
        embeddable: Boolean(pub.embeddable),
        publicStatsViewable: Boolean(pub.public_stats_viewable),
        selfDeclaredMadeForKids: Boolean(pub.made_for_kids),
        containsSyntheticMedia: Boolean(pub.contains_synthetic_media),
      },
    };
    sessionUrl = await createResumableUploadSession(youtubeToken, body, totalBytes, mimeType ?? "video/mp4");
    await db.from("ai_operations_video_jobs").update({
      payload: { ...payload, drive_file_id: fileId, total_bytes: totalBytes, mime_type: mimeType, upload_session_url: sessionUrl },
    }).eq("id", job.id as number);
  }

  // YouTube's own reported offset is authoritative -- never trust our own bytes_uploaded
  // bookkeeping across a job restart.
  const nextByte = await queryUploadOffset(sessionUrl, totalBytes);
  if (nextByte >= totalBytes) {
    // Upload already finished on a prior tick but we never recorded it (e.g. crash right
    // after YouTube accepted the final chunk). We cannot recover the video id from here --
    // surface as a permanent failure so a human can reconcile via YouTube Studio rather than
    // silently re-uploading.
    throw new PermanentYoutubeError("Upload session reports complete but no video id was recorded. Manual reconciliation required.");
  }

  const chunkEnd = Math.min(nextByte + CHUNK_BYTES, totalBytes) - 1;
  const bytes = await driveFileRange(driveToken, fileId, nextByte, chunkEnd);
  const result = await uploadChunk(sessionUrl, bytes, nextByte, totalBytes);

  if (!result.done) {
    await db.from("ai_operations_video_jobs").update({
      payload: { ...payload, drive_file_id: fileId, total_bytes: totalBytes, mime_type: mimeType, upload_session_url: sessionUrl, bytes_uploaded: result.nextByte },
    }).eq("id", job.id as number);
    return json({ ok: true, action: "chunk_uploaded", publicationId: pub.id, bytesUploaded: result.nextByte, totalBytes });
  }

  // Video created -- persist immediately, before anything else, per the idempotency rule.
  await db.from("ai_operations_social_publications").update({
    external_video_id: result.videoId,
    external_url: `https://www.youtube.com/watch?v=${result.videoId}`,
    uploaded_at: new Date().toISOString(),
    platform_response: result.response,
  }).eq("id", pub.id as string);
  await insertEvent(db, pub.id as string, pub.tenant_id as string, "youtube_video_created", { videoId: result.videoId });

  return json({ ok: true, action: "video_created", publicationId: pub.id, videoId: result.videoId });
}

async function runFinishingSteps(db: Db, job: Job, pub: Publication): Promise<Response> {
  const youtubeToken = await youtubeAccessToken();
  const videoId = pub.external_video_id as string;
  // Keep thumbnail result in the same payload as playlists. The previous implementation
  // used a stale copy of payload and overwrote thumbnail_applied when saving playlists.
  const payload = { ...((job.payload ?? {}) as Record<string, unknown>) };
  // Read-only verification of an already published Short. This does not re-upload
  // the video or thumbnail and does not change publication status or playlists.
  if (payload.thumbnail_verify_only === true) {
    const verification = await getYoutubeThumbnailStatus(youtubeToken, videoId);
    const existing = ((pub.platform_payload ?? {}) as Record<string, unknown>).thumbnail;
    const oldThumbnail = existing && typeof existing === "object"
      ? existing as Record<string, unknown> : {};
    const verifiedAt = new Date().toISOString();
    const thumbnail = {
      ...oldThumbnail,
      verifiedAt,
      hasCustomThumbnail: verification.hasCustomThumbnail,
      processingStatus: verification.processingStatus,
      reportedThumbnailUrl: verification.thumbnails?.high?.url ?? verification.thumbnails?.default?.url ?? null,
      apiStatus: verification.hasCustomThumbnail === true
        ? "confirmed_by_youtube" : verification.hasCustomThumbnail === false
        ? "not_applied" : "accepted_unverified",
    };
    const publicationUpdate = await db.from("ai_operations_social_publications").update({
      platform_payload: { ...((pub.platform_payload ?? {}) as Record<string, unknown>), thumbnail },
    }).eq("id", pub.id as string);
    if (publicationUpdate.error) throw new Error(publicationUpdate.error.message);
    await insertEvent(db, pub.id as string, pub.tenant_id as string, "thumbnail_verification_checked", {
      hasCustomThumbnail: verification.hasCustomThumbnail,
      processingStatus: verification.processingStatus,
    });
    const jobUpdate = await db.from("ai_operations_video_jobs").update({
      payload: {
        ...payload,
        verified_at: verifiedAt,
        youtube_has_custom_thumbnail: verification.hasCustomThumbnail,
        youtube_processing_status: verification.processingStatus,
      },
      status: "complete",
      completed_at: verifiedAt,
    }).eq("id", job.id as number);
    if (jobUpdate.error) throw new Error(jobUpdate.error.message);
    return json({
      ok: true,
      action: "thumbnail_verification_complete",
      videoId,
      hasCustomThumbnail: verification.hasCustomThumbnail,
      processingStatus: verification.processingStatus,
    });
  }


  // YouTube's media-upload endpoint can be used for videos. For Shorts, attempt the
  // same official API but record API acceptance separately from visible application:
  // account eligibility and Shorts support may limit whether YouTube uses the image.
  // The upload API reported video creation, not video processing completion.
  // Submit thumbnails on *new* Shorts only after YouTube says processing succeeded.
  // A successful thumbnails.set call alone does not prove Shorts UI placement.
  let thumbnailProcessingStatus: string | null = null;
  let processingLookupError: string | null = null;
  if (pub.content_format === "short" && pub.thumbnail_file_id &&
      !payload.thumbnail_applied && !payload.thumbnail_only) {
    try {
      const details = await getYoutubeThumbnailStatus(youtubeToken, videoId);
      thumbnailProcessingStatus = details.processingStatus;
    } catch (error) {
      // A temporary failure to read owner-only processing details must never
      // cause a duplicate video upload or indefinitely block publication.
      processingLookupError = safeError(error);
    }

    const decision = thumbnailProcessingDecision(
      thumbnailProcessingStatus,
      typeof pub.uploaded_at === "string" ? pub.uploaded_at : null,
      Date.now(),
    );
    if (decision === "processing_failed") {
      throw new PermanentYoutubeError(
        "YouTube reports that video processing failed. The video already exists; no duplicate upload was attempted.",
      );
    }
    if (decision === "wait") {
      const checkedAt = new Date().toISOString();
      const thumbnailState = ((pub.platform_payload ?? {}) as Record<string, unknown>).thumbnail;
      const previous = thumbnailState && typeof thumbnailState === "object"
        ? thumbnailState as Record<string, unknown> : {};
      const [savedJob, savedPublication] = await Promise.all([
        db.from("ai_operations_video_jobs").update({
          payload: { ...payload, thumbnail_processing_last_status: thumbnailProcessingStatus,
            thumbnail_processing_last_checked_at: checkedAt,
            thumbnail_processing_lookup_error: processingLookupError },
        }).eq("id", job.id as number),
        db.from("ai_operations_social_publications").update({
          platform_payload: {
            ...((pub.platform_payload ?? {}) as Record<string, unknown>),
            thumbnail: { ...previous, apiStatus: "waiting_processing",
              processingStatus: thumbnailProcessingStatus,
              processingLookupError,
              checkedAt },
          },
        }).eq("id", pub.id as string),
      ]);
      if (savedJob.error || savedPublication.error) {
        throw new Error(savedJob.error?.message ?? savedPublication.error?.message);
      }
      return json({ ok: true, action: "waiting_for_youtube_processing",
        publicationId: pub.id, videoId, processingStatus: thumbnailProcessingStatus });
    }
    payload.thumbnail_processing_last_status = thumbnailProcessingStatus;
    payload.thumbnail_processing_lookup_error = processingLookupError;
    payload.thumbnail_processing_verified = decision === "ready";
  }

  if (pub.thumbnail_file_id && !payload.thumbnail_applied) {
    try {
      const driveToken = await driveAccessToken(db);
      const meta = await driveFileMetadata(driveToken, pub.thumbnail_file_id as string);
      if (!meta.size || meta.size <= 0) throw new Error("Thumbnail Drive file is empty.");
      const bytes = await driveFileRange(driveToken, pub.thumbnail_file_id as string, 0, meta.size - 1);
      await setThumbnail(youtubeToken, videoId, bytes, meta.mimeType || "image/png");
      payload.thumbnail_applied = true; // API accepted; Shorts UI result still needs confirmation.
      payload.thumbnail_api_status = "accepted_unverified";
      payload.thumbnail_error = null;
      payload.thumbnail_attempted_at = new Date().toISOString();
      payload.thumbnail_uploaded_file_id = pub.thumbnail_file_id;
      payload.thumbnail_processing_status_at_upload = thumbnailProcessingStatus;
      await insertEvent(db, pub.id as string, pub.tenant_id as string, "thumbnail_api_accepted", {
        contentFormat: pub.content_format,
        note: "YouTube accepted thumbnail media upload; visible Shorts thumbnail is not independently verified.",
      });
    } catch (error) {
      payload.thumbnail_api_status = "failed";
      payload.thumbnail_error = safeError(error);
      payload.thumbnail_attempted_at = new Date().toISOString();
      // Thumbnail failure is nonfatal: never duplicate or unpublish the already uploaded video.
      await insertEvent(db, pub.id as string, pub.tenant_id as string, "thumbnail_failed", {
        error: safeError(error), contentFormat: pub.content_format,
      });
    }
    await db.from("ai_operations_social_publications").update({
      platform_payload: {
        ...((pub.platform_payload ?? {}) as Record<string, unknown>),
        thumbnail: {
          apiStatus: payload.thumbnail_api_status,
          attemptedAt: payload.thumbnail_attempted_at,
          error: payload.thumbnail_error ?? null,
          fileId: pub.thumbnail_file_id,
          processingStatusAtUpload: payload.thumbnail_processing_status_at_upload ?? null,
          processingVerifiedAtUpload: payload.thumbnail_processing_verified === true,
        },
      },
    }).eq("id", pub.id as string);
  }

  // Safe one-off repair for an existing, already published video. Never call videos.insert,
  // change published_at or visibility, or touch playlists for thumbnail-only work.
  if (payload.thumbnail_only) {
    await db.from("ai_operations_video_jobs").update({
      payload, status: "complete", completed_at: new Date().toISOString(),
      error_message: payload.thumbnail_error ? String(payload.thumbnail_error).slice(0, 4000) : null,
    }).eq("id", job.id as number);
    return json({
      ok: !payload.thumbnail_error, action: "thumbnail_only_complete",
      publicationId: pub.id, videoId, thumbnailApiStatus: payload.thumbnail_api_status ?? "not_requested",
    });
  }

  const { data: playlistLinks } = await db
    .from("ai_operations_social_publication_playlists")
    .select("playlist_id, ai_operations_social_playlists(external_playlist_id, display_name)")
    .eq("publication_id", pub.id as string);
  const applied = new Set<string>((payload.playlists_applied as string[] | undefined) ?? []);
  for (const link of playlistLinks ?? []) {
    const externalId = (link.ai_operations_social_playlists as { external_playlist_id: string } | null)?.external_playlist_id;
    if (!externalId || applied.has(externalId)) continue;
    const already = await isVideoInPlaylist(youtubeToken, externalId, videoId);
    if (!already) await addToPlaylist(youtubeToken, externalId, videoId);
    applied.add(externalId);
    await insertEvent(db, pub.id as string, pub.tenant_id as string, "playlist_attached", { playlistId: externalId });
  }
  await db.from("ai_operations_video_jobs").update({ payload: { ...payload, playlists_applied: [...applied] } }).eq("id", job.id as number);

  const finalStatus = pub.delivery_mode === "scheduled"
    ? "scheduled"
    : pub.desired_privacy_status === "private"
    ? "uploaded"
    : "published";
  const update: Record<string, unknown> = { status: finalStatus };
  if (finalStatus === "published" && !pub.published_at) update.published_at = new Date().toISOString();
  await db.from("ai_operations_social_publications").update(update).eq("id", pub.id as string);
  await db.from("ai_operations_video_jobs").update({ status: "complete", completed_at: new Date().toISOString() }).eq("id", job.id as number);

  return json({ ok: true, action: "finalized", publicationId: pub.id, status: finalStatus });
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!authorizeWorker(request)) return json({ error: "Unauthorized." }, 401);

  const db = adminClient();
  let job: Job | null = null;
  let pub: Publication | null = null;
  try {
    const { data: running } = await db.from("ai_operations_video_jobs")
      .select("*").eq("job_type", "publish_youtube").eq("status", "running").order("started_at", { ascending: true }).limit(1);
    job = (running?.[0] as Job) ?? null;
    if (!job) {
      const { data: queued } = await db.from("ai_operations_video_jobs")
        .select("*").eq("job_type", "publish_youtube").eq("status", "queued").order("created_at", { ascending: true }).limit(5);
      for (const candidate of (queued ?? []) as Job[]) {
        const { data: pubRow } = await db.from("ai_operations_social_publications").select("next_attempt_at").eq("id", candidate.social_publication_id as string).maybeSingle();
        if (pubRow?.next_attempt_at && new Date(pubRow.next_attempt_at) > new Date()) continue;
        job = candidate;
        break;
      }
    }
    if (!job) return json({ ok: true, action: "idle" });

    const { data: pubRow, error: pubError } = await db.from("ai_operations_social_publications").select("*").eq("id", job.social_publication_id as string).maybeSingle();
    if (pubError || !pubRow) throw new Error("Publication not found for job.");
    pub = pubRow as Publication;

    if (pub.status === "cancelled") {
      await db.from("ai_operations_video_jobs").update({ status: "cancelled" }).eq("id", job.id as number);
      return json({ ok: true, action: "cancelled", publicationId: pub.id });
    }

    if (job.status === "queued") {
      await db.from("ai_operations_video_jobs").update({
        status: "running", started_at: new Date().toISOString(), attempts: Number(job.attempts ?? 0) + 1,
      }).eq("id", job.id as number);
      if (!pub.external_video_id && pub.status !== "uploading") {
        await db.from("ai_operations_social_publications").update({
          status: "uploading", upload_started_at: new Date().toISOString(),
          attempt_count: Number(pub.attempt_count ?? 0) + 1, last_attempt_at: new Date().toISOString(),
        }).eq("id", pub.id as string);
        await insertEvent(db, pub.id as string, pub.tenant_id as string, "upload_started", {});
      }
    }

    // Idempotency: never call videos.insert again once a video id exists -- resume
    // whatever remains (thumbnail / playlists / finalize).
    if (pub.external_video_id) return await runFinishingSteps(db, job, pub);
    return await runUploadStage(db, job, pub);
  } catch (error) {
    if (job && pub) await markFailed(db, job, pub, error);
    else logEvent("video-youtube-publish-dispatcher", "dispatch_failed", { error: safeError(error) });
    return json({ ok: false, error: safeError(error) }, 500);
  }
});
