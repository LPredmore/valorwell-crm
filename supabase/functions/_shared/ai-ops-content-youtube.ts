// YouTube Data API discovery for AI Operations content opportunities.
// YouTube supplies discovery and authoritative metrics; Gemini only interprets the evidence.
import { youtubeGetJson } from "./ai-ops-youtube.ts";

export const CONTENT_OPPORTUNITY_MODEL = "gemini-3.6-flash";
export const CONTENT_OPPORTUNITY_LOOKBACK_HOURS = 24;
export const CONTENT_OPPORTUNITY_MIN_DURATION_SECONDS = 8 * 60;
export const CONTENT_OPPORTUNITY_MAX_CANDIDATES = 30;

export const CONTENT_OPPORTUNITY_SEARCH_QUERIES = [
  "veteran mental health PTSD therapy",
  "veteran family military spouse caregiver PTSD",
  "VA mental health veteran care access",
  "veteran transition civilian life struggle",
  "veteran homelessness addiction employment",
] as const;

type SearchItem = { id?: { videoId?: string } };
type VideoItem = {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
};
type ChannelItem = {
  id?: string;
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
};

export type YoutubeContentCandidate = {
  videoId: string;
  videoUrl: string;
  title: string;
  description: string;
  channelId: string | null;
  channelTitle: string | null;
  publishedAt: string;
  ageHours: number;
  durationSeconds: number;
  durationMinutes: number;
  viewCount: number;
  likeCount: number | null;
  commentCount: number | null;
  viewsPerHour: number;
  engagementRatePct: number | null;
  channelSubscriberCount: number | null;
  viewsToSubscribers: number | null;
  searchQueries: string[];
};

export type YoutubeContentOpportunityEvidence = {
  provider: "youtube_data_api_v3";
  publishedAfter: string;
  publishedBefore: string;
  lookbackHours: number;
  minimumDurationSeconds: number;
  searchQueries: string[];
  uniqueVideosFound: number;
  eligibleLongFormVideos: number;
  candidates: YoutubeContentCandidate[];
};

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function integer(value?: string): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** ISO-8601 duration (PT#H#M#S) to seconds. */
export function parseYoutubeDurationSeconds(value?: string | null): number | null {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec((value ?? "").trim());
  if (!match || !value) return null;
  const [, d, h, m, s] = match;
  if (!d && !h && !m && !s) return null;
  return Math.round(Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3_600 + Number(m ?? 0) * 60 + Number(s ?? 0));
}

function cutoffFromPayload(payload: Record<string, unknown>): Date {
  const supplied = typeof payload.cutoffAt === "string" ? Date.parse(payload.cutoffAt) : Number.NaN;
  return new Date(Number.isFinite(supplied) ? supplied : Date.now());
}

async function searchRecentVideoIds(publishedAfter: string, publishedBefore: string) {
  const sourceQueries = new Map<string, Set<string>>();
  for (const query of CONTENT_OPPORTUNITY_SEARCH_QUERIES) {
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      order: "viewCount",
      relevanceLanguage: "en",
      regionCode: "US",
      safeSearch: "moderate",
      maxResults: "25",
      publishedAfter,
      publishedBefore,
      q: query,
    });
    const payload = await youtubeGetJson(`/search?${params.toString()}`) as { items?: SearchItem[] };
    for (const item of payload.items ?? []) {
      const videoId = item.id?.videoId;
      if (!videoId) continue;
      const existing = sourceQueries.get(videoId) ?? new Set<string>();
      existing.add(query);
      sourceQueries.set(videoId, existing);
    }
  }
  return sourceQueries;
}

async function fetchVideos(videoIds: string[]): Promise<VideoItem[]> {
  const out: VideoItem[] = [];
  for (const group of chunks(videoIds, 50)) {
    const params = new URLSearchParams({
      part: "snippet,statistics,contentDetails",
      id: group.join(","),
    });
    const payload = await youtubeGetJson(`/videos?${params.toString()}`) as { items?: VideoItem[] };
    out.push(...(payload.items ?? []));
  }
  return out;
}

async function fetchChannelSubscribers(channelIds: string[]): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  for (const group of chunks([...new Set(channelIds.filter(Boolean))], 50)) {
    const params = new URLSearchParams({ part: "statistics", id: group.join(",") });
    const payload = await youtubeGetJson(`/channels?${params.toString()}`) as { items?: ChannelItem[] };
    for (const item of payload.items ?? []) {
      if (!item.id) continue;
      result.set(item.id, item.statistics?.hiddenSubscriberCount ? null : integer(item.statistics?.subscriberCount));
    }
  }
  return result;
}

