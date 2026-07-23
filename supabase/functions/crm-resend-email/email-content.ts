export type CanonicalDirectEmailContent = {
  schemaVersion: number;
  mode: "direct";
  editorDocument: Record<string, unknown>;
  renderedHtml: string;
  renderedText: string;
  preheader: string | null;
  themeKey: string;
  renderHash: string;
};

export type DirectEmailVariableValues = Partial<Record<DirectEmailVariableKey, string>>;

export type PreparedDirectEmail = {
  subject: string;
  html: string;
  text: string;
  preheader: string | null;
  renderHash: string;
  schemaVersion: number;
  themeKey: string;
};

type DirectEmailVariableKey =
  | "first_name"
  | "preferred_name"
  | "last_name"
  | "therapist_name"
  | "sender_name"
  | "unsubscribe_url"
  | "postal_address";

type VariableDefinition = {
  key: DirectEmailVariableKey;
  valueType: "text" | "url";
};

const VARIABLES: readonly VariableDefinition[] = [
  { key: "first_name", valueType: "text" },
  { key: "preferred_name", valueType: "text" },
  { key: "last_name", valueType: "text" },
  { key: "therapist_name", valueType: "text" },
  { key: "sender_name", valueType: "text" },
  { key: "unsubscribe_url", valueType: "url" },
  { key: "postal_address", valueType: "text" },
];

const VARIABLE_BY_KEY = new Map(VARIABLES.map((definition) => [definition.key, definition]));
const TOKEN_PATTERN = /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g;
const HASH_PATTERN = /^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$/;

export async function prepareDirectEmailDelivery(input: {
  subjectTemplate: string;
  content: unknown;
  values: DirectEmailVariableValues;
}): Promise<PreparedDirectEmail> {
  const content = parseCanonicalDirectEmailContent(input.content);
  const expectedHash = await createCanonicalEmailRenderHash(content);
  if (expectedHash !== content.renderHash) {
    throw new Error("CANONICAL_RENDER_HASH_MISMATCH");
  }

  const subject = renderTemplate(input.subjectTemplate, input.values, "text");
  const html = renderTemplate(content.renderedHtml, input.values, "html");
  const text = renderTemplate(content.renderedText, input.values, "text");
  const preheader = content.preheader
    ? renderTemplate(content.preheader, input.values, "text")
    : null;

  if (!subject.trim()) throw new Error("EMAIL_SUBJECT_REQUIRED");
  if (!html.trim() || !text.trim()) throw new Error("CANONICAL_EMAIL_BODY_REQUIRED");

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

export function parseCanonicalDirectEmailContent(value: unknown): CanonicalDirectEmailContent {
  if (!isRecord(value)) throw new Error("CANONICAL_CONTENT_REQUIRED");
  if (!Number.isInteger(value.schemaVersion) || Number(value.schemaVersion) < 1) {
    throw new Error("CANONICAL_SCHEMA_VERSION_INVALID");
  }
  if (value.mode !== "direct") throw new Error("CANONICAL_MODE_MUST_BE_DIRECT");
  if (!isRecord(value.editorDocument)
      || value.editorDocument.type !== "doc"
      || !Array.isArray(value.editorDocument.content)) {
    throw new Error("CANONICAL_EDITOR_DOCUMENT_INVALID");
  }
  if (typeof value.renderedHtml !== "string" || !value.renderedHtml.trim()) {
    throw new Error("CANONICAL_HTML_REQUIRED");
  }
  if (typeof value.renderedText !== "string" || !value.renderedText.trim()) {
    throw new Error("CANONICAL_TEXT_REQUIRED");
  }
  if (value.preheader !== null && value.preheader !== undefined && typeof value.preheader !== "string") {
    throw new Error("CANONICAL_PREHEADER_INVALID");
  }
  if (typeof value.themeKey !== "string" || !value.themeKey.trim()) {
    throw new Error("CANONICAL_THEME_REQUIRED");
  }
  if (typeof value.renderHash !== "string" || !HASH_PATTERN.test(value.renderHash)) {
    throw new Error("CANONICAL_RENDER_HASH_INVALID");
  }

  return {
    schemaVersion: Number(value.schemaVersion),
    mode: "direct",
    editorDocument: value.editorDocument,
    renderedHtml: value.renderedHtml,
    renderedText: value.renderedText,
    preheader: typeof value.preheader === "string" && value.preheader.trim()
      ? value.preheader.trim()
      : null,
    themeKey: value.themeKey.trim(),
    renderHash: value.renderHash,
  };
}

export async function createCanonicalEmailRenderHash(
  content: Omit<CanonicalDirectEmailContent, "renderHash"> | CanonicalDirectEmailContent,
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

  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(serialized),
    );
    const hex = Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    return `sha256:${hex}`;
  }

  return `fnv1a32:${fnv1a32(serialized)}`;
}

export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

export function renderTemplate(
  template: string,
  values: DirectEmailVariableValues,
  outputFormat: "html" | "text",
): string {
  const unknown = new Set<string>();
  const missing = new Set<string>();
  const invalid = new Set<string>();

  const output = template.replace(TOKEN_PATTERN, (token, rawKey: string) => {
    const key = rawKey as DirectEmailVariableKey;
    const definition = VARIABLE_BY_KEY.get(key);
    if (!definition) {
      unknown.add(rawKey);
      return token;
    }

    const value = values[key];
    if (value === undefined || !value.trim()) {
      missing.add(key);
      return token;
    }
    if (definition.valueType === "url" && !isSafeUrl(value)) {
      invalid.add(key);
      return token;
    }
    return outputFormat === "html" ? escapeHtml(value) : value;
  });

  if (unknown.size) throw new Error(`UNKNOWN_EMAIL_VARIABLE:${Array.from(unknown).sort().join(",")}`);
  if (missing.size) throw new Error(`MISSING_EMAIL_VARIABLE:${Array.from(missing).sort().join(",")}`);
  if (invalid.size) throw new Error(`INVALID_EMAIL_VARIABLE:${Array.from(invalid).sort().join(",")}`);
  return output;
}

export function prependHiddenPreheader(html: string, preheader: string | null): string {
  if (!preheader?.trim()) return html;
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}</div>${html}`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
