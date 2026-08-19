// AI Operations model worker. Claims queued work, applies the configured Gemini model,
// validates strict structured output, and records provenance. Never remediates source data.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  AI_OPS_MODEL, AI_OPS_PROVIDER, AI_OPS_TENANT_ID, adminClient, authorizeWorker,
  backoffSeconds, callGeminiModel, classifyModelFailure,
  geminiApiKey, json, logEvent, parseModelJson, resolveAiOpsModel, safeError, validateEntityCoverage,
} from "../_shared/ai-ops.ts";
import { specFor } from "../_shared/ai-ops-prompts.ts";
import { awaitGeminiSlot, GeminiRateSlotUnavailable } from "../_shared/gemini-rate-limit.ts";

type ClaimedItem = {
  id: string; tenantId: string; runId: string | null; module: string; workKey: string;
  workType: string; inputPayload: Record<string, unknown> | null; requestedModel: string;
  promptVersion: string; schemaVersion: string; attemptCount: number;
};
type ClientJourneyInputEntity = {
  entityKey?: string;
  activeExceptions?: Array<{ exceptionKey?: string }>;
};
type ClientJourneyResult = {
  entityKey?: string;
  noConcern?: boolean;
  concernDisposition?: string;
  relatedExceptionKeys?: string[];
  exceptionAssessments?: Array<{ exceptionKey?: string; assessment?: string }>;
};
const COMPONENT = "ai-operations-model-worker";
const requestedEntityKeys = (item: ClaimedItem): string[] => {
  const p = (item.inputPayload ?? {}) as { entities?: Array<{ entityKey?: string }> };
  return (p.entities ?? []).map((e) => e.entityKey ?? "").filter(Boolean);
};

function validateClientJourneyExceptionReferences(
  item: ClaimedItem,
  results: ClientJourneyResult[],
): { ok: true } | { ok: false; error: string } {
  const payload = (item.inputPayload ?? {}) as { entities?: ClientJourneyInputEntity[] };
  const entities = new Map<string, ClientJourneyInputEntity>();
  for (const entity of payload.entities ?? []) {
    if (entity.entityKey) entities.set(entity.entityKey, entity);
  }

  for (const result of results) {
    const entityKey = result.entityKey ?? "";
    const entity = entities.get(entityKey);
    if (!entity) return { ok: false, error: `No input entity exists for entityKey ${entityKey}.` };

    const suppliedKeys = (entity.activeExceptions ?? []).map((x) => x.exceptionKey ?? "").filter(Boolean);
    const supplied = new Set(suppliedKeys);
    if (supplied.size !== suppliedKeys.length) return { ok: false, error: `Input entity ${entityKey} contains duplicate exception keys.` };

    const related = Array.isArray(result.relatedExceptionKeys) ? result.relatedExceptionKeys : [];
    if (new Set(related).size !== related.length) return { ok: false, error: `Result ${entityKey} contains duplicate relatedExceptionKeys.` };
    for (const key of related) {
      if (!supplied.has(key)) return { ok: false, error: `Result ${entityKey} referenced an exception key that was not supplied: ${key}` };
    }

    const assessments = Array.isArray(result.exceptionAssessments) ? result.exceptionAssessments : [];
    const assessmentKeys = assessments.map((x) => x.exceptionKey ?? "").filter(Boolean);
    if (assessmentKeys.length !== assessments.length) return { ok: false, error: `Result ${entityKey} has an exception assessment without an exceptionKey.` };
    if (new Set(assessmentKeys).size !== assessmentKeys.length) return { ok: false, error: `Result ${entityKey} contains duplicate exception assessments.` };
    if (assessmentKeys.length !== suppliedKeys.length) return { ok: false, error: `Result ${entityKey} did not assess every supplied active exception.` };
    for (const key of assessmentKeys) {
      if (!supplied.has(key)) return { ok: false, error: `Result ${entityKey} assessed an exception key that was not supplied: ${key}` };
    }
    for (const key of suppliedKeys) {
      if (!assessmentKeys.includes(key)) return { ok: false, error: `Result ${entityKey} omitted supplied exception key ${key} from exceptionAssessments.` };
    }

    const disposition = result.concernDisposition ?? "none";
    if (["stable_existing", "escalating_existing", "appears_resolved_existing"].includes(disposition) && related.length === 0) {
      return { ok: false, error: `Result ${entityKey} marked an existing concern without relatedExceptionKeys.` };
    }
    if (["none", "new_concern"].includes(disposition) && related.length > 0) {
      return { ok: false, error: `Result ${entityKey} returned relatedExceptionKeys for ${disposition}.` };
    }
    if (result.noConcern === true && disposition !== "none") {
      return { ok: false, error: `Result ${entityKey} set noConcern=true with concernDisposition=${disposition}.` };
    }

    const relatedAssessments = assessments.filter((assessment) => related.includes(assessment.exceptionKey ?? ""));
    if (disposition === "stable_existing" && !relatedAssessments.some((x) => x.assessment === "stable")) {
      return { ok: false, error: `Result ${entityKey} marked a stable existing concern without a stable related exception assessment.` };
    }
    if (disposition === "escalating_existing" && !relatedAssessments.some((x) => x.assessment === "escalating")) {
      return { ok: false, error: `Result ${entityKey} marked an escalating existing concern without an escalating related exception assessment.` };
    }
    if (disposition === "appears_resolved_existing" && !relatedAssessments.some((x) => x.assessment === "appears_resolved")) {
      return { ok: false, error: `Result ${entityKey} marked an appears-resolved concern without an appears_resolved related exception assessment.` };
    }
  }

  return { ok: true };
}

