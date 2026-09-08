import type { Editor } from '@tiptap/react';
import { describe, expect, it, vi } from 'vitest';
import {
  getNewsletterBlockAtPosition,
  getSelectedNewsletterBlock,
  newsletterBlockSupportsImage,
  newsletterBlockSupportsLink,
  updateNewsletterBlockAtPosition,
  updateSelectedNewsletterBlock,
} from '@/features/email-studio/newsletter/newsletterVisualEditing';

function selectedEditor(
  attrs: Record<string, unknown>,
  options: { index?: number; childCount?: number; depth?: number } = {},
): Editor {
  const index = options.index ?? 1;
  const childCount = options.childCount ?? 3;
  const depth = options.depth ?? 0;
  return {
    state: {
      selection: {
        from: 10,
        to: 12,
        $from: { depth, index: () => index },
        node: {
          type: { name: 'emailStudioBlock' },
          attrs,
          nodeSize: 2,
        },
      },
      doc: { childCount },
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
    const editor = {
      state: {
        selection: {
          from: 10,
          to: 12,
          $from: { depth: 0, index: () => 1 },
          node: {
            type: { name: 'emailStudioBlock' },
            attrs: { kind: 'story', locked: false },
            nodeSize: 2,
          },
        },
        doc: { childCount: 3 },
      },
      chain,
    } as unknown as Editor;

    expect(updateSelectedNewsletterBlock(editor, { title: 'A new title' })).toBe(true);
    expect(updateAttributes).toHaveBeenCalledWith('emailStudioBlock', { title: 'A new title' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('ignores non-block and nested selections instead of exposing destructive controls', () => {
    const nested = selectedEditor({ kind: 'story', locked: false }, { depth: 1 });
    const textSelection = {
      state: {
        selection: {
          from: 4,
          to: 4,
          $from: { depth: 0, index: () => 0 },
        },
        doc: { childCount: 1 },
      },
    } as unknown as Editor;

    expect(getSelectedNewsletterBlock(nested)).toBeNull();
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
