import {
  EMAIL_EDITOR_SCHEMA_VERSION,
  type EmailContentDocument,
  type EmailContentDraft,
  type EmailContentMode,
  type EmailEditorDocument,
  type EmailEditorNode,
  type EmailValidationResult,
} from './document';
import { createEmailRenderHash } from './hash';
import { validateEmailContentDraft } from './validation';
import type { EmailContentScope } from './variables';

export type EmailEditorExportInput = {
  mode: EmailContentMode;
  editorDocument: EmailEditorDocument;
  html: string;
  text: string;
  preheader?: string | null;
  themeKey: string;
};

export type FinalizedEmailContentResult = {
  document?: EmailContentDocument;
  validation: EmailValidationResult;
};

export type LegacyHtmlEmailImportResult = {
  draft: EmailContentDraft;
  requiresManualReview: true;
  warnings: string[];
};

export function createEmailContentDraftFromEditorExport(input: EmailEditorExportInput): EmailContentDraft {
  return {
    schemaVersion: EMAIL_EDITOR_SCHEMA_VERSION,
    mode: input.mode,
    editorDocument: cloneEmailEditorDocument(input.editorDocument),
    renderedHtml: input.html.trim(),
    renderedText: input.text.trim(),
    preheader: normalizeNullableText(input.preheader),
    themeKey: input.themeKey.trim(),
  };
}

export async function finalizeEmailContentDocument(
  draft: EmailContentDraft,
  scope: EmailContentScope,
): Promise<FinalizedEmailContentResult> {
  const validation = validateEmailContentDraft(draft, scope);
  if (!validation.valid) return { validation };

  return {
    document: {
      ...draft,
      editorDocument: cloneEmailEditorDocument(draft.editorDocument),
      renderHash: await createEmailRenderHash(draft),
    },
    validation,
  };
}

export function importLegacyHtmlEmail(input: {
  mode: EmailContentMode;
  html: string;
  text?: string | null;
  preheader?: string | null;
  themeKey?: string;
}): LegacyHtmlEmailImportResult {
  const inferredText = input.text?.trim() || legacyHtmlToPlainText(input.html);
  const editorDocument = plainTextToEditorDocument(inferredText);

  return {
    draft: {
      schemaVersion: EMAIL_EDITOR_SCHEMA_VERSION,
      mode: input.mode,
      editorDocument,
      renderedHtml: input.html.trim(),
      renderedText: inferredText,
      preheader: normalizeNullableText(input.preheader),
      themeKey: input.themeKey?.trim() || 'legacy',
    },
    requiresManualReview: true,
    warnings: [
      'Legacy HTML is preserved only as an import candidate and must be reviewed before it becomes canonical editor content.',
      'The editor JSON contains a plain-text reconstruction; arbitrary source HTML is not trusted as editable structure.',
    ],
  };
}

export function cloneEmailEditorDocument(document: EmailEditorDocument): EmailEditorDocument {
  return JSON.parse(JSON.stringify(document)) as EmailEditorDocument;
}

export function legacyHtmlToPlainText(html: string): string {
  return decodeBasicHtmlEntities(
    html
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|h[1-6]|li)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '')
      .replace(/\r/g, '')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

function plainTextToEditorDocument(text: string): EmailEditorDocument {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map<EmailEditorNode>((value) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: value }],
    }));

  return {
    type: 'doc',
    content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph', content: [] }],
  };
}

function normalizeNullableText(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}
