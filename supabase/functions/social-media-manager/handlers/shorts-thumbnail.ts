/**
 * Operator control plane for the channel-gated Shorts thumbnail API (see
 * _shared/youtube-publish/shorts-thumbnail.ts). Default OFF. The ONLY YouTube write here is
 * an explicitly requested compatibility test on an operator-chosen, server-validated,
 * private, unscheduled test Short owned by the account's channel. Nothing runs on render.
 */
import type { AuthContext } from "../context.ts";
import { requireMutate } from "../context.ts";
import { safeError, YoutubePublishError } from "../../_shared/youtube-publish/errors.ts";
import type { YoutubeVideoOwnership } from "../../_shared/youtube-publish/api.ts";
import {
  isShortsThumbnailApiEnabled, resolveShortsThumbnailFeature, SHORTS_THUMBNAIL_METADATA_KEY,
  type ShortsThumbnailFeature, type ShortsThumbnailTestRun, TEST_CONFIRMATION_PREFIX, VISUAL_CONFIRMATION_PHRASE,
} from "../../_shared/youtube-publish/shorts-thumbnail.ts";

export type ShortsThumbnailClient = {
  getVideo(videoId: string): Promise<YoutubeVideoOwnership | null>;
  getThumbnailStatus(videoId: string): Promise<{ hasCustomThumbnail: boolean | null; processingStatus: string | null; thumbnails: Record<string, { url?: string }> | null }>;
  setThumbnail(videoId: string, bytes: ArrayBuffer, mimeType: string): Promise<void>;
  fileMetadata(fileId: string): Promise<{ size: number; mimeType: string }>;
  fileBytes(fileId: string): Promise<ArrayBuffer>;
};

const MAX_TEST_RUNS = 10;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_SHORT_SECONDS = 180;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const UUID = /^[a-f0-9-]{36}$/i;
const MAX_BACKFILL = 25;

function requireAdmin(auth: AuthContext) {
  requireMutate(auth);
  if (auth.crmRole !== "crm_admin") throw new Error("FORBIDDEN"); // crm_admin only
}

async function loadAccountSettings(auth: AuthContext) {
  const { data: account, error } = await auth.db.from("ai_operations_social_accounts")
    .select("id,tenant_id,external_account_id,display_name")
    .eq("tenant_id", auth.tenantId).eq("platform", "youtube").eq("is_default", true).maybeSingle();
  if (error) throw new Error(error.message);
  if (!account) throw new Error("No default YouTube account is configured.");
  const { data: settings, error: settingsError } = await auth.db.from("ai_operations_social_settings")
    .select("account_id,metadata").eq("account_id", account.id).maybeSingle();
  if (settingsError) throw new Error(settingsError.message);
  if (!settings) throw new Error("YouTube settings are missing for this account.");
  return { account, metadata: ((settings as Record<string, unknown>).metadata ?? {}) as Record<string, unknown> };
}

async function saveFeature(auth: AuthContext, accountId: string, metadata: Record<string, unknown>, feature: ShortsThumbnailFeature) {
  const next = { ...metadata, [SHORTS_THUMBNAIL_METADATA_KEY]: { ...feature, testRuns: feature.testRuns.slice(0, MAX_TEST_RUNS) } };
  const { error } = await auth.db.from("ai_operations_social_settings").update({ metadata: next }).eq("account_id", accountId);
  if (error) throw new Error(error.message);
}

function view(feature: ShortsThumbnailFeature, accountId: string) {
  return { accountId, ...feature, automaticUploadsEnabled: isShortsThumbnailApiEnabled({ [SHORTS_THUMBNAIL_METADATA_KEY]: feature }) };
}

export async function getShortsThumbnailFeature(auth: AuthContext) {
  const { account, metadata } = await loadAccountSettings(auth);
  return view(resolveShortsThumbnailFeature(metadata), account.id);
}

/** Resolves the test cover server-side from the tenant's own clip/project row. */
async function resolveTenantCover(auth: AuthContext, sourceType: unknown, sourceId: unknown): Promise<string> {
  if ((sourceType !== "clip" && sourceType !== "project") || typeof sourceId !== "string" || !UUID.test(sourceId)) {
    throw new Error("Choose the Library cover to use for the test.");
  }
  const { data, error } = sourceType === "clip"
    ? await auth.db.from("ai_operations_video_clips")
      .select("id,cover_image_file_id,ai_operations_video_projects!inner(tenant_id)")
      .eq("id", sourceId).eq("ai_operations_video_projects.tenant_id", auth.tenantId).maybeSingle()
    : await auth.db.from("ai_operations_video_projects").select("id,cover_image_file_id")
      .eq("id", sourceId).eq("tenant_id", auth.tenantId).maybeSingle();
  if (error) throw new Error(error.message);
  const fileId = (data as Record<string, unknown> | null)?.cover_image_file_id;
  if (typeof fileId !== "string" || !fileId) throw new Error("That Library item has no saved cover image.");
  return fileId;
}

