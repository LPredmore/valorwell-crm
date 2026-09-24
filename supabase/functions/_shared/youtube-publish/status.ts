/**
 * Pure decision rules for what YouTube reports about an uploaded video. YouTube is the
 * authority for every post-upload CRM status: the worker, the rescheduler and the
 * reconciliation pass all read the video back and apply one of these rules rather than
 * trusting the upload response or the clock.
 */

export type YouTubeScheduleStatus = {
  privacyStatus: string | null;
  publishAt: string | null;
  uploadStatus: string | null;
  processingStatus: string | null;
  rejectionReason: string | null;
  failureReason: string | null;
};

export type ScheduleVerificationDecision =
  | { state: "verified"; deltaMs: number }
  | { state: "wait"; reason: string }
  | { state: "failed"; reason: string };

export function verifyScheduledDelivery(
  actual: YouTubeScheduleStatus,
  expectedPublishAt: string | null,
  uploadedAt: string | null,
  nowMs: number,
  maxWaitMs = 5 * 60 * 1000,
): ScheduleVerificationDecision {
  if (actual.uploadStatus === "rejected" || actual.processingStatus === "failed") {
    return {
      state: "failed",
      reason: actual.rejectionReason || actual.failureReason || "YouTube rejected or failed processing the scheduled upload.",
    };
  }

  const expectedMs = expectedPublishAt ? Date.parse(expectedPublishAt) : NaN;
  if (!Number.isFinite(expectedMs)) {
    return { state: "failed", reason: "The publication has no valid scheduled publish time." };
  }

  const actualMs = actual.publishAt ? Date.parse(actual.publishAt) : NaN;
  if (actual.privacyStatus === "private" && Number.isFinite(actualMs)) {
    const deltaMs = Math.abs(actualMs - expectedMs);
    if (deltaMs <= 10_000) return { state: "verified", deltaMs };
  }

  const uploadedMs = uploadedAt ? Date.parse(uploadedAt) : NaN;
  if (Number.isFinite(uploadedMs) && nowMs - uploadedMs < maxWaitMs) {
    return {
      state: "wait",
      reason: "Waiting for YouTube to confirm private visibility and the scheduled publish time.",
    };
  }

  return {
    state: "failed",
    reason: "YouTube did not confirm the requested private scheduled publish time.",
  };
}
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

const ABNORMAL_UPLOAD_STATUSES = new Set(["rejected", "failed", "deleted"]);
const ABNORMAL_PROCESSING_STATUSES = new Set(["failed", "terminated"]);

export type ImmediateVerificationDecision =
  | { state: "verified" }
  | { state: "wait"; reason: string }
  | { state: "unconfirmed"; reason: string }
  | { state: "failed"; reason: string };

/**
 * Decides whether an immediate (Private / Unlisted / Public now) upload can be finalized.
 * Abnormal states and a privacy mismatch are terminal -- in particular YouTube locks
 * uploads from unaudited API projects to Private, which must never be shown as Published.
 * Normal asynchronous processing is polled for up to maxWaitMs; after that the upload is
 * finalized with its processing state recorded as unconfirmed rather than blocking forever.
 */
export function verifyImmediateDelivery(
  actual: YouTubeScheduleStatus,
  desiredPrivacy: string,
  uploadedAt: string | null,
  nowMs: number,
  maxWaitMs = 60 * 60 * 1000,
): ImmediateVerificationDecision {
  if (ABNORMAL_UPLOAD_STATUSES.has(String(actual.uploadStatus)) ||
      ABNORMAL_PROCESSING_STATUSES.has(String(actual.processingStatus))) {
    return {
      state: "failed",
      reason: actual.rejectionReason || actual.failureReason ||
        `YouTube reports upload status "${actual.uploadStatus}" and processing status "${actual.processingStatus}".`,
    };
  }
  if (actual.privacyStatus !== desiredPrivacy) {
    return {
      state: "failed",
      reason: actual.privacyStatus === "private"
        ? `YouTube kept the video Private instead of ${desiredPrivacy}. YouTube locks uploads from unverified API projects to Private; check the video in YouTube Studio.`
        : `YouTube reports privacy "${actual.privacyStatus}" but "${desiredPrivacy}" was requested.`,
    };
  }
  if (actual.uploadStatus === "processed" || actual.processingStatus === "succeeded") return { state: "verified" };

  const uploadedMs = uploadedAt ? Date.parse(uploadedAt) : NaN;
  if (Number.isFinite(uploadedMs) && nowMs - uploadedMs < maxWaitMs) {
    return { state: "wait", reason: "Waiting for YouTube to finish processing the upload." };
  }
  return {
    state: "unconfirmed",
    reason: `YouTube had not finished processing after ${Math.round(maxWaitMs / 60000)} minutes (upload status "${actual.uploadStatus}", processing "${actual.processingStatus}").`,
  };
}
