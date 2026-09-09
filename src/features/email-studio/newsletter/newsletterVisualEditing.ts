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

type ProseMirrorNode = Editor['state']['doc'];

type NewsletterBlockLocation = {
  node: ProseMirrorNode;
  parent: ProseMirrorNode;
  position: number;
  index: number;
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

  const location = getNewsletterBlockLocationAtPosition(editor, selected.selection.from);
  if (!location) return null;
  return selectedBlockFromLocation(location);
}

export function updateSelectedNewsletterBlock(editor: Editor | null, patch: NewsletterBlockPatch): boolean {
  const selected = getSelectedNewsletterBlock(editor);
  if (!editor || !selected || selected.locked) return false;
  return editor.chain().focus().updateAttributes('emailStudioBlock', patch).run();
}

/**
 * Reads a structured block at an absolute ProseMirror document position.
 * React Email wraps authored content in a container node, so blocks are not
 * guaranteed to be direct children of the document.
 */
export function getNewsletterBlockAtPosition(
  editor: Editor | null,
  position: number,
): NewsletterSelectedBlock | null {
  if (!editor) return null;
  const location = getNewsletterBlockLocationAtPosition(editor, position);
  return location ? selectedBlockFromLocation(location) : null;
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
 * Resolves a clicked rendered block to its absolute ProseMirror position.
 * @react-email/editor inserts a container around authored blocks, and may also
 * wrap a node in DOM chrome, so neither document depth nor exact DOM identity
 * is stable enough to use as the lookup contract.
 */
export function resolveNewsletterBlockPositionFromDom(
  editor: Editor | null,
  target: EventTarget | null,
): number | null {
  if (!editor || !(target instanceof Element)) return null;
  const blockElement = target.closest('[data-email-studio-block]');
  if (!blockElement) return null;

  let matchedPosition: number | null = null;
  editor.state.doc.descendants((node, position) => {
    if (matchedPosition !== null) return false;
    if (node.type.name !== 'emailStudioBlock') return true;

    const nodeDom = editor.view.nodeDOM(position);
    if (
      nodeDom instanceof Element
      && (
        nodeDom === blockElement
        || nodeDom.contains(blockElement)
        || blockElement.contains(nodeDom)
      )
    ) {
      matchedPosition = position;
    }
    return false;
  });

  return matchedPosition;
}

/**
 * Selects the structured block that owns a clicked DOM element. The composer
 * currently calls this during capture-phase mousedown, so re-assert the same
 * NodeSelection after ProseMirror finishes handling that event.
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

  const location = getNewsletterBlockLocationAtPosition(editor, selected.from);
  if (!location) return false;
  const siblingIndex = location.index + (direction === 'up' ? -1 : 1);
  if (siblingIndex < 0 || siblingIndex >= location.parent.childCount) return false;
  const sibling = location.parent.child(siblingIndex);
  const targetPosition = direction === 'up'
    ? selected.from - sibling.nodeSize
    : selected.from + sibling.nodeSize;

  const transaction = editor.state.tr
    .delete(selected.from, selected.to)
    .insert(targetPosition, selectedNode.node);
  editor.view.dispatch(transaction);
  return editor.commands.setNodeSelection(targetPosition);
}

function getNewsletterBlockLocationAtPosition(
  editor: Editor,
  position: number,
): NewsletterBlockLocation | null {
  const node = editor.state.doc.nodeAt(position);
  if (!node || node.type.name !== 'emailStudioBlock') return null;

  const resolved = editor.state.doc.resolve(position);
  const parent = resolved.parent;
  const index = resolved.index();
  if (index >= parent.childCount || parent.child(index) !== node) return null;

  return {
    node,
    parent,
    position,
    index,
  };
}

function selectedBlockFromLocation(location: NewsletterBlockLocation): NewsletterSelectedBlock {
  const { node, parent, position, index } = location;
  const rawKind = String(node.attrs.kind || 'text');
  const kind = (EMAIL_STUDIO_BLOCK_KINDS as readonly string[]).includes(rawKind)
    ? rawKind as EmailStudioBlockKind
    : 'text';
  const locked = Boolean(node.attrs.locked);

  return {
    kind,
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
    canMoveDown: !locked && index < parent.childCount - 1,
  };
}

function getSelectedBlockNode(editor: Editor) {
  const selection = editor.state.selection as typeof editor.state.selection & {
    node?: typeof editor.state.doc;
  };
  const node = selection.node;
  if (!node || node.type.name !== 'emailStudioBlock') return null;
  return { selection, node };
}
