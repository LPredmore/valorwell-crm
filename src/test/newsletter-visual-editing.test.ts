import { Editor as CoreEditor } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import { StarterKit } from '@react-email/editor/extensions';
import { EmailTheming } from '@react-email/editor/plugins';
import { describe, expect, it, vi } from 'vitest';
import {
  getNewsletterBlockAtPosition,
  getSelectedNewsletterBlock,
  newsletterBlockSupportsImage,
  newsletterBlockSupportsLink,
  resolveNewsletterBlockPositionFromDom,
  selectNewsletterBlockFromDom,
  updateNewsletterBlockAtPosition,
  updateSelectedNewsletterBlock,
} from '@/features/email-studio/newsletter/newsletterVisualEditing';
import { EmailStudioBlock } from '@/features/email-studio/studio/extensions';

function selectedEditor(
  attrs: Record<string, unknown>,
  options: { index?: number; childCount?: number; depth?: number } = {},
): Editor {
  const index = options.index ?? 1;
  const childCount = options.childCount ?? 3;
  const depth = options.depth ?? 0;
  const node = {
    type: { name: 'emailStudioBlock' },
    attrs,
    nodeSize: 2,
  };
  const parent = {
    childCount,
    child: () => node,
  };
  return {
    state: {
      selection: {
        from: 10,
        to: 12,
        $from: { depth, index: () => index },
        node,
      },
      doc: {
        childCount,
        nodeAt: () => node,
        resolve: () => ({ parent, index: () => index }),
      },
    },
  } as unknown as Editor;
}

