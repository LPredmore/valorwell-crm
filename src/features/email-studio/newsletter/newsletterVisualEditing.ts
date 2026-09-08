import type { Editor } from '@tiptap/react';
import {
  EMAIL_STUDIO_BLOCK_KINDS,
  type EmailStudioBlockKind,
} from '../studio/config';

export type NewsletterBlockPatch = Partial<Pick<
  NewsletterSelectedBlock,
  'title' | 'body' | 'href' | 'imageUrl' | 'altText'
>>;

export type NewsletterSelectedBlock = {
  kind: EmailStudioBlockKind;
  title: string;
  body: string;
  href: string;
  imageUrl: string;
  altText: string;
  locked: boolean;
  from: number;
  to: number;
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
};

const BLOCK_NODE_NAME = 'emailStudioBlock';

const IMAGE_BLOCK_KINDS: readonly EmailStudioBlockKind[] = [
  'hero',
  'story',
  'resource',
  'video',
  'clinician-spotlight',
  'bty',
  'ocs-resource',
];

const LINK_BLOCK_KINDS: readonly EmailStudioBlockKind[] = [
  'cta',
  'resource',
  'video',
  'bty',
  'ocs-resource',
  'social-footer',
];

export function newsletterBlockSupportsImage(kind: EmailStudioBlockKind): boolean {
  return IMAGE_BLOCK_KINDS.includes(kind);
}

export function newsletterBlockSupportsLink(kind: EmailStudioBlockKind): boolean {
  return LINK_BLOCK_KINDS.includes(kind);
}

type BlockNode = {
  type: { name: string };
  attrs: Record<string, unknown>;
  nodeSize: number;
};

/**
 * Structured blocks are NOT always top-level children of the document: the
 * email editor wraps authored content in a `container` node. Every lookup here
 * is therefore depth-agnostic and walks the whole document instead of assuming
 * `doc.child(i)`.
 */
function collectBlockPositions(editor: Editor | null): number[] {
  if (!editor) return [];
  const positions: number[] = [];
  editor.state.doc.descendants((node: BlockNode, pos: number) => {
    if (node.type.name === BLOCK_NODE_NAME) {
      positions.push(pos);
      return false;
    }
    return true;
  });
  return positions;
}

function normalizeKind(raw: unknown): EmailStudioBlockKind {
  const value = String(raw || 'text');
  return (EMAIL_STUDIO_BLOCK_KINDS as readonly string[]).includes(value)
    ? value as EmailStudioBlockKind
    : 'text';
}

function describeBlock(editor: Editor, position: number, node: BlockNode): NewsletterSelectedBlock {
  const locked = Boolean(node.attrs.locked);
  const resolved = editor.state.doc.resolve(position);
  const index = resolved.index();
  const siblingCount = resolved.parent.childCount;

  return {
    kind: normalizeKind(node.attrs.kind),
    title: String(node.attrs.title || ''),
    body: String(node.attrs.body || ''),
    href: String(node.attrs.href || ''),
    imageUrl: String(node.attrs.imageUrl || ''),
    altText: String(node.attrs.altText || ''),
    locked,
    from: position,
    to: position + node.nodeSize,
    index,
    canMoveUp: !locked && index > 0,
    canMoveDown: !locked && index < siblingCount - 1,
  };
}

function blockAt(editor: Editor | null, position: number): BlockNode | null {
  if (!editor || position < 0) return null;
  const node = editor.state.doc.nodeAt(position) as BlockNode | null;
  if (!node || node.type.name !== BLOCK_NODE_NAME) return null;
  return node;
}

export function getSelectedNewsletterBlock(editor: Editor | null): NewsletterSelectedBlock | null {
  if (!editor) return null;
  const selection = editor.state.selection as { from: number; node?: BlockNode };
  const node = selection.node;
  if (!node || node.type.name !== BLOCK_NODE_NAME) return null;
  return describeBlock(editor, selection.from, node);
}

export function updateSelectedNewsletterBlock(editor: Editor | null, patch: NewsletterBlockPatch): boolean {
  const selected = getSelectedNewsletterBlock(editor);
  if (!editor || !selected) return false;
  return updateNewsletterBlockAtPosition(editor, selected.from, patch);
}

