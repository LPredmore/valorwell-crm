import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { adminClient, authorizeWorker, AI_OPS_TENANT_ID, json, logEvent, safeError } from "../_shared/ai-ops.ts";
import { syncYoutubeComments, youtubeAuthenticatedChannel, youtubeOauthConfigured, youtubeApiKey } from "../_shared/ai-ops-youtube.ts";

// Server-side only. Credentials come from Supabase secrets and are never returned in responses.
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!authorizeWorker(request)) return json({ error: "Unauthorized." }, 401);
  try {
    const body = await request.json().catch(() => ({})) as { tenantId?: string; maxVideos?: number; verifyOnly?: boolean };
    const tenantId = body.tenantId ?? AI_OPS_TENANT_ID;
    const admin = adminClient();

    const auth = {
      oauthConfigured: youtubeOauthConfigured(),
      apiKeyFallbackConfigured: Boolean(youtubeApiKey()),
    };
    let identity: { id: string; title: string } | null = null;
    if (auth.oauthConfigured) identity = await youtubeAuthenticatedChannel();

    if (body.verifyOnly) return json({ auth, identity });

    const { data: settings } = await admin
      .from("ai_operations_settings")
      .select("youtube_channel_id, bty_playlist_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const sync = await syncYoutubeComments({
      admin,
      tenantId,
      channelId: settings?.youtube_channel_id ?? identity?.id ?? null,
      btyPlaylistId: settings?.bty_playlist_id ?? null,
      maxVideos: body.maxVideos,
    });
    logEvent("ai-operations-youtube-sync", "sync_complete", { tenantId, ...sync });
    return json({ auth, identity, sync });
  } catch (error) {
    logEvent("ai-operations-youtube-sync", "sync_failed", { error: safeError(error) });
    return json({ error: safeError(error) }, 500);
  }
});
