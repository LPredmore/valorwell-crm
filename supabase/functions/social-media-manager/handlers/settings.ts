import type { AuthContext } from "../context.ts";

export type PreferredScheduleTimes = {
  short: string[];
  longForm: string[];
};

export const DEFAULT_PREFERRED_SCHEDULE_TIMES: PreferredScheduleTimes = {
  short: ["12:00", "15:00", "18:00"],
  longForm: ["08:00", "14:00"],
};

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function validTimes(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const result = [...new Set(value.filter((time): time is string => typeof time === "string" && TIME_PATTERN.test(time)))];
  return result.length ? result : [...fallback];
}

export function resolvePreferredScheduleTimes(settings: Record<string, unknown> | null): PreferredScheduleTimes {
  const metadata = settings?.metadata && typeof settings.metadata === "object"
    ? settings.metadata as Record<string, unknown>
    : {};
  const raw = metadata.preferred_schedule_times && typeof metadata.preferred_schedule_times === "object"
    ? metadata.preferred_schedule_times as Record<string, unknown>
    : {};
  return {
    short: validTimes(raw.short, DEFAULT_PREFERRED_SCHEDULE_TIMES.short),
    longForm: validTimes(raw.long_form, DEFAULT_PREFERRED_SCHEDULE_TIMES.longForm),
  };
}

export async function getPreferredScheduleConfig(auth: AuthContext) {
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

  const settingsRecord = (settings ?? null) as Record<string, unknown> | null;
  return {
    account,
    settings: settingsRecord,
    timezone: String(settingsRecord?.timezone ?? "America/Chicago"),
    preferredScheduleTimes: resolvePreferredScheduleTimes(settingsRecord),
  };
}

export async function getSettings(auth: AuthContext) {
  const { account, settings, timezone, preferredScheduleTimes } = await getPreferredScheduleConfig(auth);

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
    timezone,
    preferredScheduleTimes,
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
