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
  thumbnailStatus: string | null;
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
  /** Holds the source's single active slot (draft through scheduled). */
  activePublication: SocialPublicationSummary | null;
  publishedPublication: SocialPublicationSummary | null;
  /** The latest publication, when it failed (retryable). */
  failedPublication: SocialPublicationSummary | null;
  latestPublication: SocialPublicationSummary | null;
  /** From the database routing rules; null when no rule routes this format. */
  defaultPlaylistName: string | null;
};

export type PublicationSource = {
  guestName: string | null;
  organizationName: string | null;
  durationSeconds: number | null;
  sourceFileId: string | null;
  sourceFileName: string | null;
  clipType: string | null;
  clipStatus: string | null;
  mediaReady: boolean;
  renderVerified: boolean | null;
};

export type YouTubeDeliveryEvidence = {
  state: string;
  privacyStatus: string | null;
  uploadStatus: string | null;
  processingStatus: string | null;
  rejectionReason?: string | null;
  failureReason?: string | null;
  checkedAt: string;
  reason?: string | null;
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
  thumbnailDelivery: {
    apiStatus: string;
    error?: string | null;
    attemptedAt?: string | null;
    manualRequired?: boolean;
    manualConfirmedAt?: string | null;
    fileId?: string | null;
    studioUrl?: string | null;
  } | null;
  youtubeVerification: YouTubeDeliveryEvidence | null;
  youtubeSchedule: {
    apiStatus: string;
    expectedPublishAt: string | null;
    youtubePublishAt: string | null;
    privacyStatus: string | null;
    checkedAt: string;
    reason?: string | null;
  } | null;
  reconciliation: {
    state: 'healthy' | 'waiting' | 'exception' | 'published';
    code?: string | null;
    reason?: string | null;
    checkedAt: string;
    privacyStatus?: string | null;
    publishAt?: string | null;
  } | null;
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
  /** Returned by get_publication only. */
  source?: PublicationSource;
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

export type PreferredScheduleTimes = {
  short: string[];
  longForm: string[];
};

export type BulkScheduleSource = {
  sourceType: SourceType;
  sourceId: string;
};

export type BulkScheduleAssignment = BulkScheduleSource & {
  contentFormat: ContentFormat;
  title: string;
  scheduledFor: string;
  localDate: string;
  localTime: string;
};

export type BulkSchedulePreview = {
  timezone: string;
  preferredScheduleTimes: PreferredScheduleTimes;
  selectedCount: number;
  availableSlotCount: number;
  assignments: BulkScheduleAssignment[];
  unassigned: Array<BulkScheduleSource & { title: string; contentFormat: ContentFormat }>;
};

export type BulkScheduleResult = BulkSchedulePreview & {
  scheduled: Array<BulkScheduleSource & {
    title: string;
    publicationId: string;
    jobId: number;
    scheduledFor: string;
  }>;
};

export type SocialSettings = {
  account: {
    id: string;
    displayName: string | null;
    externalAccountId: string;
    authStatus: string;
    lastVerifiedAt: string | null;
  };
  defaults: Record<string, unknown> | null;
  timezone: string;
  preferredScheduleTimes: PreferredScheduleTimes;
  routing: { sourceType: string; sourceClipType: string | null; contentFormat: string; defaultPlaylistName: string | null }[];
  playlists: { id: string; canonicalKey: string; displayName: string; externalPlaylistId: string }[];
};

export type YouTubeConnectionStatus = {
  state: "configured" | "connected" | "needs_reauth" | "error" | "disabled";
  channelId: string | null;
  channelTitle: string | null;
  missingScopes: string[];
  reason: string | null;
  /** Set on the read-only status (the last recorded verification). */
  lastVerifiedAt?: string | null;
  source?: "recorded";
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

async function invoke<T>(action: string, body: Record<string, unknown> = {}, timeoutMs = INVOKE_TIMEOUT_MS): Promise<T> {
  const { data, error } = await supabase.functions.invoke("social-media-manager", {
    body: { action, ...body },
    timeout: timeoutMs,
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
    if (isTimeout) throw new SocialMediaError(`Request timed out after ${timeoutMs / 1000}s`, action, null, null);
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

export type ThumbnailReplaceResult = {
  fileId: string;
  thumbnailUrl: string;
  youtubeQueued: number;
  warnings: string[];
  message: string;
};

/** Upload the selected local artwork through the authenticated CRM Edge Function.
 * Unlike a raw Drive link, this copies the exact selected image into our existing
 * YouTube Cover Images folder, then updates the tenant-scoped video and publications.
 */
export async function replaceSocialLibraryPhoto(params: {
  sourceType: SourceType;
  sourceId: string;
  file: File;
  updateYouTube: boolean;
  publishedPublicationId?: string;
}): Promise<ThumbnailReplaceResult> {
  const form = new FormData();
  form.set('action', 'replace_thumbnail');
  form.set('sourceType', params.sourceType);
  form.set('sourceId', params.sourceId);
  form.set('updateYouTube', String(params.updateYouTube));
  if (params.publishedPublicationId) form.set('publishedPublicationId', params.publishedPublicationId);
  form.set('file', params.file, params.file.name);

  const { data, error } = await supabase.functions.invoke('social-media-manager', {
    body: form,
    timeout: 90000,
  });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      let detail: string | null = null;
      try {
        const payload = await context.clone().json();
        detail = typeof payload?.error === 'string' ? payload.error : null;
      } catch {
        // Use status when the gateway returns a non-JSON failure.
      }
      throw new SocialMediaError(
        detail ?? 'Photo upload failed (HTTP ' + context.status + ')',
        'replace_thumbnail',
        context.status,
        context.headers.get('x-request-id'),
      );
    }
    const underlying = context as { message?: string } | undefined;
    throw new SocialMediaError(underlying?.message ?? error.message, 'replace_thumbnail', null, null);
  }
  if (data && typeof data === 'object' && 'error' in data) {
    const payload = data as { error: string; requestId?: string };
    throw new SocialMediaError(payload.error, 'replace_thumbnail', null, payload.requestId ?? null);
  }
  return (data as { data: ThumbnailReplaceResult }).data;
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

export const previewBulkSocialSchedule = (items: BulkScheduleSource[], dates: string[]) =>
  invoke<BulkSchedulePreview>("preview_bulk_schedule", { items, dates }, 30000);

export const bulkScheduleSocialPublications = (items: BulkScheduleSource[], dates: string[]) =>
  invoke<BulkScheduleResult>("bulk_schedule", { items, dates }, 75000);

export type SocialThumbnail = { fileId: string | null; signedUrl: string | null; expiresInSeconds: number | null };

/** Asks the server for a short-lived signed URL to the cached copy of a private Drive cover
 * image. The source Drive file id is resolved server-side from the tenant's own record -- the
 * browser only names which library row it wants. */
export const fetchSocialThumbnailUrl = (sourceType: SourceType, sourceId: string) =>
  invoke<SocialThumbnail>("get_thumbnail_url", { sourceType, sourceId });

/** Read-only: the state recorded by the last verification. Never calls Google or writes. */
export const fetchYouTubeConnectionStatus = () => invoke<YouTubeConnectionStatus>("get_youtube_connection_status");

/** Mutation (operators only): verifies against Google and records the result. */
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

/** Before upload: CRM-only. After upload: changes YouTube's publishAt first, then the CRM. */
export const rescheduleSocialPublication = (id: string, scheduledFor: string) =>
  invoke<SocialPublication>("reschedule_publication", { id, scheduledFor });

export const cancelSocialPublication = (id: string) => invoke<SocialPublication>("cancel_publication", { id });

export const retrySocialPublication = (id: string) =>
  invoke<{ jobId: number; publication: SocialPublication }>("retry_publication", { id });

export const markThumbnailManualDone = (id: string) =>
  invoke<SocialPublication>("mark_thumbnail_manual_done", { id });

export const STATUS_LABELS: Record<PublicationStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  approved: "Approved",
  upload_queued: "Upload Queued",
  uploading: "Uploading",
  uploaded: "Uploaded (Private)",
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

export const PRIVACY_LABELS: Record<PrivacyStatus, string> = {
  public: "Public",
  unlisted: "Unlisted",
  private: "Private",
};

/** The publication a Library card represents and opens: in-flight work first, then a
 * retryable failure, then the published record. */
export function primaryPublication(item: SocialMediaLibraryItem): SocialPublicationSummary | null {
  return item.activePublication ?? item.failedPublication ?? item.publishedPublication ?? null;
}

const ACTIVE_WORK_STATUSES = new Set<PublicationStatus>(["upload_queued", "uploading"]);
const RECONCILE_WINDOW_MS = 30 * 60 * 1000;

/**
 * How often a view of these publications should refresh. Only unstable work is polled:
 * uploads in flight (15s), and Scheduled videos whose publish time is near or past, while
 * YouTube reconciliation is expected to change them (60s). Stable states rely on normal
 * query invalidation after mutations.
 */
export function publicationPollInterval(
  publications: Array<Pick<SocialPublicationSummary, "status" | "scheduledFor">> | undefined,
  nowMs = Date.now(),
): number | false {
  if (!publications?.length) return false;
  if (publications.some((pub) => ACTIVE_WORK_STATUSES.has(pub.status))) return 15_000;
  const reconciling = publications.some((pub) => pub.status === "scheduled" && pub.scheduledFor &&
    Date.parse(pub.scheduledFor) - nowMs < RECONCILE_WINDOW_MS);
  return reconciling ? 60_000 : false;
}
