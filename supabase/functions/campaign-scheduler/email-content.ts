export type ClientCampaignVariableKey =
  | "first_name"
  | "preferred_name"
  | "last_name"
  | "therapist_name"
  | "sender_name"
  | "unsubscribe_url"
  | "postal_address";

export type ClientCampaignVariableValues = Partial<Record<ClientCampaignVariableKey, string>>;

export type CampaignEmailStepContent = {
  subjectTemplate: string;
  renderedHtml: string;
  renderedText?: string | null;
  preheader?: string | null;
  contentMode?: string | null;
  editorDocument?: unknown;
  themeKey?: string | null;
  schemaVersion?: number | null;
  renderHash?: string | null;
  templateVersionId?: string | null;
};

export type PreparedCampaignEmail = {
  canonical: boolean;
  subject: string;
  html: string;
  text?: string;
  preheader: string | null;
  renderHash: string | null;
  templateVersionId: string | null;
  schemaVersion: number | null;
  themeKey: string | null;
};

const VARIABLE_KEYS = new Set<ClientCampaignVariableKey>([
  "first_name",
  "preferred_name",
  "last_name",
  "therapist_name",
  "sender_name",
  "unsubscribe_url",
  "postal_address",
]);
const URL_KEYS = new Set<ClientCampaignVariableKey>(["unsubscribe_url"]);
const TOKEN_PATTERN = /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g;
const HASH_PATTERN = /^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$/;

export async function prepareCampaignEmail(input: {
  step: CampaignEmailStepContent;
  values: ClientCampaignVariableValues;
}): Promise<PreparedCampaignEmail> {
  const { step, values } = input;
  const isCanonical = step.editorDocument !== null && step.editorDocument !== undefined;
  const templates = [
    step.subjectTemplate,
    step.renderedHtml,
    step.renderedText || "",
    step.preheader || "",
  ];
  validateVariables(templates, values);

  if (!isCanonical) {
    const subject = render(step.subjectTemplate || "Message from your care team", values, "text");
    const html = render(step.renderedHtml || "", values, "html");
    if (!html.trim()) throw new Error("EMAIL_BODY_REQUIRED");
    return {
      canonical: false,
      subject,
      html,
      preheader: null,
      renderHash: null,
      templateVersionId: null,
      schemaVersion: null,
      themeKey: null,
    };
  }

  if (step.contentMode !== "campaign") throw new Error("CANONICAL_MODE_MUST_BE_CAMPAIGN");
  if (!isEditorDocument(step.editorDocument)) throw new Error("CANONICAL_EDITOR_DOCUMENT_INVALID");
  if (!step.renderedHtml.trim() || !step.renderedText?.trim()) throw new Error("CANONICAL_EMAIL_BODY_REQUIRED");
  if (!step.themeKey?.trim()) throw new Error("CANONICAL_THEME_REQUIRED");
  if (!Number.isInteger(step.schemaVersion) || Number(step.schemaVersion) < 1) {
    throw new Error("CANONICAL_SCHEMA_VERSION_INVALID");
  }
  if (!step.renderHash || !HASH_PATTERN.test(step.renderHash)) throw new Error("CANONICAL_RENDER_HASH_INVALID");

  const expectedHash = await createCanonicalCampaignRenderHash({
    schemaVersion: Number(step.schemaVersion),
    mode: "campaign",
    editorDocument: step.editorDocument,
    renderedHtml: step.renderedHtml,
    renderedText: step.renderedText,
    preheader: normalizeNullable(step.preheader),
    themeKey: step.themeKey,
  });
  if (expectedHash !== step.renderHash) throw new Error("CANONICAL_RENDER_HASH_MISMATCH");

  const subject = render(step.subjectTemplate, values, "text");
  const html = render(step.renderedHtml, values, "html");
  const text = render(step.renderedText, values, "text");
  const preheader = step.preheader ? render(step.preheader, values, "text") : null;
  if (!subject.trim()) throw new Error("EMAIL_SUBJECT_REQUIRED");

  return {
    canonical: true,
    subject,
    html: prependHiddenPreheader(html, preheader),
    text,
    preheader,
    renderHash: step.renderHash,
    templateVersionId: step.templateVersionId || null,
    schemaVersion: Number(step.schemaVersion),
    themeKey: step.themeKey,
  };
}

export function appendSignature(
  prepared: PreparedCampaignEmail,
  signature: { bodyHtml?: string | null; bodyText?: string | null; imageUrl?: string | null },
): PreparedCampaignEmail {
  const html = signature.imageUrl
    ? `${prepared.html}<br><br><img src="${escapeAttribute(signature.imageUrl)}" alt="Signature">`
    : signature.bodyHtml
      ? `${prepared.html}<br><br>${signature.bodyHtml}`
      : prepared.html;
  const text = prepared.text && signature.bodyText?.trim()
    ? `${prepared.text}\n\n${signature.bodyText.trim()}`
    : prepared.text;
  return { ...prepared, html, text };
}

export function buildCampaignResendContent(prepared: PreparedCampaignEmail) {
  return {
    subject: prepared.subject,
    html: prepared.html,
    ...(prepared.text ? { text: prepared.text } : {}),
  };
}

export async function createCanonicalCampaignRenderHash(content: {
  schemaVersion: number;
  mode: "campaign";
  editorDocument: unknown;
  renderedHtml: string;
  renderedText: string;
  preheader: string | null;
  themeKey: string;
}): Promise<string> {
  const serialized = stableSerialize(content);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `sha256:${hex}`;
  }
  return `fnv1a32:${fnv1a32(serialized)}`;
}

export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}

function validateVariables(templates: readonly string[], values: ClientCampaignVariableValues) {
  const unknown = new Set<string>();
  const missing = new Set<string>();
  const invalid = new Set<string>();
  for (const template of templates) {
    for (const match of template.matchAll(TOKEN_PATTERN)) {
      const rawKey = match[1];
      const key = rawKey as ClientCampaignVariableKey;
      if (!VARIABLE_KEYS.has(key)) {
        unknown.add(rawKey);
        continue;
      }
      const value = values[key];
      if (value === undefined || !value.trim()) {
        missing.add(key);
        continue;
      }
      if (URL_KEYS.has(key) && !isSafeUrl(value)) invalid.add(key);
    }
  }
  if (unknown.size) throw new Error(`UNKNOWN_EMAIL_VARIABLE:${Array.from(unknown).sort().join(",")}`);
  if (missing.size) throw new Error(`MISSING_EMAIL_VARIABLE:${Array.from(missing).sort().join(",")}`);
  if (invalid.size) throw new Error(`INVALID_EMAIL_VARIABLE:${Array.from(invalid).sort().join(",")}`);
}

function render(template: string, values: ClientCampaignVariableValues, format: "html" | "text") {
  return template.replace(TOKEN_PATTERN, (_token, rawKey: string) => {
    const value = values[rawKey as ClientCampaignVariableKey] || "";
    return format === "html" ? escapeHtml(value) : value;
  });
}

function prependHiddenPreheader(html: string, preheader: string | null) {
  if (!preheader?.trim()) return html;
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}</div>${html}`;
}

function normalizeNullable(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isEditorDocument(value: unknown): value is Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.type === "doc" && Array.isArray(record.content);
}

function isSafeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