async function processItem(admin: ReturnType<typeof adminClient>, apiKey: string, settings: { model: string }, item: ClaimedItem): Promise<"completed" | "failed" | "retry" | "deferred"> {
  const spec = specFor(item.workType);
  const model = resolveAiOpsModel(item.requestedModel, settings.model);

  const attempt = async (repair: boolean) => {
    const suffix = repair ? "\nThe previous response failed schema validation. Return valid JSON matching the schema exactly." : "";
    await awaitGeminiSlot(admin, { label: `${COMPONENT}:${item.workType}`, maxWaitMs: 60_000 });
    const result = await callGeminiModel({
      apiKey, model, systemInstruction: spec.systemInstruction + suffix,
      userPrompt: JSON.stringify(item.inputPayload ?? {}), responseSchema: spec.responseSchema, thinkingLevel: spec.thinkingLevel,
    });
    const parsed = parseModelJson(result.text) as Record<string, unknown>;
    const parsedResults = (parsed.results ?? []) as Array<{ entityKey?: string }>;
    if (spec.requiresEntityCoverage) {
      const coverage = validateEntityCoverage(requestedEntityKeys(item), parsedResults);
      if (!coverage.ok) throw new Error(`schema: ${coverage.error}`);
    }
    if (item.workType === "client_journey_review") {
      const exceptionCoverage = validateClientJourneyExceptionReferences(item, parsedResults as ClientJourneyResult[]);
      if (!exceptionCoverage.ok) throw new Error(`schema: ${exceptionCoverage.error}`);
    }
    return { parsed, tokenUsage: result.tokenUsage, modelVersion: result.modelVersion };
  };

  try {
    let outcome;
    try { outcome = await attempt(false); }
    catch (firstError) {
      const classified = classifyModelFailure((firstError as { status?: number }).status ?? null, safeError(firstError));
      if (classified.kind !== "invalid_output") throw firstError;
      logEvent(COMPONENT, "schema_repair_retry", { workItemId: item.id, workType: item.workType });
      outcome = await attempt(true);
    }
    await admin.rpc("ai_ops_complete_work_item", {
      p_work_item_id: item.id,
      p_structured_result: outcome.parsed,
      p_token_usage: {
        ...outcome.tokenUsage,
        provider: AI_OPS_PROVIDER,
        model,
        configuredModel: settings.model || AI_OPS_MODEL,
        requestedModel: item.requestedModel || null,
        modelVersion: outcome.modelVersion,
        promptVersion: spec.promptVersion,
        schemaVersion: spec.schemaVersion,
      },
    });
    logEvent(COMPONENT, "work_item_completed", {
      workItemId: item.id,
      module: item.module,
      workType: item.workType,
      model,
      attempt: item.attemptCount,
    });
    return "completed";
  } catch (error) {
    // Waiting for a shared Gemini rate slot is not a work failure: requeue without consuming an attempt.
    if (error instanceof GeminiRateSlotUnavailable) {
      await admin.rpc("ai_ops_release_work_item", { p_work_item_id: item.id, p_delay_seconds: 60, p_reason: "gemini_rate_slot_wait" });
      logEvent(COMPONENT, "work_item_deferred", { workItemId: item.id, module: item.module, workType: item.workType, retryAfterMs: error.retryAfterMs });
      return "deferred";
    }
    const classified = classifyModelFailure((error as { status?: number }).status ?? null, safeError(error));
    const { data } = await admin.rpc("ai_ops_fail_work_item", {
      p_work_item_id: item.id, p_error_code: classified.kind, p_error_summary: safeError(error), p_retryable: classified.retryable, p_max_attempts: 4,
    });
    logEvent(COMPONENT, "work_item_failed", { workItemId: item.id, module: item.module, workType: item.workType, model, errorCode: classified.kind, retryable: classified.retryable, attempt: item.attemptCount, backoffSeconds: classified.retryable ? backoffSeconds(item.attemptCount) : 0, status: (data as { status?: string } | null)?.status ?? null });
    return classified.retryable ? "retry" : "failed";
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!authorizeWorker(request)) return json({ error: "Unauthorized." }, 401);
  const started = Date.now();
  const admin = adminClient();
  try {
    const body = await request.json().catch(() => ({}));
    const tenantId = typeof body?.tenantId === "string" ? body.tenantId : AI_OPS_TENANT_ID;
    const { data: flagsEnabled, error: flagError } = await admin.rpc("ai_ops_worker_flag", { p_tenant_id: tenantId, p_flag_name: "ai_operations_enabled" });
    if (flagError) throw new Error(flagError.message);
    if (flagsEnabled !== true) return json({ ok: true, skipped: "ai_operations_disabled" });

    let apiKey: string;
    try { apiKey = geminiApiKey(); }
    catch (configError) { return json({ error: safeError(configError), code: "gemini_api_key_missing" }, 500); }

    if (body?.action === "list_models") {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", { headers: { "x-goog-api-key": apiKey } });
      const payload = await response.json().catch(() => ({}));
      const models = (payload?.models ?? []).map((m: { name?: string; supportedGenerationMethods?: string[] }) => ({ name: m.name, methods: m.supportedGenerationMethods }));
      return json({ ok: response.ok, status: response.status, models });
    }

    const { data: settings, error: settingsError } = await admin.from("ai_operations_settings").select("model, max_model_concurrency").eq("tenant_id", tenantId).maybeSingle();
    if (settingsError) throw new Error(settingsError.message);
    const batchSize = Math.min(Math.max(Number(body?.limit ?? settings?.max_model_concurrency ?? 4), 1), 20);
    const { data: claimed, error: claimError } = await admin.rpc("ai_ops_claim_work_items", { p_limit: batchSize });
    if (claimError) throw new Error(claimError.message);
    const items = (claimed ?? []) as ClaimedItem[];
    if (!items.length) return json({ ok: true, claimed: 0, durationMs: Date.now() - started });
    const results = await Promise.all(items.map((item) => processItem(admin, apiKey, { model: settings?.model ?? AI_OPS_MODEL }, item)));

    const summary = { claimed: items.length, completed: results.filter((r) => r === "completed").length, retry: results.filter((r) => r === "retry").length, failed: results.filter((r) => r === "failed").length, deferred: results.filter((r) => r === "deferred").length, durationMs: Date.now() - started };
    logEvent(COMPONENT, "batch_complete", summary);
    return json({ ok: true, ...summary });
  } catch (error) {
    logEvent(COMPONENT, "batch_failed", { message: safeError(error) });
    return json({ error: safeError(error) }, 500);
  }
});
