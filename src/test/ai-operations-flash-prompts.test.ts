import { describe, expect, it } from "vitest";
import { WORK_TYPE_SPECS, specFor } from "../../supabase/functions/_shared/ai-ops-prompts";
import { readFileSync } from "node:fs";
import { resolveAiOpsModel } from "../../supabase/functions/_shared/ai-ops-model";

describe("AI Operations model configuration", () => {
  it("keeps Gemini 3.6 Flash authoritative for every Gemini-backed call", () => {
    const runtime = readFileSync("supabase/functions/_shared/ai-ops-model.ts", "utf8") + readFileSync("supabase/functions/_shared/ai-ops.ts", "utf8");
    expect(runtime).toContain('AI_OPS_MODEL = "gemini-3.6-flash"');
    expect(resolveAiOpsModel("gemini-pro-latest", "gemini-2.5-pro")).toBe("gemini-3.6-flash");
    expect(resolveAiOpsModel("gemini-flash-latest", null)).toBe("gemini-3.6-flash");
    expect(resolveAiOpsModel(null, null)).toBe("gemini-3.6-flash");
  });

  it("ignores stale or alternate requested models and always routes to Gemini 3.6 Flash", () => {
    expect(resolveAiOpsModel("gemini-2.5-pro", "gemini-pro-latest")).toBe("gemini-3.6-flash");
    expect(resolveAiOpsModel("gemini-1.5-pro", null)).toBe("gemini-3.6-flash");
    expect(resolveAiOpsModel("gemini-3.1-pro-preview", null)).toBe("gemini-3.6-flash");
  });

  it("does not allow a per-request worker model override", () => {
    const worker = readFileSync("supabase/functions/ai-operations-model-worker/index.ts", "utf8");
    expect(worker).not.toContain("validationModel");
  });

  it("registers prompt specs for every Phase 2 module work type", () => {
    for (const workType of [
      "staff_service_quality_review",
      "appointment_integrity_review",
      "billing_claims_review",
      "data_quality_review",
    ]) {
      const spec = specFor(workType);
      expect(spec.requiresEntityCoverage).toBe(true);
      expect(spec.responseSchema).toBeTruthy();
    }
  });

  it("uses the current prompt versions for revised judgment-heavy prompts", () => {
    expect(specFor("client_journey_review").promptVersion).toBe("3");
    expect(specFor("communications_qa_review").promptVersion).toBe("2");
    expect(specFor("executive_brief_synthesis").promptVersion).toBe("3");
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
