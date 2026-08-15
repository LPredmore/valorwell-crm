// Shared runtime for the ValorWell AI Operations platform.
// Pure helpers here are unit-tested from src/test/ai-operations-*.test.ts.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";

export const AI_OPS_TENANT_ID = "00000000-0000-0000-0000-000000000001";
export const AI_OPS_TIMEZONE = "America/Chicago";
/** Single approved reasoning model. Never a Flash or preview variant. */
export const AI_OPS_MODEL = "gemini-2.5-pro";
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

/** Internal AI Operations endpoints accept only a service-role bearer. */
export function authorizeWorker(request: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  return Boolean(serviceKey) && authorization === `Bearer ${serviceKey}`;
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
// Vertex AI service-account authentication
// ------------------------------------------------------------

type ServiceAccount = { client_email: string; private_key: string; project_id?: string };

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function readServiceAccount(): ServiceAccount {
  const raw = Deno.env.get("VERTEX_SERVICE_ACCOUNT_JSON") ?? "";
  if (!raw) throw new Error("VERTEX_SERVICE_ACCOUNT_JSON is not configured.");
  const parsed = JSON.parse(raw) as ServiceAccount;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("VERTEX_SERVICE_ACCOUNT_JSON is missing client_email or private_key.");
  }
  return { ...parsed, private_key: parsed.private_key.replace(/\\n/g, "\n") };
}

export async function vertexAccessToken(): Promise<string> {
  const account = readServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  const assertion = `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Vertex token exchange failed (${response.status}).`);
  }
  return payload.access_token as string;
}

export type VertexCallResult = {
  text: string;
  tokenUsage: Record<string, unknown>;
  status: number;
};

export async function callVertexModel(options: {
  accessToken: string;
  projectId: string;
  location: string;
  model?: string;
  systemInstruction: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
  temperature?: number;
  timeoutMs?: number;
}): Promise<VertexCallResult> {
  const model = options.model ?? AI_OPS_MODEL;
  const url = `https://${options.location}-aiplatform.googleapis.com/v1/projects/${options.projectId}/locations/${options.location}/publishers/google/models/${model}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${options.accessToken}`,
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
      const message = payload?.error?.message ?? `Vertex request failed (${response.status}).`;
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