export async function runShortsThumbnailCompatTest(auth: AuthContext, params: Record<string, unknown>, client: ShortsThumbnailClient) {
  requireAdmin(auth);
  const videoId = typeof params.videoId === "string" ? params.videoId.trim() : "";
  if (!VIDEO_ID.test(videoId)) throw new Error("Enter the 11-character YouTube video id of your private test Short.");
  if (params.confirmation !== TEST_CONFIRMATION_PREFIX + videoId) {
    throw new Error(`Type exactly "${TEST_CONFIRMATION_PREFIX}${videoId}" to confirm the thumbnail on this video will be changed.`);
  }
  const { account, metadata } = await loadAccountSettings(auth);
  const feature = resolveShortsThumbnailFeature(metadata);
  // A previously verified channel may be retested without disabling current publishing.
  // Keep the existing feature state until the operator reviews this particular result.
  // Preserve previous pending test runs so repeat tests can be conducted on
  // the original control video. Do not change automatic upload state on rerun.

  // A test video must never be one the CRM is publishing or that an operator already finished.
  const { data: linked, error: linkedError } = await auth.db.from("ai_operations_social_publications")
    .select("id,tenant_id,status,platform_payload").eq("external_video_id", videoId);
  if (linkedError) throw new Error(linkedError.message);
  for (const pub of (linked ?? []) as Record<string, unknown>[]) {
    if (pub.tenant_id !== auth.tenantId) throw new Error("This video does not belong to your organization.");
    // The October 7 control was not linked to a CRM publication. ALL linked
    // publications, including status "uploaded" and previously failed/cancelled
    // rows, must be excluded so a production Short cannot masquerade as a
    // disposable, private, unscheduled thumbnail test.
    throw new Error("This YouTube video is linked to a CRM publication. Use the original private test video or another disposable Short that is not in the CRM.");
  }

  const fileId = await resolveTenantCover(auth, params.sourceType, params.sourceId);
  const video = await client.getVideo(videoId);
  if (!video) throw new Error("YouTube returned no such video for the connected channel.");
  if (!account.external_account_id || video.channelId !== account.external_account_id) {
    throw new Error("This video is not owned by the connected YouTube channel.");
  }
  if (video.privacyStatus !== "private") throw new Error("The test video must be Private.");
  if (video.publishAt) throw new Error("The test video has a scheduled publish time. Use an unscheduled private test Short.");
  if (video.uploadStatus && video.uploadStatus !== "processed") throw new Error("The test video has not finished processing on YouTube.");
  if (video.durationSeconds === null || video.durationSeconds > MAX_SHORT_SECONDS) throw new Error("The test video must be a Short (3 minutes or less).");

  const meta = await client.fileMetadata(fileId);
  if (!["image/jpeg", "image/png"].includes(meta.mimeType) || !meta.size || meta.size > MAX_IMAGE_BYTES) {
    throw new Error("The cover must be a JPG or PNG of 2 MB or less.");
  }

  const run: ShortsThumbnailTestRun = {
    id: crypto.randomUUID(), videoId, thumbnailFileId: fileId,
    sourceType: String(params.sourceType), sourceId: String(params.sourceId),
    requestedBy: auth.userId, requestedAt: new Date().toISOString(),
    httpStatus: null, apiAccepted: false, hasCustomThumbnail: null, error: null,
    visualResult: "pending", visualReviewedBy: null, visualReviewedAt: null,
  };
  try {
    await client.setThumbnail(videoId, await client.fileBytes(fileId), meta.mimeType);
    run.httpStatus = 200;
    run.apiAccepted = true;
  } catch (error) {
    run.httpStatus = error instanceof YoutubePublishError ? error.status : null;
    run.error = safeError(error).slice(0, 500);
  }
  if (run.apiAccepted) {
    try {
      run.hasCustomThumbnail = (await client.getVideo(videoId))?.hasCustomThumbnail ?? null;
    } catch (error) {
      run.error = `Readback failed: ${safeError(error)}`.slice(0, 500);
    }
  }
  // First-time tests remain in "testing". Retesting an already verified channel
  // does not silently turn off automatic uploads while visual review is pending.
  // Explicit "Not visible" feedback still disables them for safety.
  const next: ShortsThumbnailFeature = {
    ...feature, state: feature.state === "api_verified" ? "api_verified" : "testing",
    testRuns: [run, ...feature.testRuns],
  };
  await saveFeature(auth, account.id, metadata, next);
  return { run, feature: view(next, account.id), studioUrl: `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/edit`, shortsUrl: `https://www.youtube.com/shorts/${encodeURIComponent(videoId)}` };
}

