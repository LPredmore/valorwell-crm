import {
  createCanonicalEmailRenderHash,
  escapeHtml,
  parseCanonicalNewsletterEmailContent,
  prependHiddenPreheader,
  type CanonicalNewsletterEmailContent,
} from '../crm-resend-email/email-content.ts';

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

const ALLOWED_VARIABLES = new Set<StaffEmailVariableKey>([
  'staff_first_name',
  'staff_last_name',
  'staff_display_name',
  'staff_role',
  'sender_name',
]);
const TOKEN_PATTERN = /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g;

export async function prepareStaffBroadcastDelivery(input: {
  subjectTemplate: string;
  content: unknown;
  values: StaffEmailVariableValues;
}): Promise<PreparedStaffBroadcast> {
  const content = parseCanonicalNewsletterEmailContent(input.content);
  const expectedHash = await createCanonicalEmailRenderHash(content);
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

export function canonicalStaffContentFromLog(log: Record<string, unknown>): CanonicalNewsletterEmailContent {
  return parseCanonicalNewsletterEmailContent({
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
