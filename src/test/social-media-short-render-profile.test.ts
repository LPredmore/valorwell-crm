import { describe, expect, it } from "vitest";
import { isVerifiedCurrentShortRender } from "../../supabase/functions/_shared/short-render-profile";

const valid = {
  drive_file_id: "exact-current-video-file",
  render_profile: "youtube_short_9x16",
  render_width: 1080,
  render_height: 1920,
  render_method: "ffmpeg_blurred_background_preserve_frame",
};

describe("Social Media Manager current Shorts render guard", () => {
  it("accepts ffprobe-verified 1080x1920 for the exact current Drive object", () => {
    expect(isVerifiedCurrentShortRender(valid, "exact-current-video-file")).toBe(true);
  });

  it("rejects a profile that refers to an older video after a render replacement", () => {
    expect(isVerifiedCurrentShortRender(valid, "newer-drive-file")).toBe(false);
  });

  it("rejects the legacy 1280x720 Cloudflare renders with missing metadata", () => {
    expect(isVerifiedCurrentShortRender({ drive_file_id: "exact-current-video-file", cloudflare_stage: "drive_complete" }, "exact-current-video-file")).toBe(false);
    expect(isVerifiedCurrentShortRender({ ...valid, render_width: 1280, render_height: 720 }, "exact-current-video-file")).toBe(false);
  });

  it("rejects a missing source file or missing render record", () => {
    expect(isVerifiedCurrentShortRender(valid, null)).toBe(false);
    expect(isVerifiedCurrentShortRender(null, "exact-current-video-file")).toBe(false);
  });
});
