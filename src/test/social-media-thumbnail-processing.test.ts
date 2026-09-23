import { describe, it, expect } from "vitest";
import { thumbnailProcessingDecision } from "../../supabase/functions/video-youtube-publish-dispatcher/thumbnail-readiness";

const uploadedAt = "2026-09-23T16:00:00.000Z";
const fiveMinutes = Date.parse("2026-09-23T16:05:00.000Z");
const thirteenMinutes = Date.parse("2026-09-23T16:13:00.000Z");

describe("Shorts thumbnail upload processing gate", () => {
  it("allows uploading after YouTube confirms that the video finished processing", () => {
    expect(thumbnailProcessingDecision("succeeded", uploadedAt, fiveMinutes)).toBe("ready");
  });
  it("waits for YouTube processing instead of immediately claiming thumbnail success", () => {
    expect(thumbnailProcessingDecision("processing", uploadedAt, fiveMinutes)).toBe("wait");
    expect(thumbnailProcessingDecision(null, uploadedAt, fiveMinutes)).toBe("wait");
  });
  it("stops polling after twelve minutes when processing data is unavailable", () => {
    expect(thumbnailProcessingDecision("processing", uploadedAt, thirteenMinutes)).toBe("processing_unverified");
    expect(thumbnailProcessingDecision(null, uploadedAt, thirteenMinutes)).toBe("processing_unverified");
  });
  it("halts thumbnail submission when the uploaded video processing actually failed", () => {
    expect(thumbnailProcessingDecision("failed", uploadedAt, fiveMinutes)).toBe("processing_failed");
  });
});
