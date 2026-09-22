const UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3/videos";
const API = "https://www.googleapis.com/youtube/v3";

export type VideoSnippetStatus = {
  snippet: {
    title: string;
    description: string;
    tags: string[];
    categoryId: string;
    defaultLanguage?: string;
  };
  status: {
    privacyStatus: "public" | "unlisted" | "private";
    publishAt?: string;
    license: "youtube" | "creativeCommon";
    embeddable: boolean;
    publicStatsViewable: boolean;
    selfDeclaredMadeForKids: boolean;
    containsSyntheticMedia: boolean;
  };
};

export class TransientYoutubeError extends Error {}
export class PermanentYoutubeError extends Error {}

function classify(status: number, message: string): never {
  if (status === 429 || status >= 500 || status === 0) throw new TransientYoutubeError(message);
  throw new PermanentYoutubeError(message);
}

export async function createResumableUploadSession(
  accessToken: string,
  body: VideoSnippetStatus,
  totalBytes: number,
  mimeType: string,
): Promise<string> {
  const response = await fetch(`${UPLOAD_API}?uploadType=resumable&part=snippet,status,contentDetails`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": mimeType,
      "x-upload-content-length": String(totalBytes),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    classify(response.status, payload?.error?.message ?? `Resumable session creation failed (${response.status}).`);
  }
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
  const response = await fetch(sessionUrl, {
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
  const payload = await response.json().catch(() => ({}));
  classify(response.status, payload?.error?.message ?? `Upload chunk failed (${response.status}).`);
}

/** Queries how much of a resumable session YouTube has already received, so a fresh
 * invocation can resume from the authoritative offset rather than its own bookkeeping. */
export async function queryUploadOffset(sessionUrl: string, totalBytes: number): Promise<number> {
  const response = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "content-length": "0", "content-range": `bytes */${totalBytes}` },
  });
  if (response.status === 308) {
    const range = response.headers.get("range");
    return range ? Number(range.split("-")[1] ?? -1) + 1 : 0;
  }
  if (response.status === 200 || response.status === 201) {
    // Upload already completed on a previous tick; caller should treat this as done.
    return totalBytes;
  }
  classify(response.status, `Could not query upload offset (${response.status}).`);
}

export async function setThumbnail(accessToken: string, videoId: string, bytes: ArrayBuffer, mimeType: string) {
  const response = await fetch(`${API}/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": mimeType },
    body: bytes,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    classify(response.status, payload?.error?.message ?? `Thumbnail upload failed (${response.status}).`);
  }
}

export async function isVideoInPlaylist(accessToken: string, playlistId: string, videoId: string): Promise<boolean> {
  const url = `${API}/playlistItems?part=snippet&playlistId=${encodeURIComponent(playlistId)}&videoId=${encodeURIComponent(videoId)}&maxResults=1`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return false;
  const payload = await response.json().catch(() => ({}));
  return Array.isArray(payload?.items) && payload.items.length > 0;
}

export async function addToPlaylist(accessToken: string, playlistId: string, videoId: string) {
  const response = await fetch(`${API}/playlistItems?part=snippet`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    classify(response.status, payload?.error?.message ?? `Playlist insert failed (${response.status}).`);
  }
}

export async function updateVideoStatus(accessToken: string, videoId: string, status: Partial<VideoSnippetStatus["status"]>) {
  const response = await fetch(`${API}/videos?part=status`, {
    method: "PUT",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ id: videoId, status }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    classify(response.status, payload?.error?.message ?? `Video status update failed (${response.status}).`);
  }
}
