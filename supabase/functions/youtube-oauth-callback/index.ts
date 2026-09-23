import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.93.1";

const CALLBACK_URL = "https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/youtube-oauth-callback";
const STATE_MAX_AGE_MS = 10 * 60_000;

function page(title: string, message: string, ok: boolean) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body style="font-family: system-ui, sans-serif; max-width: 560px; margin: 80px auto; text-align: center;">` +
    `<h1 style="color: ${ok ? "#16a34a" : "#dc2626"}">${title}</h1><p>${message}</p></body></html>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return page("Authorization declined", `Google reported: ${oauthError}. No changes were made.`, false);
  }
  if (!code || !state) {
    return page("Missing parameters", "The redirect from Google was missing the expected code/state.", false);
  }

  const admin = adminClient();

  const { data: stateRows, error: stateError } = await admin
    .from("oauth_handoff")
    .select("id, payload, created_at")
    .eq("purpose", "youtube_oauth_state")
    .order("created_at", { ascending: false })
    .limit(20);
  if (stateError) return page("Server error", `Could not look up the pending request: ${stateError.message}`, false);

  const match = (stateRows ?? []).find((row) => (row.payload as { state?: string })?.state === state);
  if (!match) return page("Expired or unknown request", "This authorization link has already been used or has expired. Ask for a fresh link and try again.", false);
  await admin.from("oauth_handoff").delete().eq("id", match.id);

  if (Date.now() - new Date(match.created_at).getTime() > STATE_MAX_AGE_MS) {
    return page("Expired", "This authorization link expired (10 minute window). Ask for a fresh link and try again.", false);
  }

  const codeVerifier = String((match.payload as { code_verifier?: string })?.code_verifier ?? "");
  const clientId = Deno.env.get("YOUTUBE_OAUTH_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("YOUTUBE_OAUTH_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret) return page("Server error", "YouTube OAuth client credentials are not configured.", false);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: CALLBACK_URL,
    }),
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok) {
    return page("Token exchange failed", `Google returned: ${tokenPayload?.error_description ?? tokenPayload?.error ?? tokenResponse.status}`, false);
  }
  const refreshToken = tokenPayload?.refresh_token;
  if (!refreshToken) {
    return page(
      "No refresh token returned",
      "Google did not return a refresh token. This can happen if consent wasn't actually re-prompted. Try the link again -- it always requests prompt=consent, so a retry should work.",
      false,
    );
  }

  const { error: insertError } = await admin.from("oauth_handoff").insert({
    purpose: "youtube_oauth_result",
    payload: { refresh_token: refreshToken, scope: tokenPayload?.scope ?? null, obtained_at: new Date().toISOString() },
  });
  if (insertError) return page("Server error", `Authorization succeeded but could not be handed off: ${insertError.message}`, false);

  return page("YouTube connection authorized", "You can close this tab. The new authorization is being applied now.", true);
});