describe('newsletter visual editing', () => {
  it('maps a selected structured block into inspector-safe values and movement state', () => {
    const editor = selectedEditor({
      kind: 'hero',
      title: 'Weekly update',
      body: 'What changed this week',
      href: '',
      imageUrl: 'https://example.com/hero.png',
      altText: 'Veteran speaking with a clinician',
      locked: false,
    });

    expect(getSelectedNewsletterBlock(editor)).toEqual({
      kind: 'hero',
      title: 'Weekly update',
      body: 'What changed this week',
      href: '',
      imageUrl: 'https://example.com/hero.png',
      altText: 'Veteran speaking with a clinician',
      locked: false,
      from: 10,
      to: 12,
      index: 1,
      canMoveUp: true,
      canMoveDown: true,
    });
  });

  it('keeps required locked blocks immutable and non-movable', () => {
    const editor = selectedEditor({ kind: 'compliance-footer', locked: true }, { index: 2, childCount: 3 });
    const selected = getSelectedNewsletterBlock(editor);

    expect(selected?.locked).toBe(true);
    expect(selected?.canMoveUp).toBe(false);
    expect(selected?.canMoveDown).toBe(false);
    expect(updateSelectedNewsletterBlock(editor, { body: 'Remove unsubscribe' })).toBe(false);
  });

  it('only exposes image and link controls to compatible email-safe block kinds', () => {
    expect(newsletterBlockSupportsImage('hero')).toBe(true);
    expect(newsletterBlockSupportsImage('clinician-spotlight')).toBe(true);
    expect(newsletterBlockSupportsImage('divider')).toBe(false);
    expect(newsletterBlockSupportsLink('cta')).toBe(true);
    expect(newsletterBlockSupportsLink('video')).toBe(true);
    expect(newsletterBlockSupportsLink('stats')).toBe(false);
  });

  it('updates only the selected block attributes through the editor command chain', () => {
    const run = vi.fn(() => true);
    const updateAttributes = vi.fn(() => ({ run }));
    const focus = vi.fn(() => ({ updateAttributes }));
    const chain = vi.fn(() => ({ focus }));
    const node = {
      type: { name: 'emailStudioBlock' },
      attrs: { kind: 'story', locked: false },
      nodeSize: 2,
    };
    const parent = { childCount: 3, child: () => node };
    const editor = {
      state: {
        selection: {
          from: 10,
          to: 12,
          $from: { depth: 0, index: () => 1 },
          node,
        },
        doc: {
          childCount: 3,
          nodeAt: () => node,
          resolve: () => ({ parent, index: () => 1 }),
        },
      },
      chain,
    } as unknown as Editor;

    expect(updateSelectedNewsletterBlock(editor, { title: 'A new title' })).toBe(true);
    expect(updateAttributes).toHaveBeenCalledWith('emailStudioBlock', { title: 'A new title' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('accepts container-nested NodeSelections and still ignores plain text selections', () => {
    const nested = selectedEditor({ kind: 'story', title: 'Nested story', locked: false }, { depth: 1 });
    const textSelection = {
      state: {
        selection: {
          from: 4,
          to: 4,
          $from: { depth: 1, index: () => 0 },
        },
        doc: { childCount: 1 },
      },
    } as unknown as Editor;

    expect(getSelectedNewsletterBlock(nested)).toMatchObject({ kind: 'story', title: 'Nested story' });
    expect(getSelectedNewsletterBlock(textSelection)).toBeNull();
  });
});

describe('newsletter block editing by stored position', () => {
  function docEditor(attrs: Record<string, unknown>) {
    const node = {
      type: { name: 'emailStudioBlock' },
      attrs,
      nodeSize: 2,
    };
    const parent = { childCount: 1, child: () => node };
    const dispatch = vi.fn();
    const setNodeMarkup = vi.fn(() => 'tr');
    return {
      dispatch,
      setNodeMarkup,
      editor: {
        state: {
          selection: { from: 0, to: 0, $from: { depth: 0, index: () => 0 } },
          doc: {
            childCount: 1,
            child: () => node,
            nodeAt: () => node,
            resolve: () => ({ parent, index: () => 0 }),
          },
          tr: { setNodeMarkup },
        },
        view: { dispatch },
      } as unknown as Editor,
    };
  }

  it('reads a block from its absolute document position', () => {
    const { editor } = docEditor({ kind: 'story', title: 'Story', body: 'Body', locked: false });
    expect(getNewsletterBlockAtPosition(editor, 0)).toMatchObject({
      kind: 'story',
      title: 'Story',
      body: 'Body',
      from: 0,
      to: 2,
      index: 0,
    });
  });

  it('updates the stored block without requiring editor focus or selection', () => {
    const { editor, dispatch, setNodeMarkup } = docEditor({ kind: 'story', title: 'Story', locked: false });
    expect(updateNewsletterBlockAtPosition(editor, 0, { title: 'Updated' })).toBe(true);
    expect(setNodeMarkup).toHaveBeenCalledWith(0, undefined, { kind: 'story', title: 'Updated', locked: false });
    expect(dispatch).toHaveBeenCalledWith('tr');
  });

  it('refuses to edit locked blocks by position', () => {
    const { editor, dispatch } = docEditor({ kind: 'compliance-footer', locked: true });
    expect(updateNewsletterBlockAtPosition(editor, 0, { body: 'Remove unsubscribe' })).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('newsletter block DOM selection bridge', () => {
  function domEditor(nodeDom: Element, position = 1) {
    const node = {
      type: { name: 'emailStudioBlock' },
      attrs: {
        kind: 'text',
        title: 'Existing title',
        body: 'Existing body',
        href: '',
        imageUrl: '',
        altText: '',
        locked: false,
      },
      nodeSize: 2,
    };
    const parent = { childCount: 1, child: () => node };
    const setNodeSelection = vi.fn(() => true);
    return {
      setNodeSelection,
      editor: {
        state: {
          doc: {
            childCount: 1,
            nodeAt: () => node,
            resolve: () => ({ parent, index: () => 0 }),
            descendants: (callback: (child: typeof node, pos: number) => boolean | void) => {
              callback(node, position);
            },
          },
        },
        view: {
          nodeDOM: () => nodeDom,
        },
        commands: { setNodeSelection },
        isDestroyed: false,
      } as unknown as Editor,
    };
  }

  it('resolves a nested click when React Email wraps the rendered block DOM', () => {
    const nodeWrapper = document.createElement('div');
    const renderedBlock = document.createElement('div');
    renderedBlock.dataset.emailStudioBlock = 'text';
    const clickedChild = document.createElement('span');
    renderedBlock.appendChild(clickedChild);
    nodeWrapper.appendChild(renderedBlock);

    const { editor } = domEditor(nodeWrapper);
    expect(resolveNewsletterBlockPositionFromDom(editor, clickedChild)).toBe(1);
  });

  it('does not require the rendered structured block to be a section element', () => {
    const renderedBlock = document.createElement('article');
    renderedBlock.dataset.emailStudioBlock = 'text';
    const clickedChild = document.createElement('strong');
    renderedBlock.appendChild(clickedChild);

    const { editor } = domEditor(renderedBlock);
    expect(resolveNewsletterBlockPositionFromDom(editor, clickedChild)).toBe(1);
  });

  it('reasserts the block selection after the capture-phase event stack completes', async () => {
    const nodeWrapper = document.createElement('div');
    const renderedBlock = document.createElement('div');
    renderedBlock.dataset.emailStudioBlock = 'text';
    const clickedChild = document.createElement('span');
    renderedBlock.appendChild(clickedChild);
    nodeWrapper.appendChild(renderedBlock);

    const { editor, setNodeSelection } = domEditor(nodeWrapper);
    expect(selectNewsletterBlockFromDom(editor, clickedChild)).toBe(true);
    expect(setNodeSelection).toHaveBeenCalledTimes(1);

    await Promise.resolve();

    expect(setNodeSelection).toHaveBeenCalledTimes(2);
    expect(setNodeSelection).toHaveBeenLastCalledWith(1);
  });

  it('ignores clicks outside structured newsletter blocks', () => {
    const nodeWrapper = document.createElement('div');
    const outside = document.createElement('button');
    const { editor, setNodeSelection } = domEditor(nodeWrapper);

    expect(resolveNewsletterBlockPositionFromDom(editor, outside)).toBeNull();
    expect(selectNewsletterBlockFromDom(editor, outside)).toBe(false);
    expect(setNodeSelection).not.toHaveBeenCalled();
  });
});

describe('real @react-email/editor container behavior', () => {
  it('selects, resolves, and updates a block nested inside the real container wrapper', async () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    const editor = new CoreEditor({
      element,
      extensions: [
        StarterKit,
        EmailTheming.configure({ theme: 'basic' }),
        EmailStudioBlock,
      ],
      content: {
        type: 'doc',
        content: [
          {
            type: 'emailStudioBlock',
            attrs: {
              kind: 'text',
              title: 'The bottleneck now is therapists',
              body: 'The infrastructure is in place.',
              href: '',
              imageUrl: '',
              altText: '',
              themeKey: 'valorwell',
              locked: false,
            },
          },
          {
            type: 'emailStudioBlock',
            attrs: {
              kind: 'story',
              title: 'Second block',
              body: 'Second body',
              href: '',
              imageUrl: '',
              altText: '',
              themeKey: 'valorwell',
              locked: false,
            },
          },
        ],
      },
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(editor.state.doc.childCount).toBe(1);
      expect(editor.state.doc.firstChild?.type.name).toBe('container');

      let blockPosition: number | null = null;
      editor.state.doc.descendants((node, position) => {
        if (blockPosition === null && node.type.name === 'emailStudioBlock') {
          blockPosition = position;
          return false;
        }
        return true;
      });
      expect(blockPosition).toBe(1);

      const newsletterEditor = editor as unknown as Editor;
      expect(editor.commands.setNodeSelection(blockPosition!)).toBe(true);
      expect(editor.state.selection.$from.depth).toBe(1);
      expect(getSelectedNewsletterBlock(newsletterEditor)).toMatchObject({
        kind: 'text',
        title: 'The bottleneck now is therapists',
        body: 'The infrastructure is in place.',
        from: 1,
        index: 0,
        canMoveUp: false,
        canMoveDown: true,
      });

      const renderedBlock = element.querySelector<HTMLElement>('[data-email-studio-block="text"]');
      expect(renderedBlock).not.toBeNull();
      const clickTarget = renderedBlock?.querySelector('h2') ?? renderedBlock;
      expect(resolveNewsletterBlockPositionFromDom(newsletterEditor, clickTarget)).toBe(1);
      expect(selectNewsletterBlockFromDom(newsletterEditor, clickTarget)).toBe(true);
      await Promise.resolve();
      expect(getSelectedNewsletterBlock(newsletterEditor)?.title).toBe('The bottleneck now is therapists');

      expect(updateNewsletterBlockAtPosition(newsletterEditor, 1, { title: 'Updated title' })).toBe(true);
      expect(editor.state.doc.nodeAt(1)?.attrs.title).toBe('Updated title');
    } finally {
      editor.destroy();
      element.remove();
    }
  });
});