/** Read-only diagnosis: compare the operator-selected cover with the authenticated
 * thumbnail image currently served by YouTube's own image CDN. API acceptance alone
 * cannot pass a Shorts visual test; that decision remains with the operator. */
export async function getShortsThumbnailEvidence(auth: AuthContext, params: Record<string, unknown>, client: ShortsThumbnailClient) {
  requireAdmin(auth);
  const runId = typeof params.testRunId === "string" ? params.testRunId : "";
  const { account, metadata } = await loadAccountSettings(auth);
  const run = resolveShortsThumbnailFeature(metadata).testRuns.find((item) => item.id === runId);
  if (!run) throw new Error("Unknown thumbnail test run.");
  const video = await client.getVideo(run.videoId);
  if (!video || !account.external_account_id || video.channelId !== account.external_account_id) {
    throw new Error("Test video is not owned by the connected YouTube channel.");
  }
  const status = await client.getThumbnailStatus(run.videoId);
  const signedUrl = status.thumbnails?.high?.url ?? status.thumbnails?.medium?.url ?? status.thumbnails?.default?.url ?? null;
  let served: { httpStatus: number; contentType: string | null; byteCount: number; sha256: string | null } | null = null;
  if (signedUrl) {
    const response = await fetch(signedUrl, { headers: { "user-agent": "Mozilla/5.0" } });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = response.ok && bytes.length
      ? await crypto.subtle.digest("SHA-256", bytes)
      : null;
    served = {
      httpStatus: response.status,
      contentType: response.headers.get("content-type"),
      byteCount: bytes.length,
      sha256: digest ? Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("") : null,
    };
  }
  return {
    testRunId: run.id, videoId: run.videoId,
    sourceType: run.sourceType, sourceId: run.sourceId, sourceFileId: run.thumbnailFileId,
    videoPrivacy: video.privacyStatus, videoPublishAt: video.publishAt,
    apiAccepted: run.apiAccepted, hasCustomThumbnail: status.hasCustomThumbnail,
    youtubePreviewUrl: signedUrl, served, visualResult: run.visualResult,
    caveat: "The YouTube CDN preview is evidence of stored artwork, not proof of its presentation inside YouTube Studio or Shorts feeds.",
  };
}

export async function confirmShortsThumbnailVisual(auth: AuthContext, params: Record<string, unknown>) {
  requireAdmin(auth);
  const { account, metadata } = await loadAccountSettings(auth);
  const feature = resolveShortsThumbnailFeature(metadata);
  const run = feature.testRuns.find((candidate) => candidate.id === params.testRunId);
  if (!run) throw new Error("Test run not found for this account.");
  if (run.visualResult !== "pending") throw new Error("This test run was already reviewed.");
  const reviewedAt = new Date().toISOString();
  let next: ShortsThumbnailFeature;
  if (params.result === "confirmed") {
    if (!run.apiAccepted) throw new Error("YouTube did not accept this test upload, so it cannot enable automatic thumbnails.");
    if (params.confirmation !== VISUAL_CONFIRMATION_PHRASE) throw new Error(`Type exactly "${VISUAL_CONFIRMATION_PHRASE}" to confirm.`);
    const reviewed = { ...run, visualResult: "confirmed" as const, visualReviewedBy: auth.userId, visualReviewedAt: reviewedAt };
    next = feature.state === "api_verified"
      ? { ...feature, testRuns: feature.testRuns.map((candidate) => candidate.id === run.id ? reviewed : candidate) }
      : {
        ...feature, state: "api_verified", enabledBy: auth.userId, enabledAt: reviewedAt, enabledFromTestRunId: run.id,
        disabledBy: null, disabledAt: null, note: null,
        testRuns: feature.testRuns.map((candidate) => candidate.id === run.id ? reviewed : candidate),
      };
  } else if (params.result === "not_visible") {
    const reviewed = { ...run, visualResult: "not_visible" as const, visualReviewedBy: auth.userId, visualReviewedAt: reviewedAt };
    // An explicit retest is diagnostic, not an instruction to change the
    // previously verified channel-wide publishing configuration. Disable
    // separately with the existing "Turn off" button if desired.
    next = feature.state === "api_verified"
      ? {
        ...feature, note: "Latest Shorts thumbnail retest did not visibly render. Automatic upload settings are unchanged.",
        testRuns: feature.testRuns.map((candidate) => candidate.id === run.id ? reviewed : candidate),
      }
      : {
        ...feature, state: "disabled", enabledBy: null, enabledAt: null, enabledFromTestRunId: null,
        disabledBy: auth.userId, disabledAt: reviewedAt, note: "Test thumbnail was not visible on Shorts surfaces.",
        testRuns: feature.testRuns.map((candidate) => candidate.id === run.id ? reviewed : candidate),
      };
  } else {
    throw new Error("Choose whether the thumbnail was visible.");
  }
  await saveFeature(auth, account.id, metadata, next);
  return view(next, account.id);
}

