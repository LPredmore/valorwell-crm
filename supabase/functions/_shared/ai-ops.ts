// Shared runtime for the ValorWell AI Operations platform.
// Pure helpers here are unit-tested from src/test/ai-operations-*.test.ts.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";

export const AI_OPS_TENANT_ID = "00000000-0000-0000-0000-000000000001";
export const AI_OPS_TIMEZONE = "America/Chicago";
export { AI_OPS_MODEL, resolveAiOpsModel } from "./ai-ops-model.ts";
import { AI_OPS_MODEL } from "./ai-ops-model.ts";
export const AI_OPS_PROMPT_VERSION = "1";
export const AI_OPS_SCHEMA_VERSION = "1";

export type AiOpsModule =
  | "system_integrity" | "user_flow_smoke" | "client_journey" | "communications" | "staff_quality"
  | "appointment_integrity" | "billing_claims" | "data_quality" | "relationship_followup"
  | "donor_intelligence" | "social_leads" | "content_performance"
  | "bty_intelligence" | "sop_compliance" | "weekly_patterns" | "youtube" | "executive_brief";

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("Supabase service runtime is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function authorizeWorker(request: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (serviceKey && authorization === `Bearer ${serviceKey}`) return true;
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  return Boolean(cronSecret) && request.headers.get("x-cron-secret") === cronSecret;
}

