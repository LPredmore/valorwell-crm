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
  activePublication: SocialPublicationSummary | null;
  publishedPublication: SocialPublicationSummary | null;
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

export type ValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};
