import type { EmailContentDraft } from './document';

export async function createEmailRenderHash(draft: EmailContentDraft): Promise<string> {
  const serialized = stableSerialize({
    schemaVersion: draft.schemaVersion,
    mode: draft.mode,
    editorDocument: draft.editorDocument,
    renderedHtml: draft.renderedHtml,
    renderedText: draft.renderedText,
    preheader: draft.preheader,
    themeKey: draft.themeKey,
  });

  if (globalThis.crypto?.subtle) {
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
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`;
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