export function logEvent(component: string, event: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ component, event, ...detail }));
}
export function safeError(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function centralBusinessDate(at: Date = new Date(), timeZone = AI_OPS_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
export function centralLocalTime(at: Date = new Date(), timeZone = AI_OPS_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
}
export function isWeekend(businessDate: string): boolean {
  const day = new Date(`${businessDate}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export type ModelFailureKind = "rate_limited" | "server_error" | "timeout" | "invalid_output" | "auth" | "unknown";
export function classifyModelFailure(status: number | null, message: string): { kind: ModelFailureKind; retryable: boolean } {
  const text = (message ?? "").toLowerCase();
  if (status === 429) return { kind: "rate_limited", retryable: true };
  if (status !== null && status >= 500) return { kind: "server_error", retryable: true };
  if (status === 401 || status === 403) return { kind: "auth", retryable: false };
  if (text.includes("timeout") || text.includes("timed out") || text.includes("aborted")) return { kind: "timeout", retryable: true };
  if (text.includes("schema") || text.includes("json")) return { kind: "invalid_output", retryable: false };
  return { kind: "unknown", retryable: status === null };
}
export function backoffSeconds(attempt: number): number { return Math.min(Math.pow(2, Math.max(attempt, 1)) * 30, 1800); }

export type DispatcherAction = "initialize" | "rebuild" | "collect" | "integrity" | "youtube" | "reconcile" | "brief" | "retry" | "finalize";
export function dispatcherActionFor(localTime: string): DispatcherAction | null {
  switch (localTime) {
    case "03:15": return "initialize";
    case "03:20": return "collect";
    case "04:10": return "youtube";
    case "04:30": return "reconcile";
    case "04:35": return "brief";
    case "04:45": return "retry";
    case "04:50": return "finalize";
  }

  // After the daily run has been initialized, refresh System Integrity every
  // 15 minutes for the rest of the business day. This reuses the existing
  // five-minute dispatcher cron and does not create model work or extra crons.
  const match = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 3 || (hour === 3 && minute < 30)) return null;
  return minute % 15 === 0 ? "integrity" : null;
}

export const AI_OPS_PROVIDER = "gemini_developer_api";
export function geminiApiKey(): string {
  const key = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!key) throw new Error("GEMINI_API_KEY is not configured for AI Operations.");
  return key;
}

export type ModelCallResult = { text: string; tokenUsage: Record<string, unknown>; status: number; modelVersion: string | null };
export type GroundedSearchSource = { title: string | null; uri: string | null };
export type GroundedSearchResult = ModelCallResult & { sources: GroundedSearchSource[]; searchQueries: string[] };
export type { ThinkingLevel } from "./ai-ops-types.ts";
import type { ThinkingLevel } from "./ai-ops-types.ts";

export async function callGeminiModel(options: {
  apiKey: string; model?: string; systemInstruction: string; userPrompt: string;
  responseSchema: Record<string, unknown>; thinkingLevel?: ThinkingLevel; timeoutMs?: number;
}): Promise<ModelCallResult> {
  const model = options.model ?? AI_OPS_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  const supportsThinkingLevel = !model.toLowerCase().startsWith("gemini-2.5-");
  const send = async (includeThinking: boolean) => {
    const generationConfig: Record<string, unknown> = { responseMimeType: "application/json", responseSchema: options.responseSchema };
    if (includeThinking && supportsThinkingLevel && options.thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: options.thinkingLevel };
    return await fetch(url, {
      method: "POST", signal: controller.signal,
      headers: { "x-goog-api-key": options.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: options.systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: options.userPrompt }] }], generationConfig,
      }),
    });
  };
  try {
    let response = await send(true);
    if (response.status === 400 && supportsThinkingLevel && options.thinkingLevel) {
      const detail = await response.clone().json().catch(() => ({}));
      if (String(detail?.error?.message ?? "").toLowerCase().includes("thinking")) {
        logEvent("ai-ops", "thinking_config_unsupported", { model });
        response = await send(false);
      }
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message ?? `Gemini request failed (${response.status}).`) as Error & { status?: number };
      error.status = response.status; throw error;
    }
    const text = (payload?.candidates?.[0]?.content?.parts ?? []).map((part: { text?: string }) => part.text ?? "").join("");
    return { text, tokenUsage: payload?.usageMetadata ?? {}, status: response.status, modelVersion: typeof payload?.modelVersion === "string" ? payload.modelVersion : null };
  } finally { clearTimeout(timer); }
}

/** First pass for current-event research. Search results are evidence only and are never executed as instructions. */
export async function callGeminiGroundedSearch(options: {
  apiKey: string; model?: string; prompt: string; timeoutMs?: number;
}): Promise<GroundedSearchResult> {
  const model = options.model ?? AI_OPS_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  try {
    const response = await fetch(url, {
      method: "POST", signal: controller.signal,
      headers: { "x-goog-api-key": options.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: options.prompt }] }],
        tools: [{ google_search: {} }],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message ?? `Gemini grounded search failed (${response.status}).`) as Error & { status?: number };
      error.status = response.status; throw error;
    }
    const candidate = payload?.candidates?.[0] ?? {};
    const text = (candidate?.content?.parts ?? []).map((part: { text?: string }) => part.text ?? "").join("");
    const metadata = candidate?.groundingMetadata ?? {};
    const sources: GroundedSearchSource[] = (metadata?.groundingChunks ?? [])
      .map((chunk: { web?: { title?: string; uri?: string } }) => ({ title: chunk?.web?.title ?? null, uri: chunk?.web?.uri ?? null }))
      .filter((source: GroundedSearchSource) => source.title || source.uri);
    const searchQueries = Array.isArray(metadata?.webSearchQueries) ? metadata.webSearchQueries.filter((q: unknown) => typeof q === "string") : [];
    return { text, sources, searchQueries, tokenUsage: payload?.usageMetadata ?? {}, status: response.status, modelVersion: typeof payload?.modelVersion === "string" ? payload.modelVersion : null };
  } finally { clearTimeout(timer); }
}

export function parseModelJson(text: string): unknown {
  const trimmed = (text ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  if (!trimmed) throw new Error("The model returned an empty JSON payload.");
  return JSON.parse(trimmed);
}
export function validateEntityCoverage(requestedKeys: string[], results: Array<{ entityKey?: string }>): { ok: true } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (const result of results) {
    const key = result?.entityKey;
    if (!key) return { ok: false, error: "A result is missing its entityKey." };
    if (!requestedKeys.includes(key)) return { ok: false, error: `Unexpected entityKey: ${key}` };
    if (seen.has(key)) return { ok: false, error: `Duplicate entityKey: ${key}` };
    seen.add(key);
  }
  if (seen.size !== requestedKeys.length) return { ok: false, error: `Expected ${requestedKeys.length} results, received ${seen.size}.` };
  return { ok: true };
}
