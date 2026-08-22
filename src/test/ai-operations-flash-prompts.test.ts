import { describe, expect, it } from "vitest";
import { WORK_TYPE_SPECS, specFor } from "../../supabase/functions/_shared/ai-ops-prompts";
import { readFileSync } from "node:fs";
import { boundedModelWorkerBatchSize, resolveAiOpsModel } from "../../supabase/functions/_shared/ai-ops-model";

describe("AI Operations model configuration", () => {
  it("keeps Gemini 3.6 Flash authoritative for every remaining Gemini-backed call", () => {
    const runtime = readFileSync("supabase/functions/_shared/ai-ops-model.ts", "utf8") + readFileSync("supabase/functions/_shared/ai-ops.ts", "utf8");
    expect(runtime).toContain('AI_OPS_MODEL = "gemini-3.6-flash"');
    expect(resolveAiOpsModel("gemini-pro-latest", "gemini-2.5-pro")).toBe("gemini-3.6-flash");
    expect(resolveAiOpsModel("gemini-flash-latest", null)).toBe("gemini-3.6-flash");
    expect(resolveAiOpsModel(null, null)).toBe("gemini-3.6-flash");
  });

  it("ignores stale or alternate requested models and always routes remaining model work to Gemini 3.6 Flash", () => {
    expect(resolveAiOpsModel("gemini-2.5-pro", "gemini-pro-latest")).toBe("gemini-3.6-flash");
    expect(resolveAiOpsModel("gemini-1.5-pro", null)).toBe("gemini-3.6-flash");
    expect(resolveAiOpsModel("gemini-3.1-pro-preview", null)).toBe("gemini-3.6-flash");
  });

  it("does not allow a per-request worker model override", () => {
    const worker = readFileSync("supabase/functions/ai-operations-model-worker/index.ts", "utf8");
    expect(worker).not.toContain("validationModel");
  });

  it("treats configured concurrency as the hard worker ceiling", () => {
    expect(boundedModelWorkerBatchSize(2)).toBe(2);
    expect(boundedModelWorkerBatchSize(2, 1)).toBe(1);
    expect(boundedModelWorkerBatchSize(2, 4)).toBe(2);
    expect(boundedModelWorkerBatchSize(2, 999)).toBe(2);
    expect(boundedModelWorkerBatchSize(undefined, 4)).toBe(2);
    expect(boundedModelWorkerBatchSize("bad", "bad")).toBe(2);

    const worker = readFileSync("supabase/functions/ai-operations-model-worker/index.ts", "utf8");
    expect(worker).toContain("boundedModelWorkerBatchSize(settings?.max_model_concurrency, body?.limit)");
    expect(worker).not.toContain("body?.limit ?? settings?.max_model_concurrency ?? 4");
  });

  it("keeps prompt specs available for manual/on-demand model work", () => {
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

  it("uses the current prompt versions for retained judgment-heavy prompts", () => {
    expect(specFor("client_journey_review").promptVersion).toBe("4");
    expect(specFor("communications_qa_review").promptVersion).toBe("2");
    expect(specFor("executive_brief_synthesis").promptVersion).toBe("4");
    expect(specFor("system_integrity_triage").promptVersion).toBe("1");
    expect(specFor("youtube_comment_review").promptVersion).toBe("1");
  });

  it("moves scheduled Client Journey monitoring to the deterministic Bucket 2 path", () => {
    const dispatcher = readFileSync("supabase/functions/ai-operations-dispatcher/index.ts", "utf8");
    expect(dispatcher).toContain('flag("client_journey_monitoring_enabled")');
    expect(dispatcher).toContain('rpc("ai_ops_evaluate_client_journey_deterministic"');
    expect(dispatcher).not.toContain("ai_ops_build_client_journey_batches");
    expect(dispatcher).not.toContain("ai_ops_ingest_client_journey_results");
    expect(dispatcher).not.toContain('reconcile("client_journey"');

    // The old prompt/worker contract remains available for explicit manual/on-demand work,
    // but it is no longer part of the scheduled dispatcher.
    const prompt = specFor("client_journey_review");
    expect(prompt.systemInstruction).toContain("modelReviewReasons");
    expect(prompt.systemInstruction).toContain("materialStateChanged");
    expect(prompt.systemInstruction).toContain("activeAiFindings");
    expect(JSON.stringify(prompt.responseSchema)).toContain("existing_ai_concern");
    expect(JSON.stringify(prompt.responseSchema)).toContain("relatedAiFindingKeys");
    expect(JSON.stringify(prompt.responseSchema)).toContain("priorAiFindingAssessments");

    const worker = readFileSync("supabase/functions/ai-operations-model-worker/index.ts", "utf8");
    expect(worker).toContain('p_flag_name: "client_journey_ai_enabled"');
    expect(worker).toContain("client_journey_ai_paused");
    expect(worker).toContain("priorAiFindingAssessments");
  });

  it("uses monitoring-specific flags for every automatic Bucket 2 evaluator", () => {
    const dispatcher = readFileSync("supabase/functions/ai-operations-dispatcher/index.ts", "utf8");
    for (const flag of [
      "client_journey_monitoring_enabled",
      "staff_workflow_monitoring_enabled",
      "appointment_integrity_monitoring_enabled",
      "billing_claims_monitoring_enabled",
      "data_quality_monitoring_enabled",
      "relationship_followup_monitoring_enabled",
      "sop_compliance_monitoring_enabled",
    ]) expect(dispatcher).toContain(`flag("${flag}")`);
    expect(dispatcher).not.toContain('flag("staff_quality_ai_enabled")');
    expect(dispatcher).not.toContain('flag("billing_claims_ai_enabled")');
  });

  it("keeps scheduled qualitative modules out of the automatic dispatcher", () => {
    const dispatcher = readFileSync("supabase/functions/ai-operations-dispatcher/index.ts", "utf8");
    for (const automaticModelBuilder of [
      "ai_ops_build_communications_batches",
      "ai_ops_build_donor_intelligence_batches",
      "ai_ops_build_social_lead_batches",
      "ai_ops_build_bty_intelligence_batches",
      "ai_ops_build_weekly_pattern_input",
      "ai_ops_build_youtube_batches",
      "ai_ops_build_content_performance_batches",
      "ai_ops_build_executive_brief_input",
    ]) {
      expect(dispatcher).not.toContain(automaticModelBuilder);
    }
    expect(dispatcher).toContain('skipped: "manual_analysis_bucket"');
    expect(dispatcher).toContain("ai_ops_publish_deterministic_daily_summary");
  });

  it("assigns a thinking level to every retained work type", () => {
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