export async function disableShortsThumbnailApi(auth: AuthContext) {
  requireMutate(auth);
  const { account, metadata } = await loadAccountSettings(auth);
  const feature = resolveShortsThumbnailFeature(metadata);
  const next: ShortsThumbnailFeature = {
    ...feature, state: "disabled", enabledBy: null, enabledAt: null, enabledFromTestRunId: null,
    disabledBy: auth.userId, disabledAt: new Date().toISOString(), note: "Disabled by operator.",
  };
  await saveFeature(auth, account.id, metadata, next);
  return view(next, account.id);
}

/** Explicit opt-in: queue thumbnail-only jobs for operator-selected manual_required Shorts. */
export async function backfillShortThumbnails(auth: AuthContext, params: Record<string, unknown>) {
  requireAdmin(auth);
  const ids = Array.isArray(params.publicationIds) ? [...new Set(params.publicationIds.filter((id): id is string => typeof id === "string" && UUID.test(id)))] : [];
  if (!ids.length || ids.length > MAX_BACKFILL) throw new Error(`Select between 1 and ${MAX_BACKFILL} Shorts.`);
  if (params.confirmation !== "BACKFILL") throw new Error('Type "BACKFILL" to confirm.');
  const { account, metadata } = await loadAccountSettings(auth);
  if (!isShortsThumbnailApiEnabled(metadata)) throw new Error("Automatic Shorts thumbnails are not enabled for this channel.");

  const { data: pubs, error } = await auth.db.from("ai_operations_social_publications")
    .select("id,tenant_id,account_id,project_id,clip_id,status,content_format,delivery_mode,external_video_id,thumbnail_file_id,platform_payload")
    .in("id", ids).eq("tenant_id", auth.tenantId);
  if (error) throw new Error(error.message);
  const queued: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of ids) {
    const pub = ((pubs ?? []) as Record<string, unknown>[]).find((candidate) => candidate.id === id);
    const payload = (pub?.platform_payload ?? {}) as Record<string, unknown>;
    const thumb = (payload.thumbnail ?? {}) as Record<string, unknown>;
    const reason = !pub ? "not found"
      : pub.account_id !== account.id ? "different channel"
      : pub.content_format !== "short" || pub.delivery_mode !== "scheduled" ? "not a scheduled Short"
      : !pub.external_video_id ? "not uploaded"
      : !["scheduled", "uploaded", "published"].includes(String(pub.status)) ? `status ${pub.status}`
      : !pub.thumbnail_file_id ? "no saved cover"
      : thumb.apiStatus !== "manual_required" ? `thumbnail is ${thumb.apiStatus ?? "not pending"}`
      : null;
    if (reason) { skipped.push({ id, reason }); continue; }
    const { data: active } = await auth.db.from("ai_operations_video_jobs").select("id")
      .eq("social_publication_id", id).eq("job_type", "publish_youtube").in("status", ["queued", "running", "claimed"]);
    if (active?.length) { skipped.push({ id, reason: "a YouTube job is already queued" }); continue; }
    const { error: jobError } = await auth.db.from("ai_operations_video_jobs").insert({
      tenant_id: auth.tenantId, project_id: pub!.project_id, clip_id: pub!.clip_id, social_publication_id: id,
      job_type: "publish_youtube", status: "queued",
      payload: { thumbnail_only: true, thumbnail_file_id: pub!.thumbnail_file_id, source: "operator_backfill", requested_by: auth.userId },
    });
    if (jobError) { skipped.push({ id, reason: jobError.message }); continue; }
    await auth.db.from("ai_operations_social_publications").update({
      platform_payload: { ...payload, thumbnail: { ...thumb, apiStatus: "queued", backfillRequestedAt: new Date().toISOString() } },
    }).eq("id", id).eq("tenant_id", auth.tenantId);
    await auth.db.from("ai_operations_social_publication_events").insert({
      tenant_id: auth.tenantId, publication_id: id, event_type: "thumbnail_backfill_queued", detail: { requestedBy: auth.userId },
    });
    queued.push(id);
  }
  return { queued, skipped };
}

