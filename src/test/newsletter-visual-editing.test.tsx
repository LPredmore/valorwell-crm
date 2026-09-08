import { createRef } from 'react';
import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { EmailEditor, type EmailEditorRef } from '@react-email/editor';
import { StarterKit } from '@react-email/editor/extensions';
import { EmailTheming } from '@react-email/editor/plugins';
import { EmailStudioBlock, EmailStudioVariable } from '@/features/email-studio/studio/extensions';
import { createEmailStudioDocument } from '@/features/email-studio/studio/documents';
import {
  deleteSelectedNewsletterBlock,
  findNewsletterBlockPositionFromDom,
  getNewsletterBlockAtPosition,
  getSelectedNewsletterBlock,
  moveSelectedNewsletterBlock,
  newsletterBlockSupportsImage,
  newsletterBlockSupportsLink,
  selectNewsletterBlockFromDom,
  updateNewsletterBlockAtPosition,
  updateSelectedNewsletterBlock,
} from '@/features/email-studio/newsletter/newsletterVisualEditing';

beforeAll(() => {
  // ProseMirror's own mousedown handling needs this jsdom gap filled.
  if (!document.elementFromPoint) {
    (document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null;
  }
});

async function mountEditor() {
  const ref = createRef<EmailEditorRef>();
  const document_ = createEmailStudioDocument({
    mode: 'newsletter',
    scope: 'marketing_newsletter',
    themeKey: 'valorwell',
  });
  render(
    <EmailEditor
      ref={ref}
      content={document_ as never}
      extensions={[
        StarterKit,
        EmailTheming.configure({ theme: 'basic' }),
        EmailStudioBlock,
        EmailStudioVariable,
      ]}
    />,
  );
  await new Promise((resolve) => setTimeout(resolve, 600));
  const editor = ref.current?.editor;
  if (!editor) throw new Error('editor did not mount');
  return editor;
}

function section(kind: string): HTMLElement {
  const element = document.querySelector(`section[data-email-studio-block="${kind}"]`);
  if (!element) throw new Error(`missing rendered block: ${kind}`);
  return element as HTMLElement;
}

describe('newsletter visual editing against the real email editor', () => {
  it('resolves blocks that are nested inside the editor container node, not only top-level doc children', async () => {
    const editor = await mountEditor();

    // Regression guard: the editor wraps authored content in a `container`
    // node, so the document's direct children are not the structured blocks.
    expect(editor.state.doc.child(0).type.name).not.toBe('emailStudioBlock');

    const position = findNewsletterBlockPositionFromDom(editor, section('story'));
    expect(position).not.toBeNull();
    expect(getNewsletterBlockAtPosition(editor, position!)?.kind).toBe('story');
  });

  it('maps a click on a descendant element (heading, paragraph, image) to the owning block', async () => {
    const editor = await mountEditor();
    const story = section('story');

    for (const descendant of [story.querySelector('h2'), story.querySelector('p'), story]) {
      const position = findNewsletterBlockPositionFromDom(editor, descendant);
      expect(position).not.toBeNull();
      expect(getNewsletterBlockAtPosition(editor, position!)?.kind).toBe('story');
    }
  });

  it('resolves a data-marked element that is not a SECTION tag', async () => {
    const editor = await mountEditor();
    const marker = document.createElement('div');
    marker.setAttribute('data-email-studio-block', 'story');
    section('story').appendChild(marker);

    const position = findNewsletterBlockPositionFromDom(editor, marker);
    expect(position).not.toBeNull();
    expect(getNewsletterBlockAtPosition(editor, position!)?.kind).toBe('story');
  });

  it('resolves a block whose node DOM merely contains the clicked marked element', async () => {
    const editor = await mountEditor();
    const story = section('story');
    const wrapper = document.createElement('div');
    const inner = document.createElement('span');
    inner.setAttribute('data-email-studio-block', 'story');
    wrapper.appendChild(inner);
    story.appendChild(wrapper);

    const position = findNewsletterBlockPositionFromDom(editor, inner);
    expect(getNewsletterBlockAtPosition(editor, position!)?.kind).toBe('story');
  });

  it('ignores clicks outside any structured block', async () => {
    const editor = await mountEditor();
    expect(findNewsletterBlockPositionFromDom(editor, editor.view.dom)).toBeNull();
    expect(findNewsletterBlockPositionFromDom(editor, null)).toBeNull();
  });

  it('selects the clicked block and exposes inspector-safe values plus movement state', async () => {
    const editor = await mountEditor();
    expect(selectNewsletterBlockFromDom(editor, section('callout').querySelector('h2'))).toBe(true);

    const selected = getSelectedNewsletterBlock(editor);
    expect(selected?.kind).toBe('callout');
    expect(selected?.title).toBe(section('callout').dataset.title);
    expect(selected?.locked).toBe(false);
    expect(selected?.canMoveUp).toBe(true);
    expect(selected?.canMoveDown).toBe(true);
  });

  it('keeps the logical selection usable after a plain caret selection moves away', async () => {
    const editor = await mountEditor();
    const position = findNewsletterBlockPositionFromDom(editor, section('resource'))!;
    selectNewsletterBlockFromDom(editor, section('resource'));

    editor.commands.setTextSelection(1);
    expect(getSelectedNewsletterBlock(editor)).toBeNull();
    // The stored position keeps working, which is what the inspector relies on.
    expect(getNewsletterBlockAtPosition(editor, position)?.kind).toBe('resource');
    expect(updateNewsletterBlockAtPosition(editor, position, { title: 'Still editable' })).toBe(true);
    expect(getNewsletterBlockAtPosition(editor, position)?.title).toBe('Still editable');
  });

  it('writes title and body edits into the document and the rendered canvas', async () => {
    const editor = await mountEditor();
    const position = findNewsletterBlockPositionFromDom(editor, section('story'))!;

    expect(updateNewsletterBlockAtPosition(editor, position, { title: 'New title', body: 'New body' })).toBe(true);
    const updated = getNewsletterBlockAtPosition(editor, position);
    expect(updated?.title).toBe('New title');
    expect(updated?.body).toBe('New body');
    expect(section('story').dataset.title).toBe('New title');
  });

  it('refuses to edit, move, or delete the locked compliance footer', async () => {
    const editor = await mountEditor();
    const locked = document.querySelector('section[data-locked="true"]') as HTMLElement;
    expect(locked).toBeTruthy();

    const position = findNewsletterBlockPositionFromDom(editor, locked)!;
    expect(selectNewsletterBlockFromDom(editor, locked)).toBe(true);
    const selected = getSelectedNewsletterBlock(editor);
    expect(selected?.locked).toBe(true);
    expect(selected?.canMoveUp).toBe(false);
    expect(selected?.canMoveDown).toBe(false);
    expect(updateNewsletterBlockAtPosition(editor, position, { body: 'Remove unsubscribe' })).toBe(false);
    expect(updateSelectedNewsletterBlock(editor, { body: 'Remove unsubscribe' })).toBe(false);
    expect(moveSelectedNewsletterBlock(editor, 'up')).toBe(false);
    expect(deleteSelectedNewsletterBlock(editor)).toBe(false);
  });

  it('moves an unlocked block among its siblings inside the container', async () => {
    const editor = await mountEditor();
    const order = () => Array.from(document.querySelectorAll('section[data-email-studio-block]'))
      .map((element) => (element as HTMLElement).dataset.emailStudioBlock);
    const before = order();
    const storyIndex = before.indexOf('story');

    selectNewsletterBlockFromDom(editor, section('story'));
    expect(moveSelectedNewsletterBlock(editor, 'up')).toBe(true);
    expect(order()[storyIndex - 1]).toBe('story');
  });

  it('only exposes image and link controls to compatible email-safe block kinds', () => {
    expect(newsletterBlockSupportsImage('hero')).toBe(true);
    expect(newsletterBlockSupportsImage('clinician-spotlight')).toBe(true);
    expect(newsletterBlockSupportsImage('divider')).toBe(false);
    expect(newsletterBlockSupportsLink('cta')).toBe(true);
    expect(newsletterBlockSupportsLink('video')).toBe(true);
    expect(newsletterBlockSupportsLink('stats')).toBe(false);
  });
});
