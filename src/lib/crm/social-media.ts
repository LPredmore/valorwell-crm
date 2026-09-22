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

async function invoke<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("social-media-manager", { body: { action, ...body } });
  if (error) throw new Error(error.message);
  if (data && typeof data === "object" && "error" in data) throw new Error(String((data as { error: string }).error));
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
