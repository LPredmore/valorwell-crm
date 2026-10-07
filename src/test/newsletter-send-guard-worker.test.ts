import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("supabase/functions/newsletter-send-worker/index.ts", "utf8");

describe("newsletter send worker guard handling", () => {
  it("declares every counter it increments (no ReferenceError on guard block)", () => {
    for (const name of ["sent", "failed", "retried", "recordingErrors", "skipped", "batches"]) {
      if (src.includes(`${name} += 1`)) {
        expect(src).toMatch(new RegExp(`let ${name} = 0;`));
      }
    }
  });

  it("halts the newsletter instead of re-claiming in a loop when paused or not sending", () => {
    expect(src).toContain('new Set(["runtime_not_active", "newsletter_not_sending"])');
    expect(src).toMatch(/while \(batches < maxBatches && !haltReason\)/);
    expect(src).toMatch(/haltReason = reason;\s*break;/);
  });
});
