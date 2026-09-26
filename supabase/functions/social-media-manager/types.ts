export type ContentFormat = "short" | "long_form" | "full_episode";
export type SourceType = "clip" | "project";
export type PublicationStatus =
  | "draft" | "ready" | "approved" | "upload_queued" | "uploading"
  | "uploaded" | "scheduled" | "published" | "failed" | "cancelled";
export type PrivacyStatus = "public" | "unlisted" | "private";
export type DeliveryMode = "immediate" | "scheduled";

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
  readiness: {
    ready: boolean;
    reasons: string[];
  };
  /** The publication holding the source's single active slot (draft through scheduled). */
  activePublication: SocialPublicationSummary | null;
  /** The most recent Published publication, if any. */
  publishedPublication: SocialPublicationSummary | null;
  /** The latest publication when it Failed (and so can be retried). */
  failedPublication: SocialPublicationSummary | null;
  /** The most recent publication of any status. */
  latestPublication: SocialPublicationSummary | null;
  /** Resolved from ai_operations_social_routing_rules for the default account. */
  defaultPlaylistName: string | null;
};

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
  youtubeVerification: {
    state: string;
    privacyStatus: string | null;
    uploadStatus: string | null;
    processingStatus: string | null;
    rejectionReason?: string | null;
    failureReason?: string | null;
    checkedAt: string;
    reason?: string | null;
  } | null;
  youtubeSchedule: {
    apiStatus: string;
    expectedPublishAt: string | null;
    youtubePublishAt: string | null;
    privacyStatus: string | null;
    checkedAt: string;
    reason?: string | null;
  } | null;
  reconciliation: {
    state: "healthy" | "waiting" | "exception" | "published";
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
  /** Present on get_publication only. */
  source?: PublicationSource;
};

export type PublicationSource = {
  guestName: string | null;
  organizationName: string | null;
  durationSeconds: number | null;
  sourceFileId: string | null;
  sourceFileName: string | null;
  clipType: string | null;
  clipStatus: string | null;
  /** The rendered clip / source episode exists in Drive. */
  mediaReady: boolean;
  /** Shorts only: the current Drive file has a verified 1080x1920 render. */
  renderVerified: boolean | null;
};

export type ValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};
