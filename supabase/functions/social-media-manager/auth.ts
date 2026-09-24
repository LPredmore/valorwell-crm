import { createClient } from "npm:@supabase/supabase-js@2.93.1";

import type { AuthContext, CrmCapabilities } from "./context.ts";

export { requireMutate, type AuthContext, type CrmCapabilities } from "./context.ts";

/**
 * Races a promise against a hard deadline so a stuck upstream call (Postgres lock,
 * network stall, etc.) fails fast with a clear error instead of hanging until the
 * platform's own execution limit kills the isolate with no useful log entry.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`TIMEOUT:${label}`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Authenticates the caller and resolves their CRM operating context server-side via the
 * same get_crm_operating_context() RPC the frontend's CrmAuthContext uses -- the tenant id
 * and capabilities returned here are authoritative and never taken from the request body.
 */
export async function authenticate(request: Request): Promise<AuthContext> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anon || !service) throw new Error("SERVER_NOT_CONFIGURED");

  const userDb = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data, error } = await withTimeout(
    (async () => await userDb.rpc("get_crm_operating_context"))(),
    8000,
    "get_crm_operating_context",
  );
  if (error || !data || typeof data !== "object") throw new Error("UNAUTHORIZED");

  const context = data as Record<string, unknown>;
  if (context.authenticated !== true) throw new Error("UNAUTHORIZED");

  const tenantId = context.current_tenant_id as string | null;
  if (!tenantId) throw new Error("FORBIDDEN");

  const db = createClient(url, service, { auth: { persistSession: false } });

  return {
    userId: String(context.profile_id ?? ""),
    tenantId,
    crmRole: String(context.crm_role ?? "crm_none"),
    capabilities: (context.capabilities ?? {}) as CrmCapabilities,
    db,
  };
}
