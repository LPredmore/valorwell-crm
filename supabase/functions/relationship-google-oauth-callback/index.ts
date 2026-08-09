import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import {
  adminClient,
  GMAIL_MAILBOX,
  GOOGLE_OAUTH_CALLBACK,
  googleJson,
  json,
  sha256Hex,
} from "../_shared/relationship-google.ts";

function redirectResult(connectionType: string, status: "connected" | "error", message?: string) {
  const appUrl = Deno.env.get("RELATIONSHIP_CRM_URL") ?? "https://crm.valorwell.org";
  const target = new URL("/crm/business-development/integrity", appUrl);
  target.searchParams.set("google", status);
  target.searchParams.set("connection", connectionType || "unknown");
  if (message) target.searchParams.set("reason", message.slice(0, 180));
  return Response.redirect(target.toString(), 302);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code || url.searchParams.has("error")) {
    return redirectResult("unknown", "error", url.searchParams.get("error") ?? "OAuth callback is incomplete.");
  }
  let connectionType = "unknown";
  try {
    const admin = adminClient();
    const { data: stateData, error: stateError } = await admin.rpc("consume_relationship_google_oauth_state", {
      p_state_hash: await sha256Hex(state),
    });
    if (stateError || !stateData) throw new Error(stateError?.message ?? "OAuth state is invalid.");
    const oauthState = stateData as Record<string, string>;
    connectionType = oauthState.connectionType;
    const clientId = Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_ID") ?? "";
    const clientSecret = Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_SECRET") ?? "";
    if (!clientId || !clientSecret) throw new Error("Google OAuth client is not configured.");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: oauthState.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: GOOGLE_OAUTH_CALLBACK,
      }),
    });
    const token = await tokenResponse.json().catch(() => ({})) as Record<string, unknown>;
    if (!tokenResponse.ok || typeof token.access_token !== "string") {
      throw new Error(`Google OAuth token exchange failed (${tokenResponse.status}).`);
    }
    const accessToken = token.access_token;
    const userInfo = await googleJson("https://openidconnect.googleapis.com/v1/userinfo", accessToken);
    let accountEmail = String(userInfo.email ?? "").toLowerCase();
    let calendarId: string | null = null;
    if (connectionType === "gmail") {
      const profile = await googleJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", accessToken);
      accountEmail = String(profile.emailAddress ?? "").toLowerCase();
      if (accountEmail !== GMAIL_MAILBOX) throw new Error("Gmail connection must authenticate exactly info@valorwell.org.");
    } else if (connectionType === "calendar") {
      const calendar = await googleJson("https://www.googleapis.com/calendar/v3/calendars/primary", accessToken);
      calendarId = String(calendar.id ?? "");
      if (!calendarId) throw new Error("Google primary Calendar could not be resolved.");
    } else {
      throw new Error("OAuth connection type is invalid.");
    }
    const scopeSet = String(token.scope ?? "").split(/\s+/).filter(Boolean);
    const required = connectionType === "gmail"
      ? "https://www.googleapis.com/auth/gmail.readonly"
      : "https://www.googleapis.com/auth/calendar.events.readonly";
    if (!scopeSet.includes(required)) throw new Error("Google did not grant the required read-only scope.");
    const { error: storeError } = await admin.rpc("store_relationship_google_connection", {
      p_tenant_id: oauthState.tenantId,
      p_connection_type: connectionType,
      p_google_account_email: accountEmail,
      p_google_account_id: String(userInfo.sub ?? "") || null,
      p_calendar_id: calendarId,
      p_scopes: scopeSet,
      p_refresh_token: typeof token.refresh_token === "string" ? token.refresh_token : null,
      p_actor_profile_id: oauthState.actorProfileId,
    });
    if (storeError) throw new Error(storeError.message);
    return redirectResult(connectionType, "connected");
  } catch (error) {
    return redirectResult(connectionType, "error", error instanceof Error ? error.message : String(error));
  }
});

