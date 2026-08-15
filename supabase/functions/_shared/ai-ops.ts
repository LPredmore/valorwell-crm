// Shared runtime for the ValorWell AI Operations platform.
// Pure helpers here are unit-tested from src/test/ai-operations-*.test.ts.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";

export const AI_OPS_TENANT_ID = "00000000-0000-0000-0000-000000000001";
export const AI_OPS_TIMEZONE = "America/Chicago";
/**
 * Single approved model for AI Operations reasoning work.
 * `gemini-2.5-flash` is the current standard on the Gemini Developer API.
 */
export const AI_OPS_MODEL = "gemini-2.5-flash";

export const AI_OPS_PROMPT_VERSION = "1";
export const AI_OPS_SCHEMA_VERSION = "1";

export type AiOpsModule =
  | "system_integrity"
  | "client_journey"
  | "communications"
  | "youtube"
  | "executive_brief";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("Supabase service runtime is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Internal AI Operations endpoints accept a service-role bearer or the cron secret. */
export function authorizeWorker(request: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (serviceKey && authorization === `Bearer ${serviceKey}`) return true;
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  return Boolean(cronSecret) && request.headers.get("x-cron-secret") === cronSecret;
}


/** Structured log line. Never contains PHI — identifiers, counts, and status only. */
export function logEvent(component: string, event: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ component, event, ...detail }));
}

export function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ------------------------------------------------------------
// Business-date helpers (Central time, DST aware)
// ------------------------------------------------------------

export function centralBusinessDate(at: Date = new Date(), timeZone = AI_OPS_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function centralLocalTime(at: Date = new Date(), timeZone = AI_OPS_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

export function isWeekend(businessDate: string): boolean {
  const day = new Date(`${businessDate}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

// ------------------------------------------------------------
// Retry classification
// ------------------------------------------------------------

export type ModelFailureKind = "rate_limited" | "server_error" | "timeout" | "invalid_output" | "auth" | "unknown";

export function classifyModelFailure(status: number | null, message: string): {
  kind: ModelFailureKind;
  retryable: boolean;
} {
  const text = (message ?? "").toLowerCase();
  if (status === 429) return { kind: "rate_limited", retryable: true };
  if (status !== null && status >= 500) return { kind: "server_error", retryable: true };
  if (status === 401 || status === 403) return { kind: "auth", retryable: false };
  if (text.includes("timeout") || text.includes("timed out") || text.includes("aborted")) {
    return { kind: "timeout", retryable: true };
  }
  if (text.includes("schema") || text.includes("json")) return { kind: "invalid_output", retryable: false };
  return { kind: "unknown", retryable: status === null };
}

export function backoffSeconds(attempt: number): number {
  return Math.min(Math.pow(2, Math.max(attempt, 1)) * 30, 1800);
}

// ------------------------------------------------------------
// Dispatcher plan (America/Chicago local time, weekdays only)
// ------------------------------------------------------------

export type DispatcherAction =
  | "initialize"
  | "collect"
  | "youtube"
  | "reconcile"
  | "brief"
  | "retry"
  | "finalize";

/** The dispatcher runs every five minutes and derives the due action from local time. */
export function dispatcherActionFor(localTime: string): DispatcherAction | null {
  switch (localTime) {
    case "03:15": return "initialize";
    case "03:20": return "collect";
    case "04:10": return "youtube";
    case "04:30": return "reconcile";
    case "04:35": return "brief";
    case "04:45": return "retry";
    case "04:50": return "finalize";
    default: return null;
  }
}

// ------------------------------------------------------------
// Gemini Developer API (server-side only)
// ------------------------------------------------------------

export const AI_OPS_PROVIDER = "gemini_developer_api";

/** Reads the single required model secret. Never logged, never returned to a client. */
export function geminiApiKey(): string {
  const key = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!key) throw new Error("GEMINI_API_KEY is not configured for AI Operations.");
  return key;
}

export type ModelCallResult = {
  text: string;
  tokenUsage: Record<string, unknown>;
  status: number;
};

export async function callGeminiModel(options: {
  apiKey: string;
  model?: string;
  systemInstruction: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
  temperature?: number;
  timeoutMs?: number;
}): Promise<ModelCallResult> {
  const model = options.model ?? AI_OPS_MODEL;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-goog-api-key": options.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: options.systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: options.userPrompt }] }],
        generationConfig: {
          temperature: options.temperature ?? 0.2,
          responseMimeType: "application/json",
          responseSchema: options.responseSchema,
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message ?? `Gemini request failed (${response.status}).`;
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    const text = (payload?.candidates?.[0]?.content?.parts ?? [])
      .map((part: { text?: string }) => part.text ?? "")
      .join("");
    return { text, tokenUsage: payload?.usageMetadata ?? {}, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}


// ------------------------------------------------------------
// Strict structured-output handling
// ------------------------------------------------------------

export function parseModelJson(text: string): unknown {
  const trimmed = (text ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  if (!trimmed) throw new Error("The model returned an empty JSON payload.");
  return JSON.parse(trimmed);
}

/** Every result set must cover exactly the requested opaque entity keys, once each. */
export function validateEntityCoverage(
  requestedKeys: string[],
  results: Array<{ entityKey?: string }>,
): { ok: true } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (const result of results) {
    const key = result?.entityKey;
    if (!key) return { ok: false, error: "A result is missing its entityKey." };
    if (!requestedKeys.includes(key)) return { ok: false, error: `Unexpected entityKey: ${key}` };
    if (seen.has(key)) return { ok: false, error: `Duplicate entityKey: ${key}` };
    seen.add(key);
  }
  if (seen.size !== requestedKeys.length) {
    return { ok: false, error: `Expected ${requestedKeys.length} results, received ${seen.size}.` };
  }
  return { ok: true };
}
