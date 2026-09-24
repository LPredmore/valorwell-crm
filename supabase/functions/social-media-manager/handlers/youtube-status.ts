import type { AuthContext } from "../context.ts";

export type ConnectionState = "configured" | "connected" | "needs_reauth" | "error" | "disabled";

const KNOWN_STATES = new Set<ConnectionState>(["configured", "connected", "needs_reauth", "error", "disabled"]);

export async function loadDefaultAccount(auth: AuthContext) {
  const { data: account, error: accountError } = await auth.db
    .from("ai_operations_social_accounts")
    .select("*")
    .eq("tenant_id", auth.tenantId)
    .eq("platform", "youtube")
    .eq("is_default", true)
    .maybeSingle();
  if (accountError) throw new Error(accountError.message);
  if (!account) throw new Error("No default YouTube account is configured.");
  return account;
}

/**
 * Read-only: reports the connection state recorded by the last explicit verification.
 * Never calls Google and never writes, so it is safe for readonly users and page loads.
 */
export async function getYoutubeConnectionStatus(auth: AuthContext) {
  const account = await loadDefaultAccount(auth);
  const recorded = String(account.auth_status ?? "configured") as ConnectionState;
  const state: ConnectionState = KNOWN_STATES.has(recorded) ? recorded : "error";
  return {
    state,
    channelId: state === "connected" ? String(account.external_account_id) : null,
    channelTitle: state === "connected" ? (account.display_name as string | null) : null,
    missingScopes: [] as string[],
    reason: state === "connected" || state === "configured" ? null
      : state === "disabled" ? "Account is disabled."
      : "The last verification failed. Verify the connection again for details.",
    lastVerifiedAt: (account.last_verified_at as string | null) ?? null,
    source: "recorded" as const,
  };
}

