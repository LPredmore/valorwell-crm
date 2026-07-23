import type {
  EmailContentDocument,
  EmailContentMode,
  EmailContentScope,
  EmailEditorDocument,
} from '../contracts';
import type { EmailStudioThemeKey } from '../studio/config';

export type EmailStudioTemplateStatus = 'draft' | 'published' | 'archived';

export type EmailStudioAccessContext = {
  profileId: string;
  tenantId: string;
  canRead: boolean;
  canManage: boolean;
};

export type EmailTemplateRecord = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  subject: string;
  scope: EmailContentScope;
  mode: EmailContentMode;
  editorDocument: EmailEditorDocument | null;
  renderedHtml: string;
  renderedText: string;
  preheader: string | null;
  themeKey: EmailStudioThemeKey;
  schemaVersion: number | null;
  renderHash: string | null;
  status: EmailStudioTemplateStatus;
  currentPublishedVersionId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type EmailTemplateVersionRecord = {
  id: string;
  tenantId: string;
  templateId: string;
  versionNumber: number;
  scope: EmailContentScope;
  mode: EmailContentMode;
  subject: string;
  editorDocument: EmailEditorDocument;
  renderedHtml: string;
  renderedText: string;
  preheader: string | null;
  themeKey: EmailStudioThemeKey;
  schemaVersion: number;
  renderHash: string;
  changeSummary: string | null;
  publishedByProfileId: string;
  publishedAt: string;
};

export type PublishedDirectEmailTemplate = {
  templateId: string;
  versionId: string;
  name: string;
  description: string | null;
  subject: string;
  versionNumber: number;
  content: EmailContentDocument;
  publishedAt: string;
};

export type EmailTemplateMetadata = {
  name: string;
  description: string;
  subject: string;
  scope: EmailContentScope;
};

export type SaveEmailTemplateDraftInput = EmailTemplateMetadata & {
  templateId?: string | null;
  content: EmailContentDocument;
};

export type PublishEmailTemplateResult = {
  templateId: string;
  versionId: string;
  versionNumber: number;
  renderHash: string;
  publishedAt: string;
};

export type EmailAssetRecord = {
  path: string;
  name: string;
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type EmailTemplateFilters = {
  search: string;
  status: EmailStudioTemplateStatus | 'all';
  scope: EmailContentScope | 'all';
};
