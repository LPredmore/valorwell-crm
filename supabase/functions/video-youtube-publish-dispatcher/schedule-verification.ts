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
