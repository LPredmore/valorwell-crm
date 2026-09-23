import { describe, expect, it } from "vitest";
import { shortsGeometryIssue } from "../../supabase/functions/_shared/shorts-geometry";

describe("shortsGeometryIssue", () => {
  it("accepts a vertical 9:16 video", () => expect(shortsGeometryIssue({width:720,height:1280,durationMillis:43000})).toBeNull());
  it("accepts a square video", () => expect(shortsGeometryIssue({width:1080,height:1080,durationMillis:180000})).toBeNull());
  it("rejects landscape despite a short clip duration", () =>
    expect(shortsGeometryIssue({width:1280,height:720,durationMillis:34000})).toMatch(/landscape/));
  it("rejects missing dimensions instead of approving blindly", () =>
    expect(shortsGeometryIssue({durationMillis:34000})).toMatch(/dimensions/));
  it("rejects a video longer than three minutes", () =>
    expect(shortsGeometryIssue({width:720,height:1280,durationMillis:181000})).toMatch(/180 seconds/));
});
