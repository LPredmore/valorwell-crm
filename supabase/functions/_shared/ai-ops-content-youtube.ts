// Retired: video-idea discovery has been removed from ValorWell.
// This compatibility stub deliberately performs no YouTube search or external request.

export const CONTENT_OPPORTUNITY_MODEL = "retired";
export const CONTENT_OPPORTUNITY_LOOKBACK_HOURS = 0;
export const CONTENT_OPPORTUNITY_MIN_DURATION_SECONDS = 0;
export const CONTENT_OPPORTUNITY_MAX_CANDIDATES = 0;
export const CONTENT_OPPORTUNITY_SEARCH_QUERIES = [] as const;

export type YoutubeContentCandidate = never;

export type YoutubeContentOpportunityEvidence = {
  provider: "retired";
  publishedAfter: string;
  publishedBefore: string;
  lookbackHours: number;
  minimumDurationSeconds: number;
  searchQueries: string[];
  uniqueVideosFound: number;
  eligibleLongFormVideos: number;
  candidates: never[];
};

export function parseYoutubeDurationSeconds(_value?: string | null): null {
  return null;
}

export async function collectYoutubeContentOpportunityEvidence(
  _request: Record<string, unknown>,
): Promise<YoutubeContentOpportunityEvidence> {
  throw new Error("video_idea_discovery_removed");
}
