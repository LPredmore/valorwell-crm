import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";

export const TENANT_ID = "00000000-0000-0000-0000-000000000001";
export const GMAIL_MAILBOX = "info@valorwell.org";
export const STREAMYARD_URL = "https://streamyard.com/frr4zf8e3s";
export const GOOGLE_OAUTH_CALLBACK =
  "https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/relationship-google-oauth-callback";
export const GMAIL_PUSH_AUDIENCE =
  "https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/relationship-gmail-push";
export const CALENDAR_WEBHOOK_URL =
  "https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/relationship-calendar-webhook";
export const PUBSUB_PUSH_IDENTITY =
  "relationship-pubsub-push@valorwell-relationships.iam.gserviceaccount.com";

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store",
  },
});

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("Supabase service runtime is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function requireCrmOperator(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new Error("CRM authentication is required.");
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anon) throw new Error("Supabase user runtime is not configured.");
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await client.auth.getUser(authorization.slice(7));
  if (userError || !userData.user) throw new Error("CRM authentication is invalid.");
  const { data: context, error: contextError } = await client.rpc("get_crm_operating_context");
  if (contextError || !context || typeof context !== "object") throw new Error("CRM operating context is unavailable.");
  const row = context as Record<string, unknown>;
  const capabilities = row.capabilities as Record<string, unknown> | undefined;
  if (row.authenticated !== true || row.current_tenant_id !== TENANT_ID || capabilities?.mutate !== true) {
    throw new Error("CRM operator access is required.");
  }
  return { actorId: userData.user.id, tenantId: TENANT_ID };
}

export function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomToken(byteLength = 32) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type GoogleRuntime = {
  id: string;
  tenantId: string;
  connectionType: "gmail" | "calendar";
  googleAccountEmail: string;
  googleAccountId?: string;
  calendarId?: string;
  scopes: string[];
  refreshToken: string;
};

export async function connectionRuntime(
  admin: SupabaseClient,
  connectionType: "gmail" | "calendar",
  connectionId?: string,
): Promise<GoogleRuntime | null> {
  const { data, error } = await admin.rpc("get_relationship_google_connection_runtime", {
    p_tenant_id: TENANT_ID,
    p_connection_type: connectionType,
    p_connection_id: connectionId ?? null,
  });
  if (error) throw new Error(error.message);
  return data ? data as GoogleRuntime : null;
}

export async function refreshGoogleAccessToken(runtime: GoogleRuntime) {
  const clientId = Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret || !runtime.refreshToken) throw new Error("Google OAuth runtime is incomplete.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: runtime.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof body.access_token !== "string") {
    throw new Error(`Google token refresh failed (${response.status}).`);
  }
  return body.access_token;
}

export async function googleJson(
  url: string,
  accessToken: string,
  init: RequestInit = {},
) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = new Error(`Google API request failed (${response.status}).`) as Error & { status?: number; body?: unknown };
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

type GoogleClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  email?: string;
  email_verified?: boolean;
  sub?: string;
};

let googleJwks: { expiresAt: number; keys: JsonWebKey[] } | undefined;

async function getGoogleJwks() {
  if (googleJwks && googleJwks.expiresAt > Date.now()) return googleJwks.keys;
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!response.ok) throw new Error("Google signing keys are unavailable.");
  const body = await response.json() as { keys?: JsonWebKey[] };
  if (!Array.isArray(body.keys)) throw new Error("Google signing key response is invalid.");
  const cacheControl = response.headers.get("cache-control") ?? "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] ?? 300);
  googleJwks = { keys: body.keys, expiresAt: Date.now() + Math.min(maxAge, 3600) * 1000 };
  return body.keys;
}

export async function verifyGoogleOidc(
  authorization: string,
  expectedAudience: string,
  expectedEmail: string,
) {
  if (!authorization.startsWith("Bearer ")) throw new Error("Google OIDC token is required.");
  const token = authorization.slice(7);
  const segments = token.split(".");
  if (segments.length !== 3) throw new Error("Google OIDC token is malformed.");
  const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(segments[0]))) as { alg?: string; kid?: string };
  const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(segments[1]))) as GoogleClaims;
  if (header.alg !== "RS256" || !header.kid) throw new Error("Google OIDC signing algorithm is invalid.");
  const key = (await getGoogleJwks()).find((item) => item.kid === header.kid);
  if (!key) throw new Error("Google OIDC signing key is unknown.");
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    base64UrlToBytes(segments[2]),
    new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
  );
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!valid || !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss ?? "") ||
      !audiences.includes(expectedAudience) || !claims.exp || claims.exp <= now ||
      (claims.nbf ?? 0) > now + 30 || claims.email !== expectedEmail || claims.email_verified !== true) {
    throw new Error("Google OIDC claims are invalid.");
  }
  return claims;
}

export function headerMap(payload: Record<string, unknown>) {
  const headers = (payload.headers ?? []) as Array<{ name?: string; value?: string }>;
  return Object.fromEntries(headers.map((item) => [String(item.name ?? "").toLowerCase(), String(item.value ?? "")]));
}

export function firstEmail(value: string) {
  const bracketed = value.match(/<([^>]+)>/)?.[1];
  const candidate = (bracketed ?? value).split(",")[0]?.trim().toLowerCase() ?? "";
  return candidate.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() ?? "";
}

export function emailList(value: string) {
  const matches = value.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  return [...new Set(matches.map((email) => email.toLowerCase()))];
}

export function gmailBody(payload: Record<string, unknown>): string {
  const body = payload.body as Record<string, unknown> | undefined;
  if (typeof body?.data === "string") return new TextDecoder().decode(base64UrlToBytes(body.data));
  const parts = Array.isArray(payload.parts) ? payload.parts as Record<string, unknown>[] : [];
  const text = parts.find((part) => part.mimeType === "text/plain");
  if (text) return gmailBody(text);
  const html = parts.find((part) => part.mimeType === "text/html");
  return html ? gmailBody(html) : "";
}

