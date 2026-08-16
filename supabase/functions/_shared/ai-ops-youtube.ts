// Real YouTube ingestion for AI Operations, using the official YouTube Data API v3.
// Read-only: comments and statistics are fetched and stored. Nothing is posted to YouTube.
// Authentication: OAuth 2.0 refresh-token flow (server-side only). An API key is used only
// as an optional fallback when OAuth secrets are not configured.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";

const API = "https://www.googleapis.com/youtube/v3";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export type YoutubeSyncResult = {
  available: boolean;
  reason?: string;
  authMode?: "oauth" | "api_key";
  channelTitle?: string;
  videosScanned?: number;
  commentsSeen?: number;
  commentsUpserted?: number;
  metricsCaptured?: number;
};

export function youtubeApiKey(): string | null { return Deno.env.get("YOUTUBE_API_KEY") || null; }

export function youtubeOauthConfigured(): boolean {
  return Boolean(
    Deno.env.get("YOUTUBE_OAUTH_CLIENT_ID") &&
    Deno.env.get("YOUTUBE_OAUTH_CLIENT_SECRET") &&
    Deno.env.get("YOUTUBE_OAUTH_REFRESH_TOKEN"),
  );
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Exchanges the stored refresh token for a short-lived access token. Never logged or returned to clients. */
export async function youtubeAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const body = new URLSearchParams({
    client_id: Deno.env.get("YOUTUBE_OAUTH_CLIENT_ID") ?? "",
    client_secret: Deno.env.get("YOUTUBE_OAUTH_CLIENT_SECRET") ?? "",
    refresh_token: Deno.env.get("YOUTUBE_OAUTH_REFRESH_TOKEN") ?? "",
    grant_type: "refresh_token",
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new Error(`YouTube OAuth token refresh failed (${response.status}): ${payload?.error_description ?? payload?.error ?? "unknown error"}`);
  }
  const expiresIn = Number(payload.expires_in ?? 3600);
  cachedToken = { token: payload.access_token as string, expiresAt: Date.now() + expiresIn * 1000 };
  return cachedToken.token;
}

type Auth = { mode: "oauth"; token: string } | { mode: "api_key"; key: string };

async function resolveAuth(): Promise<Auth | null> {
  if (youtubeOauthConfigured()) return { mode: "oauth", token: await youtubeAccessToken() };
  const key = youtubeApiKey();
  return key ? { mode: "api_key", key } : null;
}

function authorize(url: string, auth: Auth): { url: string; headers: HeadersInit } {
  if (auth.mode === "oauth") return { url, headers: { authorization: `Bearer ${auth.token}` } };
  return { url: `${url}${url.includes("?") ? "&" : "?"}key=${auth.key}`, headers: {} };
}

async function getJson(path: string, auth: Auth): Promise<Record<string, unknown>> {
  const { url, headers } = authorize(`${API}${path}`, auth);
  const response = await fetch(url, { headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (payload as { error?: { message?: string } })?.error?.message ?? `YouTube API request failed (${response.status}).`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload as Record<string, unknown>;
}

/** Identity of the account behind the OAuth refresh token (used for verification and channel fallback). */
export async function youtubeAuthenticatedChannel(): Promise<{ id: string; title: string } | null> {
  if (!youtubeOauthConfigured()) return null;
  const auth = await resolveAuth();
  if (!auth) return null;
  const payload = await getJson(`/channels?part=snippet&mine=true`, auth) as {
    items?: Array<{ id?: string; snippet?: { title?: string } }>;
  };
  const item = payload.items?.[0];
  if (!item?.id) return null;
  return { id: item.id, title: item.snippet?.title ?? "" };
}

const asBigIntString = (value: string | undefined) => {
  if (!value || !/^\d+$/.test(value)) return null;
  return value;
};


export async function syncYoutubeComments(options: {
  admin: SupabaseClient; tenantId: string; channelId: string | null; btyPlaylistId: string | null; maxVideos?: number;
}): Promise<YoutubeSyncResult> {
  const auth = await resolveAuth();
  if (!auth) return { available: false, reason: "youtube_credentials_missing" };
  let channelTitle = "";
  let channelId = options.channelId;
  if (!channelId && auth.mode === "oauth") {
    const identity = await youtubeAuthenticatedChannel();
    channelId = identity?.id ?? null;
    channelTitle = identity?.title ?? "";
  }
  if (!channelId) return { available: false, reason: "youtube_channel_not_configured", authMode: auth.mode };
  const maxVideos = Math.min(Math.max(options.maxVideos ?? 10, 1), 25);

  const channel = await getJson(`/channels?part=snippet,contentDetails,statistics&id=${encodeURIComponent(channelId)}`, auth) as {
    items?: Array<{ snippet?: { title?: string }; contentDetails?: { relatedPlaylists?: { uploads?: string } }; statistics?: { subscriberCount?: string } }>;
  };
  const uploads = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return { available: false, reason: "youtube_channel_not_found", authMode: auth.mode };
  channelTitle = channel.items?.[0]?.snippet?.title ?? channelTitle;
  const subscriberCount = asBigIntString(channel.items?.[0]?.statistics?.subscriberCount);

  const playlist = await getJson(`/playlistItems?part=snippet&maxResults=${maxVideos}&playlistId=${encodeURIComponent(uploads)}`, auth) as {
    items?: Array<{ snippet?: { resourceId?: { videoId?: string }; title?: string } }>;
  };

  const btyVideoIds = new Set<string>();
  if (options.btyPlaylistId) {
    const bty = await getJson(`/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(options.btyPlaylistId)}`, auth).catch(() => ({})) as {
      items?: Array<{ snippet?: { resourceId?: { videoId?: string } } }>;
    };
    for (const item of bty.items ?? []) {
      const id = item.snippet?.resourceId?.videoId;
      if (id) btyVideoIds.add(id);
    }
  }

  const videoIds = (playlist.items ?? []).map((item) => item.snippet?.resourceId?.videoId).filter((id): id is string => Boolean(id));
  const detailsById = new Map<string, VideoDetails>();
  if (videoIds.length) {
    const details = await getJson(`/videos?part=snippet,statistics&id=${encodeURIComponent(videoIds.join(','))}`, auth) as { items?: VideoDetails[] };
    for (const video of details.items ?? []) if (video.id) detailsById.set(video.id, video);

  }

  let commentsSeen = 0;
  let commentsUpserted = 0;
  let videosScanned = 0;
  let metricsCaptured = 0;
  const metricSnapshotAt = new Date().toISOString();

  for (const item of playlist.items ?? []) {
    const videoId = item.snippet?.resourceId?.videoId;
    if (!videoId) continue;
    videosScanned += 1;
    const details = detailsById.get(videoId);
    const videoTitle = details?.snippet?.title ?? item.snippet?.title ?? "";
    const initiative = btyVideoIds.has(videoId) ? "beyond_the_yellow" : "valorwell";

    const metric = await options.admin.rpc("ai_ops_upsert_youtube_video_metric", {
      p_tenant_id: options.tenantId,
      p_channel_id: channelId,
      p_video_id: videoId,
      p_video_title: videoTitle,
      p_initiative: initiative,
      p_published_at: details?.snippet?.publishedAt ?? null,
      p_view_count: asBigIntString(details?.statistics?.viewCount),
      p_like_count: asBigIntString(details?.statistics?.likeCount),
      p_comment_count: asBigIntString(details?.statistics?.commentCount),
      p_subscriber_count: subscriberCount,
      p_snapshot_at: metricSnapshotAt,
    });
    if (!metric.error) metricsCaptured += 1;

    let threads: { items?: CommentThreadItem[] };
    try {
      threads = await getJson(`/commentThreads?part=snippet,replies&maxResults=50&order=time&videoId=${videoId}`, auth) as { items?: CommentThreadItem[] };
    } catch {
      continue;
    }

    for (const thread of threads.items ?? []) {
      const top = thread.snippet?.topLevelComment;
      const flat: Array<{ id?: string; snippet?: YoutubeCommentSnippet; parentId?: string }> = [];
      if (top?.id) flat.push({ id: top.id, snippet: top.snippet });
      for (const reply of thread.replies?.comments ?? []) if (reply.id) flat.push({ id: reply.id, snippet: reply.snippet, parentId: top?.id });
      for (const comment of flat) {
        if (!comment.id) continue;
        commentsSeen += 1;
        const snippet = comment.snippet ?? {};
        const { error } = await options.admin.rpc("ai_ops_upsert_youtube_comment", {
          p_tenant_id: options.tenantId, p_channel_id: channelId, p_video_id: videoId,
          p_video_title: videoTitle, p_comment_id: comment.id, p_parent_comment_id: comment.parentId ?? snippet.parentId ?? null,
          p_author_display_name: snippet.authorDisplayName ?? null,
          p_comment_text: snippet.textOriginal ?? snippet.textDisplay ?? "",
          p_published_at: snippet.publishedAt ?? null, p_comment_updated_at: snippet.updatedAt ?? snippet.publishedAt ?? null,
          p_initiative: initiative,
        });
        if (!error) commentsUpserted += 1;
      }
    }
  }

  return { available: true, authMode: auth.mode, channelTitle, videosScanned, commentsSeen, commentsUpserted, metricsCaptured };
}
