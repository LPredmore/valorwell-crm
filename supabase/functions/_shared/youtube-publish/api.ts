/**
 * YouTube Data API v3 calls used by publishing, rescheduling and reconciliation. Only
 * uses fetch, so it is shared by the publish worker and the CRM control plane and can be
 * exercised from tests with a stubbed fetch. Access tokens are passed in by the caller.
 */
import { httpFailure, parseRetryAfter, PermanentYoutubeError, TransientYoutubeError } from "./errors.ts";

export { PermanentYoutubeError, TransientYoutubeError } from "./errors.ts";

const UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3/videos";
const API = "https://www.googleapis.com/youtube/v3";

export type YoutubePrivacy = "public" | "unlisted" | "private";

export type YoutubeVideoStatus = {
  privacyStatus: YoutubePrivacy;
  publishAt?: string;
  license: "youtube" | "creativeCommon";
  embeddable: boolean;
  publicStatsViewable: boolean;
  selfDeclaredMadeForKids: boolean;
  containsSyntheticMedia: boolean;
};

export type VideoSnippetStatus = {
  snippet: {
    title: string;
    description: string;
    tags: string[];
    categoryId: string;
    defaultLanguage?: string;
  };
  status: YoutubeVideoStatus;
};

/** Everything YouTube reports about a video's delivery state. */
export type YoutubeDeliveryStatus = {
  privacyStatus: string | null;
  publishAt: string | null;
  uploadStatus: string | null;
  processingStatus: string | null;
  rejectionReason: string | null;
  failureReason: string | null;
  publishedAt: string | null;
};

async function failure(response: Response, fallback: string): Promise<never> {
  const payload = await response.json().catch(() => ({}));
  throw httpFailure(
    response.status,
    payload?.error?.message ?? fallback,
    parseRetryAfter(response.headers.get("retry-after"), Date.now()),
  );
}

async function request(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    // DNS failures, resets and aborted connections never reached YouTube: safe to retry.
    throw new TransientYoutubeError(`Network error calling YouTube: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The full, mutable videos.status resource for a publication. videos.update replaces the
 * whole status part, so every update must resend all of these or YouTube resets the
 * omitted ones to their defaults.
 */
export function buildYoutubeStatus(
  pub: Record<string, unknown>,
  overrides: Partial<YoutubeVideoStatus> = {},
): YoutubeVideoStatus {
  const scheduled = pub.delivery_mode === "scheduled";
  const privacyStatus: YoutubePrivacy = scheduled ? "private" : (pub.desired_privacy_status as YoutubePrivacy);
  const status: YoutubeVideoStatus = {
    privacyStatus,
    ...(scheduled && typeof pub.scheduled_for === "string" ? { publishAt: new Date(pub.scheduled_for).toISOString() } : {}),
    license: (pub.license as YoutubeVideoStatus["license"]) ?? "youtube",
    embeddable: Boolean(pub.embeddable),
    publicStatsViewable: Boolean(pub.public_stats_viewable),
    selfDeclaredMadeForKids: Boolean(pub.made_for_kids),
    containsSyntheticMedia: Boolean(pub.contains_synthetic_media),
  };
  return { ...status, ...overrides };
}

export async function createResumableUploadSession(
  accessToken: string,
  body: VideoSnippetStatus,
  totalBytes: number,
  mimeType: string,
  options: { notifySubscribers: boolean },
): Promise<string> {
  const params = new URLSearchParams({
    uploadType: "resumable",
    part: "snippet,status,contentDetails",
    notifySubscribers: String(options.notifySubscribers),
  });
  const response = await request(`${UPLOAD_API}?${params}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": mimeType,
      "x-upload-content-length": String(totalBytes),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) await failure(response, `Resumable session creation failed (${response.status}).`);
  const location = response.headers.get("location");
  if (!location) throw new PermanentYoutubeError("YouTube did not return a resumable upload session URL.");
  return location;
}

export type ChunkUploadResult =
  | { done: false; nextByte: number }
  | { done: true; videoId: string; response: Record<string, unknown> };

export async function uploadChunk(
  sessionUrl: string,
  bytes: ArrayBuffer,
  start: number,
  totalBytes: number,
): Promise<ChunkUploadResult> {
  const end = start + bytes.byteLength - 1;
  const response = await request(sessionUrl, {
    method: "PUT",
    headers: {
      "content-length": String(bytes.byteLength),
      "content-range": `bytes ${start}-${end}/${totalBytes}`,
    },
    body: bytes,
  });

  if (response.status === 308) {
    const range = response.headers.get("range");
    const receivedUpTo = range ? Number(range.split("-")[1] ?? -1) : end;
    return { done: false, nextByte: receivedUpTo + 1 };
  }
  if (response.status === 200 || response.status === 201) {
    const payload = await response.json();
    const videoId = String(payload?.id ?? "");
    if (!videoId) throw new PermanentYoutubeError("YouTube upload completed but returned no video id.");
    return { done: true, videoId, response: payload };
  }
  return await failure(response, `Upload chunk failed (${response.status}).`);
}

export type UploadOffset =
  | { complete: false; nextByte: number }
  | { complete: true; videoId: string | null; response: Record<string, unknown> | null };

/** Asks YouTube how much of a resumable session it already holds, so a fresh invocation
 * resumes from the authoritative offset rather than its own bookkeeping. A session that
 * already completed returns the created video resource, which is how a worker that
 * crashed after the final chunk recovers the video id instead of uploading again. */
