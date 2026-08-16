import { describe, expect, it } from "vitest";
import { WORK_TYPE_SPECS, specFor } from "../../supabase/functions/_shared/ai-ops-prompts";
import { readFileSync } from "node:fs";

describe("AI Operations model configuration", () => {
  it("keeps Flash as the fallback while permitting explicit Pro routing", () => {
    const runtime = readFileSync("supabase/functions/_shared/ai-ops.ts", "utf8");
    expect(runtime).toContain('AI_OPS_MODEL = "gemini-flash-latest"');
    expect(runtime).toContain('options.model ?? "gemini-2.5-pro"');
    expect(runtime).not.toContain("gemini-pro-latest");
  });

  it("uses the current prompt versions for revised judgment-heavy prompts", () => {
    expect(specFor("client_journey_review").promptVersion).toBe("2");
    expect(specFor("communications_qa_review").promptVersion).toBe("2");
    expect(specFor("executive_brief_synthesis").promptVersion).toBe("2");
    expect(specFor("system_integrity_triage").promptVersion).toBe("1");
    expect(specFor("youtube_comment_review").promptVersion).toBe("1");
  });

  it("assigns a thinking level to every work type", () => {
    for (const spec of Object.values(WORK_TYPE_SPECS)) {
      expect(["low", "medium", "high"]).toContain(spec.thinkingLevel);
    }
    expect(specFor("client_journey_review").thinkingLevel).toBe("high");
    expect(specFor("executive_brief_synthesis").thinkingLevel).toBe("high");
  });

  it("requires entity coverage only for per-entity work types", () => {
    expect(specFor("client_journey_review").requiresEntityCoverage).toBe(true);
    expect(specFor("communications_qa_review").requiresEntityCoverage).toBe(true);
    expect(specFor("youtube_comment_review").requiresEntityCoverage).toBe(true);
    expect(specFor("system_integrity_triage").requiresEntityCoverage).toBe(false);
    expect(specFor("executive_brief_synthesis").requiresEntityCoverage).toBe(false);
  });

  it("rejects unknown work types", () => {
    expect(() => specFor("not_a_work_type")).toThrow(/Unknown AI Operations work type/);
  });
});
