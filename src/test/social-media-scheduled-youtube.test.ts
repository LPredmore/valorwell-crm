import { describe, expect, it } from "vitest";
import { verifyScheduledDelivery } from "../../supabase/functions/video-youtube-publish-dispatcher/schedule-verification";

const expected = "2026-09-24T18:00:00.000Z";
const uploaded = "2026-09-23T21:00:00.000Z";

describe("YouTube scheduled delivery verification", () => {
  it("accepts private videos with the requested publishAt", () => {
    expect(verifyScheduledDelivery({
      privacyStatus: "private",
      publishAt: expected,
      uploadStatus: "uploaded",
      processingStatus: "succeeded",
      rejectionReason: null,
      failureReason: null,
    }, expected, uploaded, Date.parse("2026-09-23T21:01:00.000Z"))).toEqual({
      state: "verified",
      deltaMs: 0,
    });
  });

  it("waits briefly for YouTube to expose schedule status after upload", () => {
    const result = verifyScheduledDelivery({
      privacyStatus: "private",
      publishAt: null,
      uploadStatus: "uploaded",
      processingStatus: "processing",
      rejectionReason: null,
      failureReason: null,
    }, expected, uploaded, Date.parse("2026-09-23T21:02:00.000Z"));
    expect(result.state).toBe("wait");
  });

  it("fails rather than claiming Scheduled if YouTube never confirms publishAt", () => {
    const result = verifyScheduledDelivery({
      privacyStatus: "private",
      publishAt: null,
      uploadStatus: "uploaded",
      processingStatus: "succeeded",
      rejectionReason: null,
      failureReason: null,
    }, expected, uploaded, Date.parse("2026-09-23T21:06:00.000Z"));
    expect(result.state).toBe("failed");
  });

  it("fails immediately for rejected or failed processing", () => {
    const result = verifyScheduledDelivery({
      privacyStatus: "private",
      publishAt: expected,
      uploadStatus: "rejected",
      processingStatus: "failed",
      rejectionReason: "copyright",
      failureReason: null,
    }, expected, uploaded, Date.parse("2026-09-23T21:01:00.000Z"));
    expect(result).toEqual({ state: "failed", reason: "copyright" });
  });
});
