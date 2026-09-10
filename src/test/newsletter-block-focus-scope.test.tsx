import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientNewsletterEmailStudioComposer } from '@/features/email-studio/newsletter/ClientNewsletterEmailStudioComposer';
import type { EmailContentDocument, EmailEditorNode } from '@/features/email-studio/contracts';

vi.mock('@/features/email-studio/templates/api', () => ({
  getEmailStudioAccessContext: async () => ({ tenantId: 't', userId: 'u', role: 'admin' }),
}));

// jsdom does not implement elementFromPoint, which prosemirror-view's
// click-to-select path calls into. Real browsers implement it.
beforeEach(() => {
  document.elementFromPoint = () => null;
});

function newsletterContent(content: EmailEditorNode[]): EmailContentDocument {
  return {
    schemaVersion: 1,
    mode: 'newsletter',
    editorDocument: { type: 'doc', content },
    renderedHtml: '',
    renderedText: '',
    preheader: '',
    themeKey: 'valorwell',
    renderHash: 'test-render-hash',
  };
}

const block = (attrs: Record<string, unknown>): EmailEditorNode => ({ type: 'emailStudioBlock', attrs });

function twoBlockContent() {
  return newsletterContent([
    block({ kind: 'hero', title: 'First block title', body: 'First body' }),
    block({ kind: 'story', title: 'Second block title', body: 'Second body' }),
  ]);
}

function selectStoryBlock(container: HTMLElement) {
  const storySection = container.querySelector('section[data-email-studio-block="story"]') as HTMLElement;
  fireEvent.mouseDown(storySection);
  fireEvent.mouseUp(storySection);
  fireEvent.click(storySection);
  return storySection;
}

/**
 * Browsers fire focusout on the element losing focus with relatedTarget set to
 * the element gaining it. jsdom's fireEvent.click does not, so drive it here to
 * reproduce what happens when a user reaches for a control outside the canvas.
 */
function moveFocusOutOfCanvas(container: HTMLElement, nextFocus: Element) {
  const proseMirror = container.querySelector('.ProseMirror') as HTMLElement;
  fireEvent.focusIn(proseMirror);
  fireEvent.focusOut(proseMirror, { relatedTarget: nextFocus });
}

describe('newsletter block selection survives focus leaving the canvas', () => {
  it('duplicates the selected block, not the first block', async () => {
    const { container } = render(
      <ClientNewsletterEmailStudioComposer initialContent={twoBlockContent()} onDirty={vi.fn()} />,
    );

    await waitFor(() => {
      expect(container.querySelector('section[data-email-studio-block="story"]')).toBeTruthy();
    });
    selectStoryBlock(container);

    await waitFor(() => {
      expect((container.querySelector('#newsletter-block-title') as HTMLInputElement).value)
        .toBe('Second block title');
    });

    const duplicateButton = screen.getByRole('button', { name: /duplicate/i });
    moveFocusOutOfCanvas(container, duplicateButton);
    fireEvent.click(duplicateButton);

    await waitFor(() => {
      expect(container.querySelectorAll('section[data-email-studio-block="story"]').length).toBe(2);
    });
    expect(container.querySelectorAll('section[data-email-studio-block="hero"]').length).toBe(1);
  });

  it('inserts a library block instead of replacing the first block', async () => {
    const { container } = render(
      <ClientNewsletterEmailStudioComposer initialContent={twoBlockContent()} onDirty={vi.fn()} />,
    );

    await waitFor(() => {
      expect(container.querySelector('section[data-email-studio-block="story"]')).toBeTruthy();
    });
    selectStoryBlock(container);

    const libraryPanel = container.querySelector('[data-testid="newsletter-block-library"]') as HTMLElement;
    const calloutButton = Array.from(libraryPanel.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Callout')) as HTMLButtonElement;

    moveFocusOutOfCanvas(container, calloutButton);
    fireEvent.click(calloutButton);

    await waitFor(() => {
      expect(container.querySelector('section[data-email-studio-block="callout"]')).toBeTruthy();
    });
    // The hero must survive: inserting must not replace an unrelated block.
    expect(container.querySelectorAll('section[data-email-studio-block="hero"]').length).toBe(1);
    expect(container.querySelectorAll('section[data-email-studio-block="story"]').length).toBe(1);
  });

  it('edits the selected block when typing in the inspector, not the first block', async () => {
    const { container } = render(
      <ClientNewsletterEmailStudioComposer initialContent={twoBlockContent()} onDirty={vi.fn()} />,
    );

    await waitFor(() => {
      expect(container.querySelector('section[data-email-studio-block="story"]')).toBeTruthy();
    });
    selectStoryBlock(container);

    await waitFor(() => {
      expect((container.querySelector('#newsletter-block-title') as HTMLInputElement).value)
        .toBe('Second block title');
    });

    const bodyField = container.querySelector('#newsletter-block-body') as HTMLTextAreaElement;
    moveFocusOutOfCanvas(container, bodyField);
    fireEvent.focus(bodyField);
    fireEvent.change(bodyField, { target: { value: 'Second body EDITED' } });

    await waitFor(() => {
      expect(container.querySelector('section[data-email-studio-block="story"]')?.getAttribute('data-body'))
        .toBe('Second body EDITED');
    });
    expect((container.querySelector('#newsletter-block-title') as HTMLInputElement).value)
      .toBe('Second block title');
    expect(container.querySelector('section[data-email-studio-block="hero"]')?.getAttribute('data-body'))
      .toBe('First body');
  });
});
