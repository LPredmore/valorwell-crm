import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { authenticate, requireMutate, type AuthContext } from "./auth.ts";
import { listLibrary } from "./handlers/library.ts";
import {
  approvePublication, cancelPublication, createPublication, getPublication,
  listPublicationEvents, listPublications, queuePublish, reschedulePublication,
  retryPublication, setPublicationPlaylists, updatePublication, validatePublication,
} from "./handlers/publications.ts";
import { getSettings } from "./handlers/settings.ts";
import { verifyYoutubeConnection } from "./handlers/youtube.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200, requestId?: string) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, "content-type": "application/json", ...(requestId ? { "x-request-id": requestId } : {}) } },
);

function safeLog(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  const payload = JSON.stringify({ component: "social-media-manager", event, ...fields });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.log(payload);
}

// View actions: any authenticated CRM user with a resolved tenant (including crm_readonly).
const VIEW_ACTIONS = new Set([
  "bootstrap", "list_library", "list_publications", "get_publication",
  "list_publication_events", "get_settings", "verify_youtube_connection",
]);
// Mutation actions: require capabilities.mutate (crm_admin/crm_operator today).
const MUTATE_ACTIONS = new Set([
  "create_publication", "update_publication", "validate_publication", "approve_publication",
  "set_publication_playlists", "queue_publish", "reschedule_publication",
  "cancel_publication", "retry_publication",
]);

async function dispatch(auth: AuthContext, action: string, params: Record<string, unknown>) {
  switch (action) {
    case "bootstrap":
      return { auth: { userId: auth.userId, tenantId: auth.tenantId, crmRole: auth.crmRole, capabilities: auth.capabilities } };
    case "list_library":
      return listLibrary(auth, (params.filters as Record<string, unknown>) ?? {});
    case "list_publications":
      return listPublications(auth, params as { status?: string; scheduledOnly?: boolean });
    case "get_publication":
      return getPublication(auth, params as { id: string });
    case "list_publication_events":
      return listPublicationEvents(auth, params as { id: string });
    case "get_settings":
      return getSettings(auth);
    case "verify_youtube_connection":
      return verifyYoutubeConnection(auth);
    case "create_publication":
      return createPublication(auth, params as never);
    case "update_publication":
      return updatePublication(auth, params as { id: string; changes: Record<string, unknown> });
    case "validate_publication":
      return validatePublication(auth, params as { id: string });
    case "approve_publication":
      return approvePublication(auth, params as { id: string });
    case "set_publication_playlists":
      return setPublicationPlaylists(auth, params as { id: string; playlistIds: string[] });
    case "queue_publish":
      return queuePublish(auth, params as { id: string });
    case "reschedule_publication":
      return reschedulePublication(auth, params as { id: string; scheduledFor: string });
    case "cancel_publication":
      return cancelPublication(auth, params as { id: string });
    case "retry_publication":
      return retryPublication(auth, params as { id: string });
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

Deno.serve(async (request: Request) => {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: { ...corsHeaders, "x-request-id": requestId } });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed", requestId }, 405, requestId);

  let body: { action?: string } & Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body", requestId }, 400, requestId);
  }
  const action = String(body.action ?? "");
  if (!VIEW_ACTIONS.has(action) && !MUTATE_ACTIONS.has(action)) {
    return json({ error: `Invalid action: ${action}`, requestId }, 400, requestId);
  }

  let auth: AuthContext;
  try {
    auth = await authenticate(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNAUTHORIZED";
    const isTimeout = message.startsWith("TIMEOUT:");
    safeLog("error", "auth_failed", { requestId, action, message });
    return json(
      { error: isTimeout ? "AUTH_TIMEOUT" : message, action, requestId },
      isTimeout ? 504 : message === "FORBIDDEN" ? 403 : 401,
      requestId,
    );
  }

  try {
    if (MUTATE_ACTIONS.has(action)) requireMutate(auth);
    const { action: _omit, ...params } = body;
    // A hung DB/network call inside a handler fails fast here instead of running until the
    // platform kills the isolate with no useful log entry to correlate against.
    const data = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`TIMEOUT:${action}`)), 20000);
      dispatch(auth, action, params).then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
    return json({ data, requestId }, 200, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = message.startsWith("TIMEOUT:");
    safeLog("error", "request_failed", { requestId, action, tenantId: auth.tenantId, message });
    return json(
      { error: isTimeout ? "REQUEST_TIMEOUT" : message, action, requestId },
      isTimeout ? 504 : message === "FORBIDDEN" ? 403 : 500,
      requestId,
    );
  }
});
