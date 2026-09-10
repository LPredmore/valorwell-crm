import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientNewsletterEmailStudioComposer } from '@/features/email-studio/newsletter/ClientNewsletterEmailStudioComposer';
import type { EmailContentDocument, EmailEditorNode } from '@/features/email-studio/contracts';

vi.mock('@/features/email-studio/templates/api', () => ({
  getEmailStudioAccessContext: async () => ({ tenantId: 't', userId: 'u', role: 'admin' }),
}));

// jsdom does not implement elementFromPoint, which prosemirror-view's click-to-select
// path calls into. Real browsers implement it; this only patches the missing jsdom API.
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

describe('newsletter block Title/Body editing keeps the selected block', () => {
  it('typing in the Body field of a non-first block does not snap selection back to the first block', async () => {
    const content = newsletterContent([
      block({ kind: 'hero', title: 'First block title', body: 'First body' }),
      block({ kind: 'story', title: 'Second block title', body: 'Second body' }),
    ]);
    const { container } = render(
      <ClientNewsletterEmailStudioComposer initialContent={content} onDirty={vi.fn()} />,
    );

    await waitFor(() => {
      expect(container.querySelector('section[data-email-studio-block="story"]')).toBeTruthy();
    });
    const storySection = container.querySelector('section[data-email-studio-block="story"]') as HTMLElement;

    fireEvent.mouseDown(storySection);
    fireEvent.mouseUp(storySection);
    fireEvent.click(storySection);

    const titleInput = await waitFor(() => {
      const el = container.querySelector('#newsletter-block-title') as HTMLInputElement;
      expect(el.value).toBe('Second block title');
      return el;
    });

    const bodyField = container.querySelector('#newsletter-block-body') as HTMLTextAreaElement;
    fireEvent.focus(bodyField);
    fireEvent.change(bodyField, { target: { value: 'Second body EDITED' } });
    fireEvent.change(bodyField, { target: { value: 'Second body EDITED more' } });

    await waitFor(() => {
      expect(bodyField.value).toBe('Second body EDITED more');
    });

    expect(titleInput.value).toBe('Second block title');
    expect(container.querySelector('section[data-email-studio-block="story"]')?.getAttribute('data-body'))
      .toBe('Second body EDITED more');
    expect(container.querySelector('section[data-email-studio-block="hero"]')?.getAttribute('data-body'))
      .toBe('First body');
  });
});
