// Real YouTube ingestion for AI Operations, using the official YouTube Data API v3.
// Read-only: comments and statistics are fetched and stored. Nothing is posted to YouTube.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";

const API = "https://www.googleapis.com/youtube/v3";

export type YoutubeSyncResult = {
  available: boolean;
  reason?: string;
  videosScanned?: number;
  commentsSeen?: number;
  commentsUpserted?: number;
  metricsCaptured?: number;
};

export function youtubeApiKey(): string | null { return Deno.env.get("YOUTUBE_API_KEY") || null; }

type CommentThreadItem = {
  snippet?: { videoId?: string; topLevelComment?: { id?: string; snippet?: YoutubeCommentSnippet } };
  replies?: { comments?: Array<{ id?: string; snippet?: YoutubeCommentSnippet }> };
};
type YoutubeCommentSnippet = {
  textOriginal?: string; textDisplay?: string; authorDisplayName?: string;
  publishedAt?: string; updatedAt?: string; parentId?: string;
};

type VideoDetails = {
  id?: string;
  snippet?: { title?: string; publishedAt?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
};

async function getJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (payload as { error?: { message?: string } })?.error?.message ?? `YouTube API request failed (${response.status}).`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload as Record<string, unknown>;
}

const asBigIntString = (value: string | undefined) => {
  if (!value || !/^\d+$/.test(value)) return null;
  return value;
};

export async function syncYoutubeComments(options: {
  admin: SupabaseClient; tenantId: string; channelId: string | null; btyPlaylistId: string | null; maxVideos?: number;
}): Promise<YoutubeSyncResult> {
  const apiKey = youtubeApiKey();
  if (!apiKey) return { available: false, reason: "youtube_api_key_missing" };
  if (!options.channelId) return { available: false, reason: "youtube_channel_not_configured" };
  const maxVideos = Math.min(Math.max(options.maxVideos ?? 10, 1), 25);

  const channel = await getJson(`${API}/channels?part=contentDetails,statistics&id=${encodeURIComponent(options.channelId)}&key=${apiKey}`) as {
    items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } }; statistics?: { subscriberCount?: string } }>;
  };
  const uploads = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return { available: false, reason: "youtube_channel_not_found" };
  const subscriberCount = asBigIntString(channel.items?.[0]?.statistics?.subscriberCount);

  const playlist = await getJson(`${API}/playlistItems?part=snippet&maxResults=${maxVideos}&playlistId=${encodeURIComponent(uploads)}&key=${apiKey}`) as {
    items?: Array<{ snippet?: { resourceId?: { videoId?: string }; title?: string } }>;
  };

  const btyVideoIds = new Set<string>();
  if (options.btyPlaylistId) {
    const bty = await getJson(`${API}/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(options.btyPlaylistId)}&key=${apiKey}`).catch(() => ({})) as {
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
    const details = await getJson(`${API}/videos?part=snippet,statistics&id=${encodeURIComponent(videoIds.join(','))}&key=${apiKey}`) as { items?: VideoDetails[] };
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
      p_channel_id: options.channelId,
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
      threads = await getJson(`${API}/commentThreads?part=snippet,replies&maxResults=50&order=time&videoId=${videoId}&key=${apiKey}`) as { items?: CommentThreadItem[] };
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
          p_tenant_id: options.tenantId, p_channel_id: options.channelId, p_video_id: videoId,
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

  return { available: true, videosScanned, commentsSeen, commentsUpserted, metricsCaptured };
}
