// Runtime helpers shared by the BTY discovery / enrichment / dispatcher functions.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";
import { BTY_TENANT_ID } from "./bty.ts";

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

/** Internal automation endpoints accept a service-role bearer or the private worker token. */
export async function authorizeWorker(request: Request, admin: SupabaseClient, tenantId = BTY_TENANT_ID) {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (serviceKey && authorization === `Bearer ${serviceKey}`) return true;
  const token = request.headers.get("x-bty-worker-token") ?? "";
  if (!token) return false;
  const { data, error } = await admin.rpc("bty_worker_token_valid", {
    p_tenant_id: tenantId,
    p_token: token,
  });
  return !error && data === true;
}

export function logEvent(component: string, event: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ component, event, ...detail }));
}

export function safeError(error: unknown): { message: string; kind?: string } {
  if (error && typeof error === "object" && "kind" in error) {
    return { message: String((error as Error).message), kind: String((error as { kind: unknown }).kind) };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}
