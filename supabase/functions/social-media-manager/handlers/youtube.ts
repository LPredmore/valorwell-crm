import type { AuthContext } from "../auth.ts";
import { youtubeAccessToken, youtubeOauthConfigured } from "../../_shared/ai-ops-youtube.ts";

const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

export type ConnectionState = "configured" | "connected" | "needs_reauth" | "error" | "disabled";

export async function verifyYoutubeConnection(auth: AuthContext) {
  const { data: account, error: accountError } = await auth.db
    .from("ai_operations_social_accounts")
    .select("*")
    .eq("tenant_id", auth.tenantId)
    .eq("platform", "youtube")
    .eq("is_default", true)
    .maybeSingle();
  if (accountError) throw new Error(accountError.message);
  if (!account) throw new Error("No default YouTube account is configured.");
  if (account.auth_status === "disabled") {
    return { state: "disabled" as ConnectionState, channelId: null, channelTitle: null, missingScopes: [], reason: "Account is disabled." };
  }

  if (!youtubeOauthConfigured()) {
    await updateAccountStatus(auth, account.id, "configured");
    return { state: "configured" as ConnectionState, channelId: null, channelTitle: null, missingScopes: REQUIRED_SCOPES, reason: "OAuth credentials are not configured." };
  }

  let accessToken: string;
  try {
    accessToken = await youtubeAccessToken();
  } catch (error) {
    await updateAccountStatus(auth, account.id, "needs_reauth");
    return { state: "needs_reauth" as ConnectionState, channelId: null, channelTitle: null, missingScopes: REQUIRED_SCOPES, reason: error instanceof Error ? error.message : String(error) };
  }

  const [identityResponse, tokenInfoResponse] = await Promise.all([
    fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true", {
      headers: { authorization: `Bearer ${accessToken}` },
    }),
    fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`),
  ]);

  const identity = await identityResponse.json().catch(() => ({}));
  const tokenInfo = await tokenInfoResponse.json().catch(() => ({}));

  if (!identityResponse.ok || !identity?.items?.[0]?.id) {
    await updateAccountStatus(auth, account.id, "error");
    return { state: "error" as ConnectionState, channelId: null, channelTitle: null, missingScopes: [], reason: identity?.error?.message ?? "Could not resolve the authenticated YouTube channel." };
  }

  const channelId = String(identity.items[0].id);
  const channelTitle = String(identity.items[0].snippet?.title ?? "");
  if (channelId !== account.external_account_id) {
    await updateAccountStatus(auth, account.id, "error");
    return {
      state: "error" as ConnectionState, channelId, channelTitle, missingScopes: [],
      reason: `Authenticated channel (${channelId}) does not match the configured account (${account.external_account_id}).`,
    };
  }

  const grantedScopes = String(tokenInfo?.scope ?? "").split(" ").filter(Boolean);
  const missingScopes = REQUIRED_SCOPES.filter((scope) => !grantedScopes.includes(scope));
  // Diagnostic only -- scopes are not secret, the access token itself is never logged.
  console.log(JSON.stringify({ component: "verify_youtube_connection", grantedScopes, missingScopes, tokenInfoError: tokenInfo?.error ?? null }));
  if (missingScopes.length) {
    await updateAccountStatus(auth, account.id, "needs_reauth");
    return {
      state: "needs_reauth" as ConnectionState, channelId, channelTitle, missingScopes,
      reason: "The stored refresh token does not grant the scopes required to publish.",
    };
  }

  await updateAccountStatus(auth, account.id, "connected");
  return { state: "connected" as ConnectionState, channelId, channelTitle, missingScopes: [], reason: null };
}

async function updateAccountStatus(auth: AuthContext, accountId: string, authStatus: string) {
  await auth.db
    .from("ai_operations_social_accounts")
    .update({ auth_status: authStatus, last_verified_at: new Date().toISOString() })
    .eq("id", accountId);
}
