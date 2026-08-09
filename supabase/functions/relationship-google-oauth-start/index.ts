import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import {
  adminClient,
  GOOGLE_OAUTH_CALLBACK,
  json,
  randomToken,
  requireCrmOperator,
  sha256Base64Url,
  sha256Hex,
} from "../_shared/relationship-google.ts";

const scopes = {
  gmail: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"],
  calendar: ["openid", "email", "https://www.googleapis.com/auth/calendar.events.readonly"],
} as const;

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { actorId, tenantId } = await requireCrmOperator(request);
    const input = await request.json().catch(() => ({})) as { connectionType?: string };
    if (input.connectionType !== "gmail" && input.connectionType !== "calendar") {
      return json({ error: "connectionType must be gmail or calendar." }, 400);
    }
    const clientId = Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_ID") ?? "";
    if (!clientId) return json({ error: "Google OAuth client is not configured." }, 503);
    const state = randomToken(32);
    const verifier = randomToken(64);
    const stateHash = await sha256Hex(state);
    const challenge = await sha256Base64Url(verifier);
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const admin = adminClient();
    const { error } = await admin.rpc("create_relationship_google_oauth_state", {
      p_tenant_id: tenantId,
      p_connection_type: input.connectionType,
      p_actor_profile_id: actorId,
      p_state_hash: stateHash,
      p_code_verifier: verifier,
      p_redirect_uri: GOOGLE_OAUTH_CALLBACK,
      p_expires_at: expiresAt,
    });
    if (error) throw new Error(error.message);
    const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorization.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: GOOGLE_OAUTH_CALLBACK,
      response_type: "code",
      scope: scopes[input.connectionType].join(" "),
      access_type: "offline",
      include_granted_scopes: "false",
      prompt: "consent",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return json({ authorizationUrl: authorization.toString(), expiresAt });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 403);
  }
});

