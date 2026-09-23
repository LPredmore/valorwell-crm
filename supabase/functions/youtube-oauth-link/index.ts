import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.93.1";

// Single-use setup link: gated by a random token given directly to the operator, not
// discoverable or guessable, and not tied to any user session (this flow runs before
// anything about the CRM's own auth matters -- it's re-authorizing a service credential).
// Read from a secret rather than hardcoded, since this function's source lives in a
// public repo -- unlike video-drive-oauth-link's equivalent, which was deployed directly
// and never committed.
const SETUP_TOKEN = Deno.env.get("YOUTUBE_OAUTH_LINK_SETUP_TOKEN") ?? "";
const CALLBACK_URL = "https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/youtube-oauth-callback";
// force-ssl is requested alongside upload (not just upload alone) so a fresh consent
// can't silently narrow the scopes already granted -- Google replaces the full scope set
// on prompt=consent, it doesn't union with whatever the old token had.
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

function b64url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
function randomToken(n = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}
async function sha256B64Url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return b64url(new Uint8Array(digest));
}

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);
  const suppliedToken = url.searchParams.get("token");
  if (request.method !== "GET" || !SETUP_TOKEN || !suppliedToken || suppliedToken !== SETUP_TOKEN) {
    return new Response("Not found", { status: 404 });
  }

  const clientId = Deno.env.get("YOUTUBE_OAUTH_CLIENT_ID") ?? "";
  const sbUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!clientId || !sbUrl || !serviceKey) {
    return new Response("YouTube OAuth runtime is not configured (missing YOUTUBE_OAUTH_CLIENT_ID or Supabase service credentials).", { status: 503 });
  }

  const admin = createClient(sbUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = await sha256B64Url(verifier);

  const { error } = await admin.from("oauth_handoff").insert({
    purpose: "youtube_oauth_state",
    payload: { state, code_verifier: verifier },
  });
  if (error) return new Response(`Could not start the OAuth flow: ${error.message}`, { status: 500 });

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: CALLBACK_URL,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  return Response.redirect(auth.toString(), 302);
});
