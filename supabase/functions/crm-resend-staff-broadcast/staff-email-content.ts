export type CanonicalStaffNewsletterContent = {
  schemaVersion: number;
  mode: 'newsletter';
  editorDocument: Record<string, unknown>;
  renderedHtml: string;
  renderedText: string;
  preheader: string | null;
  themeKey: string;
  renderHash: string;
};

export type StaffEmailVariableValues = Partial<Record<StaffEmailVariableKey, string>>;

export type PreparedStaffBroadcast = {
  subject: string;
  html: string;
  text: string;
  preheader: string | null;
  renderHash: string;
  schemaVersion: number;
  themeKey: string;
};

type StaffEmailVariableKey =
  | 'staff_first_name'
  | 'staff_last_name'
  | 'staff_display_name'
  | 'staff_role'
  | 'sender_name';

type EmailRenderHashAlgorithm = 'sha256' | 'fnv1a32';

const ALLOWED_VARIABLES = new Set<StaffEmailVariableKey>([
  'staff_first_name',
  'staff_last_name',
  'staff_display_name',
  'staff_role',
  'sender_name',
]);
const TOKEN_PATTERN = /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g;
const HASH_PATTERN = /^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$/;

export async function prepareStaffBroadcastDelivery(input: {
  subjectTemplate: string;
  content: unknown;
  values: StaffEmailVariableValues;
}): Promise<PreparedStaffBroadcast> {
  const content = parseCanonicalStaffNewsletterContent(input.content);
  const algorithm: EmailRenderHashAlgorithm = content.renderHash.startsWith('sha256:')
    ? 'sha256'
    : 'fnv1a32';
  const expectedHash = await createCanonicalStaffEmailRenderHash(content, algorithm);
  if (expectedHash !== content.renderHash) throw new Error('CANONICAL_RENDER_HASH_MISMATCH');

  validateStaffVariables([
    input.subjectTemplate,
    content.renderedHtml,
    content.renderedText,
    content.preheader ?? '',
  ], input.values);

  const subject = render(input.subjectTemplate, input.values, 'text');
  const html = render(content.renderedHtml, input.values, 'html');
  const text = render(content.renderedText, input.values, 'text');
  const preheader = content.preheader ? render(content.preheader, input.values, 'text') : null;
  if (!subject.trim()) throw new Error('EMAIL_SUBJECT_REQUIRED');
  if (!html.trim() || !text.trim()) throw new Error('CANONICAL_EMAIL_BODY_REQUIRED');

  return {
    subject,
    html: prependHiddenPreheader(html, preheader),
    text,
    preheader,
    renderHash: content.renderHash,
    schemaVersion: content.schemaVersion,
    themeKey: content.themeKey,
  };
}

export function canonicalStaffContentFromLog(log: Record<string, unknown>): CanonicalStaffNewsletterContent {
  return parseCanonicalStaffNewsletterContent({
    schemaVersion: Number(log.editor_schema_version),
    mode: 'newsletter',
    editorDocument: log.editor_document,
    renderedHtml: String(log.body_html ?? ''),
    renderedText: String(log.body_text ?? ''),
    preheader: log.preheader ?? null,
    themeKey: String(log.theme_key ?? ''),
    renderHash: String(log.render_hash ?? ''),
  });
}

export function parseCanonicalStaffNewsletterContent(value: unknown): CanonicalStaffNewsletterContent {
  if (!isRecord(value)) throw new Error('CANONICAL_CONTENT_REQUIRED');
  if (!Number.isInteger(value.schemaVersion) || Number(value.schemaVersion) < 1) {
    throw new Error('CANONICAL_SCHEMA_VERSION_INVALID');
  }
  if (value.mode !== 'newsletter') throw new Error('CANONICAL_MODE_MUST_BE_NEWSLETTER');
  if (!isRecord(value.editorDocument)
      || value.editorDocument.type !== 'doc'
      || !Array.isArray(value.editorDocument.content)) {
    throw new Error('CANONICAL_EDITOR_DOCUMENT_INVALID');
  }
  if (typeof value.renderedHtml !== 'string' || !value.renderedHtml.trim()) {
    throw new Error('CANONICAL_HTML_REQUIRED');
  }
  if (typeof value.renderedText !== 'string' || !value.renderedText.trim()) {
    throw new Error('CANONICAL_TEXT_REQUIRED');
  }
  if (value.preheader !== null && value.preheader !== undefined && typeof value.preheader !== 'string') {
    throw new Error('CANONICAL_PREHEADER_INVALID');
  }
  if (typeof value.themeKey !== 'string' || !value.themeKey.trim()) {
    throw new Error('CANONICAL_THEME_REQUIRED');
  }
  if (typeof value.renderHash !== 'string' || !HASH_PATTERN.test(value.renderHash)) {
    throw new Error('CANONICAL_RENDER_HASH_INVALID');
  }
  return {
    schemaVersion: Number(value.schemaVersion),
    mode: 'newsletter',
    editorDocument: value.editorDocument,
    renderedHtml: value.renderedHtml,
    renderedText: value.renderedText,
    preheader: typeof value.preheader === 'string' && value.preheader.trim() ? value.preheader.trim() : null,
    themeKey: value.themeKey.trim(),
    renderHash: value.renderHash,
  };
}

export async function createCanonicalStaffEmailRenderHash(
  content: Omit<CanonicalStaffNewsletterContent, 'renderHash'> | CanonicalStaffNewsletterContent,
  algorithm: EmailRenderHashAlgorithm = 'sha256',
): Promise<string> {
  const serialized = stableSerialize({
    schemaVersion: content.schemaVersion,
    mode: content.mode,
    editorDocument: content.editorDocument,
    renderedHtml: content.renderedHtml,
    renderedText: content.renderedText,
    preheader: content.preheader,
    themeKey: content.themeKey,
  });
  if (algorithm === 'sha256') {
    if (!globalThis.crypto?.subtle) throw new Error('CANONICAL_RENDER_HASH_UNSUPPORTED');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `sha256:${hex}`;
  }
  return `fnv1a32:${fnv1a32(serialized)}`;
}

export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
}

function validateStaffVariables(templates: readonly string[], values: StaffEmailVariableValues) {
  const unknown = new Set<string>();
  const missing = new Set<string>();
  for (const template of templates) {
    for (const match of template.matchAll(TOKEN_PATTERN)) {
      const rawKey = match[1];
      if (!ALLOWED_VARIABLES.has(rawKey as StaffEmailVariableKey)) {
        unknown.add(rawKey);
        continue;
      }
      const value = values[rawKey as StaffEmailVariableKey];
      if (value === undefined || !value.trim()) missing.add(rawKey);
    }
  }
  if (unknown.size) throw new Error(`UNKNOWN_EMAIL_VARIABLE:${Array.from(unknown).sort().join(',')}`);
  if (missing.size) throw new Error(`MISSING_EMAIL_VARIABLE:${Array.from(missing).sort().join(',')}`);
}

function render(template: string, values: StaffEmailVariableValues, format: 'html' | 'text'): string {
  return template.replace(TOKEN_PATTERN, (_token, rawKey: string) => {
    const value = values[rawKey as StaffEmailVariableKey] ?? '';
    return format === 'html' ? escapeHtml(value) : value;
  });
}

function prependHiddenPreheader(html: string, preheader: string | null): string {
  if (!preheader?.trim()) return html;
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}</div>${html}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
