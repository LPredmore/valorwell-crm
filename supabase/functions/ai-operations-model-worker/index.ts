// AI Operations model worker: claims queued work items, calls Gemini 2.5 Pro on
// the Gemini Developer API with a strict response schema, and records validated
// structured results. Never remediates production data.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  AI_OPS_MODEL,
  AI_OPS_PROVIDER,
  AI_OPS_TENANT_ID,
  adminClient,
  authorizeWorker,
  backoffSeconds,
  callGeminiModel,
  classifyModelFailure,
  geminiApiKey,
  json,
  logEvent,
  parseModelJson,
  safeError,
  validateEntityCoverage,
} from "../_shared/ai-ops.ts";

import { specFor } from "../_shared/ai-ops-prompts.ts";

type ClaimedItem = {
  id: string;
  tenantId: string;
  runId: string | null;
  module: string;
  workKey: string;
  workType: string;
  inputPayload: Record<string, unknown> | null;
  requestedModel: string;
  promptVersion: string;
  schemaVersion: string;
  attemptCount: number;
};

const COMPONENT = "ai-operations-model-worker";

function buildUserPrompt(item: ClaimedItem): string {
  const payload = item.inputPayload ?? {};
  return JSON.stringify(payload);
}

function requestedEntityKeys(item: ClaimedItem): string[] {
  const payload = (item.inputPayload ?? {}) as { entities?: Array<{ entityKey?: string }> };
  return (payload.entities ?? []).map((entity) => entity.entityKey ?? "").filter(Boolean);
}

async function processItem(
  admin: ReturnType<typeof adminClient>,
  apiKey: string,
  settings: { model: string },
  item: ClaimedItem,
): Promise<"completed" | "failed" | "retry"> {
  const spec = specFor(item.workType);
  // The active AI Operations setting is authoritative. A model recorded on the work item when it was
  // queued is historical metadata only and must never route execution to a retired model.
  const model = settings.model || AI_OPS_MODEL;

  const attempt = async (repair: boolean) => {
    const suffix = repair
      ? "\n\nThe previous response did not satisfy the schema. Return only valid JSON matching the schema exactly."
      : "";
    const result = await callGeminiModel({
      apiKey,
      model,
      systemInstruction: spec.systemInstruction + suffix,
      userPrompt: buildUserPrompt(item),
      responseSchema: spec.responseSchema,
      thinkingLevel: spec.thinkingLevel,
    });


    const parsed = parseModelJson(result.text) as Record<string, unknown>;
    if (spec.requiresEntityCoverage) {
      const keys = requestedEntityKeys(item);
      const coverage = validateEntityCoverage(keys, (parsed.results ?? []) as Array<{ entityKey?: string }>);
      if (!coverage.ok) throw new Error(`schema: ${coverage.error}`);
    }
    return { parsed, tokenUsage: result.tokenUsage };
  };

  try {
    let outcome: { parsed: Record<string, unknown>; tokenUsage: Record<string, unknown> };
    try {
      outcome = await attempt(false);
    } catch (firstError) {
      const status = (firstError as { status?: number }).status ?? null;
      const classified = classifyModelFailure(status, safeError(firstError));
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
        promptVersion: spec.promptVersion,
        schemaVersion: spec.schemaVersion,
      },
    });

    logEvent(COMPONENT, "work_item_completed", {
      workItemId: item.id,
      module: item.module,
      workType: item.workType,
      attempt: item.attemptCount,
    });
    return "completed";
  } catch (error) {
    const status = (error as { status?: number }).status ?? null;
    const classified = classifyModelFailure(status, safeError(error));
    const { data } = await admin.rpc("ai_ops_fail_work_item", {
      p_work_item_id: item.id,
      p_error_code: classified.kind,
      p_error_summary: safeError(error),
      p_retryable: classified.retryable,
      p_max_attempts: 4,
    });
    logEvent(COMPONENT, "work_item_failed", {
      workItemId: item.id,
      module: item.module,
      workType: item.workType,
      errorCode: classified.kind,
      retryable: classified.retryable,
      attempt: item.attemptCount,
      backoffSeconds: classified.retryable ? backoffSeconds(item.attemptCount) : 0,
      status: (data as { status?: string } | null)?.status ?? null,
    });
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

    const { data: flagsEnabled, error: flagError } = await admin.rpc("ai_ops_worker_flag", {
      p_tenant_id: tenantId,
      p_flag_name: "ai_operations_enabled",
    });
    if (flagError) throw new Error(flagError.message);
    if (flagsEnabled !== true) {
      logEvent(COMPONENT, "disabled", { tenantId });
      return json({ ok: true, skipped: "ai_operations_disabled" });
    }

    let apiKey: string;
    try {
      apiKey = geminiApiKey();
    } catch (configError) {
      logEvent(COMPONENT, "configuration_error", { reason: "gemini_api_key_missing" });
      return json({ error: safeError(configError), code: "gemini_api_key_missing" }, 500);
    }

    // Diagnostic: report the model names this API key may actually call. Never returns the key.
    if (body?.action === "list_models") {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": apiKey },
      });
      const payload = await response.json().catch(() => ({}));
      const models = (payload?.models ?? [])
        .map((m: { name?: string; supportedGenerationMethods?: string[] }) => ({
          name: m.name,
          methods: m.supportedGenerationMethods,
        }));
      return json({ ok: response.ok, status: response.status, models });
    }


    const { data: settings, error: settingsError } = await admin
      .from("ai_operations_settings")
      .select("model, max_model_concurrency")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (settingsError) throw new Error(settingsError.message);

    const batchSize = Math.min(
      Math.max(Number(body?.limit ?? settings?.max_model_concurrency ?? 4), 1),
      20,
    );

    const { data: claimed, error: claimError } = await admin.rpc("ai_ops_claim_work_items", {
      p_limit: batchSize,
    });
    if (claimError) throw new Error(claimError.message);

    const items = (claimed ?? []) as ClaimedItem[];
    if (items.length === 0) {
      return json({ ok: true, claimed: 0, durationMs: Date.now() - started });
    }

    const results = await Promise.all(items.map((item) =>
      processItem(admin, apiKey, { model: settings?.model ?? AI_OPS_MODEL }, item)
    ));


    const summary = {
      claimed: items.length,
      completed: results.filter((r) => r === "completed").length,
      retry: results.filter((r) => r === "retry").length,
      failed: results.filter((r) => r === "failed").length,
      durationMs: Date.now() - started,
    };
    logEvent(COMPONENT, "batch_complete", summary);
    return json({ ok: true, ...summary });
  } catch (error) {
    logEvent(COMPONENT, "batch_failed", { message: safeError(error) });
    return json({ error: safeError(error) }, 500);
  }
});
