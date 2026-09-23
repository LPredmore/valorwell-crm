import { supabase } from "@/integrations/supabase/client";

export type ContentFormat = "short" | "long_form" | "full_episode";
export type SourceType = "clip" | "project";
export type PublicationStatus =
  | "draft" | "ready" | "approved" | "upload_queued" | "uploading"
  | "uploaded" | "scheduled" | "published" | "failed" | "cancelled";
export type PrivacyStatus = "public" | "unlisted" | "private";
export type DeliveryMode = "immediate" | "scheduled";

export type SocialPublicationSummary = {
  id: string;
  status: PublicationStatus;
  deliveryMode: DeliveryMode;
  scheduledFor: string | null;
  desiredPrivacyStatus: PrivacyStatus;
  externalVideoId: string | null;
  externalUrl: string | null;
};

export type SocialMediaLibraryItem = {
  sourceType: SourceType;
  sourceId: string;
  projectId: string;
  clipId: string | null;
  contentFormat: ContentFormat;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  thumbnailFileId: string | null;
  guestName: string | null;
  organizationName: string | null;
  durationSeconds: number | null;
  sourceFileId: string | null;
  sourceFileUrl: string | null;
  readiness: { ready: boolean; reasons: string[] };
  activePublication: SocialPublicationSummary | null;
  publishedPublication: SocialPublicationSummary | null;
  defaultPlaylistName: string | null;
};

export type SocialPublication = SocialPublicationSummary & {
  tenantId: string;
  accountId: string;
  sourceType: SourceType;
  clipId: string | null;
  projectId: string;
  contentFormat: ContentFormat;
  title: string | null;
  description: string;
  tags: string[];
  hashtags: string[];
  categoryId: string;
  categoryName: string;
  defaultLanguage: string;
  license: string;
  madeForKids: boolean;
  containsSyntheticMedia: boolean;
  embeddable: boolean;
  publicStatsViewable: boolean;
  notifySubscribers: boolean;
  thumbnailFileId: string | null;
  thumbnailUrl: string | null;
  thumbnailDelivery: { apiStatus: string; error: string | null; attemptedAt: string | null } | null;
  platformUploadStatus: string | null;
  platformProcessingStatus: string | null;
  approvedAt: string | null;
  uploadStartedAt: string | null;
  uploadedAt: string | null;
  publishedAt: string | null;
  attemptCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  playlists: { playlistId: string; displayName: string; isDefault: boolean }[];
  createdAt: string;
  updatedAt: string;
};

export type PublicationEvent = {
  id: number;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

export type ValidationResult = { ok: boolean; errors: string[]; warnings: string[] };

export type SocialSettings = {
  account: {
    id: string;
    displayName: string | null;
    externalAccountId: string;
    authStatus: string;
    lastVerifiedAt: string | null;
  };
  defaults: Record<string, unknown> | null;
  routing: { sourceType: string; sourceClipType: string | null; contentFormat: string; defaultPlaylistName: string | null }[];
  playlists: { id: string; canonicalKey: string; displayName: string; externalPlaylistId: string }[];
};

export type YouTubeConnectionStatus = {
  state: "configured" | "connected" | "needs_reauth" | "error" | "disabled";
  channelId: string | null;
  channelTitle: string | null;
  missingScopes: string[];
  reason: string | null;
};

export type LibraryFilters = {
  format?: "all" | "short" | "long_form" | "full_episode";
  search?: string;
  guest?: string;
  organization?: string;
  readiness?: "all" | "ready" | "not_ready";
  publicationState?: "all" | "unscheduled" | "scheduled" | "published" | "failed";
};

const INVOKE_TIMEOUT_MS = 15000;

/** Carries enough detail (action, HTTP status, server requestId) to render an actionable
 * error in the UI instead of a bare message, and to correlate against Edge Function logs. */
export class SocialMediaError extends Error {
  action: string;
  status: number | null;
  requestId: string | null;
  constructor(message: string, action: string, status: number | null, requestId: string | null) {
    super(message);
    this.name = "SocialMediaError";
    this.action = action;
    this.status = status;
    this.requestId = requestId;
  }
}

async function invoke<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("social-media-manager", {
    body: { action, ...body },
    timeout: INVOKE_TIMEOUT_MS,
  });

  if (error) {
    // FunctionsHttpError carries the raw Response in .context -- read the {error, action,
    // requestId} body social-media-manager actually returned, rather than collapsing to a
    // generic "Edge Function returned a non-2xx status code".
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const requestId = context.headers.get("x-request-id");
      let serverMessage: string | null = null;
      try {
        const payload = await context.clone().json();
        serverMessage = typeof payload?.error === "string" ? payload.error : null;
      } catch {
        // response body wasn't JSON -- fall through with just the status
      }
      throw new SocialMediaError(serverMessage ?? `HTTP ${context.status}`, action, context.status, requestId);
    }
    const isTimeout = error.name === "AbortError" || /abort/i.test(error.message);
    if (isTimeout) throw new SocialMediaError(`Request timed out after ${INVOKE_TIMEOUT_MS / 1000}s`, action, null, null);
    // FunctionsFetchError/FunctionsRelayError wrap the real underlying failure (often thrown
    // before the network call ever happens, e.g. inside supabase-js's own auth/session
    // resolution) in .context -- surface that instead of the generic wrapper message, which
    // is identical ("Failed to send a request to the Edge Function") no matter the real cause.
    const underlying = context as { name?: string; message?: string } | undefined;
    const detail = underlying?.message ? `${error.message}: [${underlying.name ?? "Error"}] ${underlying.message}` : error.message;
    throw new SocialMediaError(detail, action, null, null);
  }

  if (data && typeof data === "object" && "error" in data) {
    const payload = data as { error: string; requestId?: string };
    throw new SocialMediaError(payload.error, action, null, payload.requestId ?? null);
  }
  return (data as { data: T }).data;
}

