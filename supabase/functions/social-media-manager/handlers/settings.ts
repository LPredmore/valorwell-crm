import type { AuthContext } from "../auth.ts";

export async function getSettings(auth: AuthContext) {
  const { data: account, error: accountError } = await auth.db
    .from("ai_operations_social_accounts")
    .select("*")
    .eq("tenant_id", auth.tenantId)
    .eq("platform", "youtube")
    .eq("is_default", true)
    .maybeSingle();
  if (accountError) throw new Error(accountError.message);
  if (!account) throw new Error("No default YouTube account is configured.");

  const { data: settings, error: settingsError } = await auth.db
    .from("ai_operations_social_settings")
    .select("*")
    .eq("account_id", account.id)
    .maybeSingle();
  if (settingsError) throw new Error(settingsError.message);

  const { data: routingRules, error: routingError } = await auth.db
    .from("ai_operations_social_routing_rules")
    .select("*, ai_operations_social_playlists(display_name)")
    .eq("account_id", account.id)
    .eq("enabled", true)
    .order("priority", { ascending: true });
  if (routingError) throw new Error(routingError.message);

  const { data: playlists, error: playlistsError } = await auth.db
    .from("ai_operations_social_playlists")
    .select("*")
    .eq("account_id", account.id)
    .eq("is_active", true);
  if (playlistsError) throw new Error(playlistsError.message);

  return {
    account: {
      id: account.id,
      displayName: account.display_name,
      externalAccountId: account.external_account_id,
      authStatus: account.auth_status,
      lastVerifiedAt: account.last_verified_at,
    },
    defaults: settings,
    routing: (routingRules ?? []).map((rule) => ({
      sourceType: rule.source_type,
      sourceClipType: rule.source_clip_type,
      contentFormat: rule.content_format,
      defaultPlaylistName: (rule.ai_operations_social_playlists as { display_name: string } | null)?.display_name ?? null,
    })),
    playlists: (playlists ?? []).map((playlist) => ({
      id: playlist.id,
      canonicalKey: playlist.canonical_key,
      displayName: playlist.display_name,
      externalPlaylistId: playlist.external_playlist_id,
    })),
  };
}
