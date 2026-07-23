export const EMAIL_CONTENT_MODES = ['direct', 'campaign', 'newsletter'] as const;
export type EmailContentMode = (typeof EMAIL_CONTENT_MODES)[number];

export const EMAIL_EDITOR_SCHEMA_VERSION = 1;

export type EmailEditorMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type EmailEditorNode = {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: EmailEditorMark[];
  content?: EmailEditorNode[];
};

export type EmailEditorDocument = EmailEditorNode & {
  type: 'doc';
  content: EmailEditorNode[];
};

export type EmailContentDraft = {
  schemaVersion: number;
  mode: EmailContentMode;
  editorDocument: EmailEditorDocument;
  renderedHtml: string;
  renderedText: string;
  preheader: string | null;
  themeKey: string;
};

export type EmailContentDocument = EmailContentDraft & {
  renderHash: string;
};

export type EmailValidationSeverity = 'error' | 'warning';

export type EmailValidationIssue = {
  code: string;
  message: string;
  severity: EmailValidationSeverity;
  path?: string;
  variableKey?: string;
};

export type EmailValidationResult = {
  valid: boolean;
  issues: EmailValidationIssue[];
  errors: EmailValidationIssue[];
  warnings: EmailValidationIssue[];
};

export type EmailTemplateVersionReference = {
  templateId: string;
  versionId: string;
  versionNumber: number;
  schemaVersion: number;
  renderHash: string;
  publishedAt?: string;
};

export const EMAIL_ASSET_KINDS = ['image', 'document'] as const;
export type EmailAssetKind = (typeof EMAIL_ASSET_KINDS)[number];

export type EmailAssetReference = {
  id: string;
  tenantId: string;
  kind: EmailAssetKind;
  storagePath: string;
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  altText?: string;
  createdBy: string;
  createdAt: string;
};

export function isEmailEditorDocument(value: unknown): value is EmailEditorDocument {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown; content?: unknown };
  return candidate.type === 'doc' && Array.isArray(candidate.content);
}

export function createEmailValidationResult(issues: EmailValidationIssue[]): EmailValidationResult {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings,
  };
}