export const fetchSocialMediaBootstrap = () =>
  invoke<{ auth: { userId: string; tenantId: string; crmRole: string; capabilities: Record<string, boolean> } }>("bootstrap");

export const fetchSocialMediaLibrary = (filters: LibraryFilters = {}) =>
  invoke<SocialMediaLibraryItem[]>("list_library", { filters });

export const fetchSocialPublications = (params: { status?: string; scheduledOnly?: boolean } = {}) =>
  invoke<SocialPublication[]>("list_publications", params);

export const fetchSocialPublication = (id: string) =>
  invoke<SocialPublication>("get_publication", { id });

export const fetchPublicationEvents = (id: string) =>
  invoke<PublicationEvent[]>("list_publication_events", { id });

export const fetchSocialMediaSettings = () => invoke<SocialSettings>("get_settings");

export type SocialThumbnail = { fileId: string | null; signedUrl: string | null; expiresInSeconds: number | null };

/** Asks the server for a short-lived signed URL to the cached copy of a private Drive cover
 * image. The source Drive file id is resolved server-side from the tenant's own record -- the
 * browser only names which library row it wants. */
export const fetchSocialThumbnailUrl = (sourceType: SourceType, sourceId: string) =>
  invoke<SocialThumbnail>("get_thumbnail_url", { sourceType, sourceId });

export const verifyYouTubeConnection = () => invoke<YouTubeConnectionStatus>("verify_youtube_connection");

export const createSocialPublication = (params: {
  sourceType: SourceType; clipId?: string; projectId?: string; deliveryMode?: DeliveryMode; scheduledFor?: string;
}) => invoke<SocialPublication>("create_publication", params);

export const updateSocialPublication = (id: string, changes: Record<string, unknown>) =>
  invoke<SocialPublication>("update_publication", { id, changes });

export const validateSocialPublication = (id: string) => invoke<ValidationResult>("validate_publication", { id });

export const approveSocialPublication = (id: string) => invoke<SocialPublication>("approve_publication", { id });

export const setPublicationPlaylists = (id: string, playlistIds: string[]) =>
  invoke<SocialPublication>("set_publication_playlists", { id, playlistIds });

export const queueSocialPublication = (id: string) =>
  invoke<{ jobId: number; publication: SocialPublication }>("queue_publish", { id });

export const rescheduleSocialPublication = (id: string, scheduledFor: string) =>
  invoke<SocialPublication>("reschedule_publication", { id, scheduledFor });

export const cancelSocialPublication = (id: string) => invoke<SocialPublication>("cancel_publication", { id });

export const retrySocialPublication = (id: string) =>
  invoke<{ jobId: number; publication: SocialPublication }>("retry_publication", { id });

export const STATUS_LABELS: Record<PublicationStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  approved: "Approved",
  upload_queued: "Upload Queued",
  uploading: "Uploading",
  uploaded: "Uploaded",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const CONTENT_FORMAT_LABELS: Record<ContentFormat, string> = {
  short: "Short",
  long_form: "Long Form",
  full_episode: "Full Episode",
};