export async function queryUploadOffset(sessionUrl: string, totalBytes: number): Promise<UploadOffset> {
  const response = await request(sessionUrl, {
    method: "PUT",
    headers: { "content-length": "0", "content-range": `bytes */${totalBytes}` },
  });
  if (response.status === 308) {
    const range = response.headers.get("range");
    return { complete: false, nextByte: range ? Number(range.split("-")[1] ?? -1) + 1 : 0 };
  }
  if (response.status === 200 || response.status === 201) {
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    const videoId = payload && typeof payload.id === "string" && payload.id ? payload.id : null;
    return { complete: true, videoId, response: payload };
  }
  if (response.status === 404 || response.status === 410) {
    throw new PermanentYoutubeError(
      `The YouTube upload session has expired (${response.status}). No video was created from it; retry to start a new upload.`,
      { status: response.status },
    );
  }
  return await failure(response, `Could not query upload offset (${response.status}).`);
}

export async function setThumbnail(accessToken: string, videoId: string, bytes: ArrayBuffer, mimeType: string) {
  const response = await request(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": mimeType },
    body: bytes,
  });
  if (!response.ok) await failure(response, `Thumbnail upload failed (${response.status}).`);
}

/** Read back the owner-only custom thumbnail flag after a media upload. */
export async function getYoutubeThumbnailStatus(accessToken: string, videoId: string): Promise<{
  hasCustomThumbnail: boolean | null;
  processingStatus: string | null;
  thumbnails: Record<string, { url?: string }> | null;
}> {
  const url = `${API}/videos?part=snippet,contentDetails,processingDetails&id=${encodeURIComponent(videoId)}`;
  const response = await request(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) await failure(response, `Thumbnail verification failed (${response.status}).`);
  const body = await response.json().catch(() => ({}));
  const video = body?.items?.[0];
  if (!video) throw new PermanentYoutubeError("YouTube returned no matching video during thumbnail verification.");
  return {
    hasCustomThumbnail: typeof video.contentDetails?.hasCustomThumbnail === "boolean"
      ? video.contentDetails.hasCustomThumbnail : null,
    processingStatus: video.processingDetails?.processingStatus ?? null,
    thumbnails: video.snippet?.thumbnails ?? null,
  };
}

function toDeliveryStatus(video: Record<string, any>): YoutubeDeliveryStatus {
  return {
    privacyStatus: video.status?.privacyStatus ?? null,
    publishAt: video.status?.publishAt ?? null,
    uploadStatus: video.status?.uploadStatus ?? null,
    processingStatus: video.processingDetails?.processingStatus ?? null,
    rejectionReason: video.status?.rejectionReason ?? null,
    failureReason: video.status?.failureReason ?? video.processingDetails?.processingFailureReason ?? null,
    publishedAt: video.snippet?.publishedAt ?? null,
  };
}

/** Delivery status for up to 50 videos in one quota unit. Missing ids were deleted or are
 * no longer visible to the channel owner, and map to null. */
export async function getYoutubeDeliveryStatuses(
  accessToken: string,
  videoIds: string[],
): Promise<Map<string, YoutubeDeliveryStatus | null>> {
  const result = new Map<string, YoutubeDeliveryStatus | null>();
  for (let index = 0; index < videoIds.length; index += 50) {
    const batch = videoIds.slice(index, index + 50);
    const url = `${API}/videos?part=snippet,status,processingDetails&maxResults=50&id=${encodeURIComponent(batch.join(","))}`;
    const response = await request(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) await failure(response, `Video status lookup failed (${response.status}).`);
    const body = await response.json().catch(() => ({}));
    const found = new Map<string, YoutubeDeliveryStatus>();
    for (const video of (body?.items ?? []) as Record<string, any>[]) {
      if (typeof video.id === "string") found.set(video.id, toDeliveryStatus(video));
    }
    for (const id of batch) result.set(id, found.get(id) ?? null);
  }
  return result;
}

export async function getYoutubeDeliveryStatus(accessToken: string, videoId: string): Promise<YoutubeDeliveryStatus> {
  const status = (await getYoutubeDeliveryStatuses(accessToken, [videoId])).get(videoId);
  if (!status) {
    throw new PermanentYoutubeError(`YouTube returned no video ${videoId}; it may have been deleted.`, { status: 404 });
  }
  return status;
}

export async function isVideoInPlaylist(accessToken: string, playlistId: string, videoId: string): Promise<boolean> {
  const url = `${API}/playlistItems?part=snippet&playlistId=${encodeURIComponent(playlistId)}&videoId=${encodeURIComponent(videoId)}&maxResults=1`;
  const response = await request(url, { headers: { authorization: `Bearer ${accessToken}` } });
  // Treat an ambiguous lookup as "absent" only for 404; anything transient must retry
  // rather than risk inserting the same video into a playlist twice.
  if (response.status === 404) return false;
  if (!response.ok) await failure(response, `Playlist lookup failed (${response.status}).`);
  const payload = await response.json().catch(() => ({}));
  return Array.isArray(payload?.items) && payload.items.length > 0;
}

export async function addToPlaylist(accessToken: string, playlistId: string, videoId: string) {
  const response = await request(`${API}/playlistItems?part=snippet`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } }),
  });
  if (!response.ok) await failure(response, `Playlist insert failed (${response.status}).`);
}

/** Replaces the video's status part. Always pass the complete status (see buildYoutubeStatus). */
export async function updateVideoStatus(accessToken: string, videoId: string, status: YoutubeVideoStatus) {
  const response = await request(`${API}/videos?part=status`, {
    method: "PUT",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ id: videoId, status }),
  });
  if (!response.ok) await failure(response, `Video status update failed (${response.status}).`);
}
