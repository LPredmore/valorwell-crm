/**
 * Channel-gated automatic thumbnail upload for SCHEDULED YouTube Shorts.
 *
 * YouTube's Data API (thumbnails.set) accepts the request for Shorts, but YouTube Help still
 * says custom Shorts thumbnails can only be set in desktop Studio, and an HTTP 200 or
 * contentDetails.hasCustomThumbnail=true does not prove the image is shown on Shorts
 * surfaces. Automatic uploads therefore stay OFF per account until an operator has run an
 * explicit compatibility test on a disposable private Short AND visually confirmed the
 * rendered result. Pure: safe to import from the worker, the CRM control plane and tests.
 */
import { PermanentYoutubeError, YoutubePublishError } from "./errors.ts";

export type ShortsThumbnailFeatureState = "disabled" | "testing" | "api_verified";

/** Key inside ai_operations_social_settings.metadata (per YouTube account). */
export const SHORTS_THUMBNAIL_METADATA_KEY = "shorts_thumbnail_api";

/** Transient (429/5xx/network) thumbnail attempts per video+image before degrading to manual. */
export const MAX_SHORT_THUMBNAIL_ATTEMPTS = 4;

/** Typed confirmation phrases. The server compares exactly. */
export const TEST_CONFIRMATION_PREFIX = "CHANGE THUMBNAIL ";
export const VISUAL_CONFIRMATION_PHRASE = "I SAW THE CUSTOM THUMBNAIL ON SHORTS";

export type ShortsThumbnailTestRun = {
  id: string;
  videoId: string;
  thumbnailFileId: string;
  sourceType: string;
  sourceId: string;
  requestedBy: string;
  requestedAt: string;
  httpStatus: number | null;
  apiAccepted: boolean;
  hasCustomThumbnail: boolean | null;
  error: string | null;
  visualResult: "pending" | "confirmed" | "not_visible";
  visualReviewedBy: string | null;
  visualReviewedAt: string | null;
};

export type ShortsThumbnailFeature = {
  state: ShortsThumbnailFeatureState;
  enabledBy: string | null;
  enabledAt: string | null;
  enabledFromTestRunId: string | null;
  disabledBy: string | null;
  disabledAt: string | null;
  note: string | null;
  testRuns: ShortsThumbnailTestRun[];
};

const STATES = new Set<ShortsThumbnailFeatureState>(["disabled", "testing", "api_verified"]);

export function resolveShortsThumbnailFeature(metadata: unknown): ShortsThumbnailFeature {
  const meta = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
  const raw = meta[SHORTS_THUMBNAIL_METADATA_KEY] && typeof meta[SHORTS_THUMBNAIL_METADATA_KEY] === "object"
    ? meta[SHORTS_THUMBNAIL_METADATA_KEY] as Record<string, unknown> : {};
  const state = STATES.has(raw.state as ShortsThumbnailFeatureState) ? raw.state as ShortsThumbnailFeatureState : "disabled";
  const testRuns = Array.isArray(raw.testRuns) ? (raw.testRuns as ShortsThumbnailTestRun[]).filter((run) => run && typeof run.id === "string") : [];
  const str = (value: unknown) => typeof value === "string" && value ? value : null;
  return {
    state,
    enabledBy: str(raw.enabledBy),
    enabledAt: str(raw.enabledAt),
    enabledFromTestRunId: str(raw.enabledFromTestRunId),
    disabledBy: str(raw.disabledBy),
    disabledAt: str(raw.disabledAt),
    note: str(raw.note),
    testRuns,
  };
}

/**
 * The single gate the worker uses. api_verified alone is not enough: it must also carry the
 * operator and the test run whose visual result was confirmed. Anything else fails closed.
 */
export function isShortsThumbnailApiEnabled(metadata: unknown): boolean {
  const feature = resolveShortsThumbnailFeature(metadata);
  if (feature.state !== "api_verified" || !feature.enabledBy || !feature.enabledFromTestRunId) return false;
  const run = feature.testRuns.find((candidate) => candidate.id === feature.enabledFromTestRunId);
  return Boolean(run && run.apiAccepted && run.visualResult === "confirmed" && run.visualReviewedBy);
}

export function thumbnailIdempotencyKey(videoId: string, fileId: string): string {
  return `${videoId}:${fileId}`;
}

export function studioEditUrl(videoId: string): string {
  return `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/edit`;
}

/** 400/403/404 etc. mean the API will not apply it -> manual Studio. 429/5xx/network retry. */
export function classifyThumbnailFailure(error: unknown): { kind: "manual" | "transient"; status: number | null; retryAfterMs: number | null } {
  const status = error instanceof YoutubePublishError ? error.status : null;
  const retryAfterMs = error instanceof YoutubePublishError ? error.retryAfterMs : null;
  if (error instanceof PermanentYoutubeError) return { kind: "manual", status, retryAfterMs: null };
  return { kind: "transient", status, retryAfterMs };
}

/** UI label for platform_payload.thumbnail.apiStatus. */
export type ThumbnailDisplayStatus =
  | "Pending" | "Uploading" | "API Accepted" | "API Confirmed" | "Manual Required" | "Manual Confirmed" | "Failed" | "Preserved";

export function thumbnailDisplayStatus(apiStatus: unknown): ThumbnailDisplayStatus | null {
  switch (apiStatus) {
    case "queued": case "pending": case "waiting_processing": case "retry_pending": return "Pending";
    case "uploading": return "Uploading";
    case "accepted_unverified": case "api_accepted": return "API Accepted";
    case "confirmed_by_youtube": case "api_confirmed": return "API Confirmed";
    case "manual_required": return "Manual Required";
    case "manual_confirmed": return "Manual Confirmed";
    case "already_present_not_overwritten": return "Preserved";
    case "failed": case "not_applied": return "Failed";
    default: return null;
  }
}
