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

export function getSelectedNewsletterBlock(editor: Editor | null): NewsletterSelectedBlock | null {
  if (!editor) return null;
  const selected = getSelectedBlockNode(editor);
  if (!selected) return null;

  const { selection, node } = selected;
  if (selection.$from.depth !== 0) return null;

  const rawKind = String(node.attrs.kind || 'text');
  const kind = (EMAIL_STUDIO_BLOCK_KINDS as readonly string[]).includes(rawKind)
    ? rawKind as EmailStudioBlockKind
    : 'text';
  const index = selection.$from.index(0);
  const locked = Boolean(node.attrs.locked);

  return {
    kind,
    title: String(node.attrs.title || ''),
    body: String(node.attrs.body || ''),
    href: String(node.attrs.href || ''),
    imageUrl: String(node.attrs.imageUrl || ''),
    altText: String(node.attrs.altText || ''),
    locked,
    from: selection.from,
    to: selection.to,
    index,
    canMoveUp: !locked && index > 0,
    canMoveDown: !locked && index < editor.state.doc.childCount - 1,
  };
}

export function updateSelectedNewsletterBlock(editor: Editor | null, patch: NewsletterBlockPatch): boolean {
  const selected = getSelectedNewsletterBlock(editor);
  if (!editor || !selected || selected.locked) return false;
  return editor.chain().focus().updateAttributes('emailStudioBlock', patch).run();
}

/**
 * Reads the structured block stored at an absolute document position, so the
 * inspector keeps working after the editor loses focus or selection moves.
 */
export function getNewsletterBlockAtPosition(
  editor: Editor | null,
  position: number,
): NewsletterSelectedBlock | null {
  if (!editor) return null;
  const doc = editor.state.doc;
  let pos = 0;
  for (let index = 0; index < doc.childCount; index += 1) {
    const child = doc.child(index);
    if (pos === position) {
      if (child.type.name !== 'emailStudioBlock') return null;
      const rawKind = String(child.attrs.kind || 'text');
      const kind = (EMAIL_STUDIO_BLOCK_KINDS as readonly string[]).includes(rawKind)
        ? rawKind as EmailStudioBlockKind
        : 'text';
      const locked = Boolean(child.attrs.locked);
      return {
        kind,
        title: String(child.attrs.title || ''),
        body: String(child.attrs.body || ''),
        href: String(child.attrs.href || ''),
        imageUrl: String(child.attrs.imageUrl || ''),
        altText: String(child.attrs.altText || ''),
        locked,
        from: pos,
        to: pos + child.nodeSize,
        index,
        canMoveUp: !locked && index > 0,
        canMoveDown: !locked && index < doc.childCount - 1,
      };
    }
    pos += child.nodeSize;
  }
  return null;
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
  const block = getNewsletterBlockAtPosition(editor, position);
  if (!editor || !block || block.locked) return false;
  const node = editor.state.doc.nodeAt(position);
  if (!node || node.type.name !== 'emailStudioBlock') return false;
  const transaction = editor.state.tr.setNodeMarkup(position, undefined, {
    ...node.attrs,
    ...patch,
  });
  editor.view.dispatch(transaction);
  return true;
}

/**
 * Resolves a clicked rendered block to its top-level ProseMirror document
 * position. React Email may wrap custom nodes, so selection cannot depend on
 * nodeDOM(position) being exactly the element carrying the block data attr.
 */
export function resolveNewsletterBlockPositionFromDom(
  editor: Editor | null,
  target: EventTarget | null,
): number | null {
  if (!editor || !(target instanceof Element)) return null;
  const blockElement = target.closest('[data-email-studio-block]');
  if (!blockElement) return null;

  const doc = editor.state.doc;
  let pos = 0;
  for (let index = 0; index < doc.childCount; index += 1) {
    const child = doc.child(index);
    if (child.type.name === 'emailStudioBlock') {
      const nodeDom = editor.view.nodeDOM(pos);
      if (
        nodeDom instanceof Element
        && (
          nodeDom === blockElement
          || nodeDom.contains(blockElement)
          || blockElement.contains(nodeDom)
        )
      ) {
        return pos;
      }
    }
    pos += child.nodeSize;
  }
  return null;
}

/**
 * Selects the structured block that owns a clicked DOM element. This helper is
 * currently called from a capture-phase mousedown in the newsletter composer.
 * ProseMirror then handles the same mousedown and can replace the NodeSelection,
 * so re-assert the block selection once the current event stack has completed.
 */
export function selectNewsletterBlockFromDom(editor: Editor | null, target: EventTarget | null): boolean {
  if (!editor) return false;
  const position = resolveNewsletterBlockPositionFromDom(editor, target);
  if (position === null) return false;
  if (!editor.commands.setNodeSelection(position)) return false;

  queueMicrotask(() => {
    if (!editor.isDestroyed && getNewsletterBlockAtPosition(editor, position)) {
      editor.commands.setNodeSelection(position);
    }
  });

  return true;
}

export function duplicateSelectedNewsletterBlock(editor: Editor | null): boolean {
  if (!editor) return false;
  const selected = getSelectedNewsletterBlock(editor);
  const selectedNode = getSelectedBlockNode(editor);
  if (!selected || !selectedNode || selected.locked) return false;

  const insertAt = selected.to;
  editor.view.dispatch(editor.state.tr.insert(insertAt, selectedNode.node));
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
  const selectedNode = getSelectedBlockNode(editor);
  if (!selected || !selectedNode || selected.locked) return false;
  if (direction === 'up' && !selected.canMoveUp) return false;
  if (direction === 'down' && !selected.canMoveDown) return false;

  const sibling = editor.state.doc.child(selected.index + (direction === 'up' ? -1 : 1));
  const targetPosition = direction === 'up'
    ? selected.from - sibling.nodeSize
    : selected.from + sibling.nodeSize;

  const transaction = editor.state.tr
    .delete(selected.from, selected.to)
    .insert(targetPosition, selectedNode.node);
  editor.view.dispatch(transaction);
  return editor.commands.setNodeSelection(targetPosition);
}

function getSelectedBlockNode(editor: Editor) {
  const selection = editor.state.selection as typeof editor.state.selection & {
    node?: typeof editor.state.doc;
  };
  const node = selection.node;
  if (!node || node.type.name !== 'emailStudioBlock') return null;
  return { selection, node };
}