/**
 * Finds recent long-form veteran-related YouTube videos and ranks them by current momentum.
 * No LLM or web-search tool is used here. Titles/descriptions remain untrusted evidence.
 */
export async function collectYoutubeContentOpportunityEvidence(
  request: Record<string, unknown>,
): Promise<YoutubeContentOpportunityEvidence> {
  const cutoff = cutoffFromPayload(request);
  const publishedBefore = cutoff.toISOString();
  const publishedAfter = new Date(cutoff.getTime() - CONTENT_OPPORTUNITY_LOOKBACK_HOURS * 3_600_000).toISOString();

  const sourceQueries = await searchRecentVideoIds(publishedAfter, publishedBefore);
  const videoIds = [...sourceQueries.keys()];
  const videos = await fetchVideos(videoIds);
  const channelSubscribers = await fetchChannelSubscribers(
    videos.map((video) => video.snippet?.channelId ?? "").filter(Boolean),
  );

  const candidates: YoutubeContentCandidate[] = [];
  for (const video of videos) {
    const videoId = video.id ?? "";
    const publishedAt = video.snippet?.publishedAt ?? "";
    const publishedMs = Date.parse(publishedAt);
    const durationSeconds = parseYoutubeDurationSeconds(video.contentDetails?.duration);
    const viewCount = integer(video.statistics?.viewCount);
    if (!videoId || !Number.isFinite(publishedMs) || durationSeconds === null || durationSeconds < CONTENT_OPPORTUNITY_MIN_DURATION_SECONDS || viewCount === null) continue;

    const ageHours = Math.max((cutoff.getTime() - publishedMs) / 3_600_000, 0.25);
    const likeCount = integer(video.statistics?.likeCount);
    const commentCount = integer(video.statistics?.commentCount);
    const channelId = video.snippet?.channelId ?? null;
    const subscriberCount = channelId ? (channelSubscribers.get(channelId) ?? null) : null;
    const engagementRatePct = viewCount > 0 && (likeCount !== null || commentCount !== null)
      ? (((likeCount ?? 0) + (commentCount ?? 0)) / viewCount) * 100
      : null;
    const viewsToSubscribers = subscriberCount && subscriberCount > 0 ? viewCount / subscriberCount : null;

    candidates.push({
      videoId,
      videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
      title: video.snippet?.title ?? "",
      description: (video.snippet?.description ?? "").slice(0, 1200),
      channelId,
      channelTitle: video.snippet?.channelTitle ?? null,
      publishedAt,
      ageHours: Math.round(ageHours * 100) / 100,
      durationSeconds,
      durationMinutes: Math.round((durationSeconds / 60) * 10) / 10,
      viewCount,
      likeCount,
      commentCount,
      viewsPerHour: Math.round(viewCount / ageHours),
      engagementRatePct: engagementRatePct === null ? null : Math.round(engagementRatePct * 100) / 100,
      channelSubscriberCount: subscriberCount,
      viewsToSubscribers: viewsToSubscribers === null ? null : Math.round(viewsToSubscribers * 1000) / 1000,
      searchQueries: [...(sourceQueries.get(videoId) ?? [])],
    });
  }

  candidates.sort((a, b) => {
    if (b.viewsPerHour !== a.viewsPerHour) return b.viewsPerHour - a.viewsPerHour;
    const aRelative = a.viewsToSubscribers ?? -1;
    const bRelative = b.viewsToSubscribers ?? -1;
    if (bRelative !== aRelative) return bRelative - aRelative;
    return b.viewCount - a.viewCount;
  });

  return {
    provider: "youtube_data_api_v3",
    publishedAfter,
    publishedBefore,
    lookbackHours: CONTENT_OPPORTUNITY_LOOKBACK_HOURS,
    minimumDurationSeconds: CONTENT_OPPORTUNITY_MIN_DURATION_SECONDS,
    searchQueries: [...CONTENT_OPPORTUNITY_SEARCH_QUERIES],
    uniqueVideosFound: videoIds.length,
    eligibleLongFormVideos: candidates.length,
    candidates: candidates.slice(0, CONTENT_OPPORTUNITY_MAX_CANDIDATES),
  };
}