/**
 * Reads the structured block stored at an absolute document position, so the
 * inspector keeps working after the editor loses focus or selection moves.
 */
export function getNewsletterBlockAtPosition(
  editor: Editor | null,
  position: number,
): NewsletterSelectedBlock | null {
  const node = blockAt(editor, position);
  if (!editor || !node) return null;
  return describeBlock(editor, position, node);
}

/**
 * Updates block attributes at a stored position without requiring the editor to
 * hold the selection or focus (inspector inputs keep focus while typing).
 */
export function updateNewsletterBlockAtPosition(
  editor: Editor | null,
  position: number,
  patch: NewsletterBlockPatch,
): boolean {
  const node = blockAt(editor, position);
  if (!editor || !node || node.attrs.locked) return false;
  const transaction = editor.state.tr.setNodeMarkup(position, undefined, {
    ...node.attrs,
    ...patch,
  });
  editor.view.dispatch(transaction);
  return true;
}

/**
 * Maps a clicked DOM element (anywhere inside a block, including descendants)
 * to the owning structured block position and selects it.
 */
export function selectNewsletterBlockFromDom(editor: Editor | null, target: EventTarget | null): boolean {
  const position = findNewsletterBlockPositionFromDom(editor, target);
  if (editor === null || position === null) return false;
  return editor.commands.setNodeSelection(position);
}

export function findNewsletterBlockPositionFromDom(
  editor: Editor | null,
  target: EventTarget | null,
): number | null {
  if (!editor || !(target instanceof Element)) return null;
  const element = target.closest('[data-email-studio-block]');
  if (!element) return null;

  for (const pos of collectBlockPositions(editor)) {
    const dom = editor.view.nodeDOM(pos);
    if (!(dom instanceof Element)) continue;
    if (dom === element || dom.contains(element) || element.contains(dom)) return pos;
  }

  // Fall back to ProseMirror's own DOM mapping when the rendered wrapper is not
  // the node DOM itself.
  try {
    const mapped = editor.view.posAtDOM(element, 0);
    if (typeof mapped === 'number' && mapped >= 0) {
      if (blockAt(editor, mapped)) return mapped;
      const before = mapped - 1;
      if (blockAt(editor, before)) return before;
      const resolved = editor.state.doc.resolve(Math.max(0, mapped));
      for (let depth = resolved.depth; depth > 0; depth -= 1) {
        const candidate = resolved.before(depth);
        if (blockAt(editor, candidate)) return candidate;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function duplicateSelectedNewsletterBlock(editor: Editor | null): boolean {
  if (!editor) return false;
  const selected = getSelectedNewsletterBlock(editor);
  const node = blockAt(editor, selected?.from ?? -1);
  if (!selected || !node || selected.locked) return false;

  const insertAt = selected.to;
  editor.view.dispatch(editor.state.tr.insert(insertAt, node as never));
  return editor.commands.setNodeSelection(insertAt);
}

export function deleteSelectedNewsletterBlock(editor: Editor | null): boolean {
  const selected = getSelectedNewsletterBlock(editor);
  if (!editor || !selected || selected.locked) return false;
  return editor.chain().focus().deleteSelection().run();
}

export function moveSelectedNewsletterBlock(editor: Editor | null, direction: 'up' | 'down'): boolean {
  if (!editor) return false;
  const selected = getSelectedNewsletterBlock(editor);
  const node = blockAt(editor, selected?.from ?? -1);
  if (!selected || !node || selected.locked) return false;
  if (direction === 'up' && !selected.canMoveUp) return false;
  if (direction === 'down' && !selected.canMoveDown) return false;

  const resolved = editor.state.doc.resolve(selected.from);
  const sibling = resolved.parent.child(selected.index + (direction === 'up' ? -1 : 1));
  const targetPosition = direction === 'up'
    ? selected.from - sibling.nodeSize
    : selected.from + sibling.nodeSize;

  const transaction = editor.state.tr
    .delete(selected.from, selected.to)
    .insert(targetPosition, node as never);
  editor.view.dispatch(transaction);
  return editor.commands.setNodeSelection(targetPosition);
}
