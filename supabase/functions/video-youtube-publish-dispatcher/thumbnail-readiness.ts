/** 
 * YouTube can accept a thumbnail while a newly uploaded video is still processing.
 * Postpone the API thumbnail request until processing completes, but never leave
 * a published video stuck indefinitely if YouTube does not expose processing data.
 *
 * Note: processing completion improves timing, but is not proof that Shorts
 * surfaces display an API-submitted image. Only the official YouTube Studio
 * upload flow is documented for Shorts custom thumbnails.
 */
export type ThumbnailProcessingDecision = "ready" | "wait" | "processing_failed" | "processing_unverified";

export function thumbnailProcessingDecision(
  processingStatus: string | null,
  uploadedAt: string | null,
  nowMs: number,
  maxWaitMs = 12 * 60 * 1000,
): ThumbnailProcessingDecision {
  if (processingStatus === "succeeded") return "ready";
  if (processingStatus === "failed") return "processing_failed";

  const uploaded = uploadedAt ? Date.parse(uploadedAt) : NaN;
  if (!Number.isFinite(uploaded) || nowMs - uploaded >= maxWaitMs) {
    return "processing_unverified";
  }
  return "wait";
}
