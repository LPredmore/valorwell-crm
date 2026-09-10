import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientNewsletterEmailStudioComposer } from '@/features/email-studio/newsletter/ClientNewsletterEmailStudioComposer';
import { normalizeEmailStudioComplianceFooters } from '@/features/email-studio/studio/documents';
import { EMAIL_STUDIO_BLOCKS } from '@/features/email-studio/studio/config';
import type { EmailContentDocument, EmailEditorDocument } from '@/features/email-studio/contracts';

vi.mock('@/features/email-studio/templates/api', () => ({
  getEmailStudioAccessContext: async () => ({ tenantId: 't', userId: 'u', role: 'admin' }),
}));

beforeEach(() => {
  document.elementFromPoint = () => null;
});

const STALE_FOOTER_BODY = 'Manage preferences: {{unsubscribe_url}} • {{postal_address}}';

const staleFooter = () => ({
  type: 'emailStudioBlock',
  attrs: {
    kind: 'compliance-footer',
    title: 'Email preferences',
    body: STALE_FOOTER_BODY,
    themeKey: 'valorwell',
    locked: true,
  },
});

/**
 * Mirrors how a saved draft is actually stored: @react-email/editor wraps the
 * authored blocks in a container node, and this draft accumulated a duplicate
 * compliance footer carrying the previous canonical body text.
 */
function storedDraftDocument(): EmailEditorDocument {
  return {
    type: 'doc',
    content: [
      {
        type: 'container',
        content: [
          {
            type: 'emailStudioBlock',
            attrs: { kind: 'hero', title: 'A New Chapter', body: 'Opening', themeKey: 'valorwell' },
          },
          staleFooter(),
          staleFooter(),
        ],
      },
    ],
  } as EmailEditorDocument;
}

function newsletterContent(editorDocument: EmailEditorDocument): EmailContentDocument {
  return {
    schemaVersion: 1,
    mode: 'newsletter',
    editorDocument,
    renderedHtml: '',
    renderedText: '',
    preheader: '',
    themeKey: 'valorwell',
    renderHash: 'test-render-hash',
  };
}

const canonicalFooter = EMAIL_STUDIO_BLOCKS.find((block) => block.kind === 'compliance-footer');

describe('compliance footer normalization', () => {
  it('collapses duplicates and refreshes stale body text inside the container node', () => {
    const result = normalizeEmailStudioComplianceFooters(storedDraftDocument());

    expect(result.changed).toBe(true);
    const blocks = (result.document.content[0].content ?? [])
      .filter((node) => node.attrs?.kind === 'compliance-footer');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs?.body).toBe(canonicalFooter?.body);
    expect(String(blocks[0].attrs?.body)).not.toContain('{{postal_address}}');
    // untouched per-document attributes survive
    expect(blocks[0].attrs?.themeKey).toBe('valorwell');
    expect(blocks[0].attrs?.locked).toBe(true);
  });

  it('reports no change for a document that already matches the canonical footer', () => {
    const clean = normalizeEmailStudioComplianceFooters(storedDraftDocument()).document;
    const second = normalizeEmailStudioComplianceFooters(clean);
    expect(second.changed).toBe(false);
    expect(second.document).toBe(clean);
  });

  it('renders one compliance footer without the postal token and flags the draft for autosave', async () => {
    const onDirty = vi.fn();
    const { container } = render(
      <ClientNewsletterEmailStudioComposer
        initialContent={newsletterContent(storedDraftDocument())}
        onDirty={onDirty}
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll('section[data-email-studio-block="compliance-footer"]').length)
        .toBe(1);
    });
    expect(container.innerHTML).not.toContain('{{postal_address}}');
    // autosave must persist the repair, otherwise the send path keeps using
    // the stored HTML that still contains both footers
    expect(onDirty).toHaveBeenCalled();
  });

  it('disables the block library entry once a compliance footer exists', async () => {
    const { container } = render(
      <ClientNewsletterEmailStudioComposer
        initialContent={newsletterContent(storedDraftDocument())}
        onDirty={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('section[data-email-studio-block="compliance-footer"]')).toBeTruthy();
    });

    const library = container.querySelector('[data-testid="newsletter-block-library"]') as HTMLElement;
    const complianceButton = Array.from(library.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Compliance footer')) as HTMLButtonElement;

    expect(complianceButton).toBeTruthy();
    await waitFor(() => expect(complianceButton).toBeDisabled());

    fireEvent.click(complianceButton);
    expect(container.querySelectorAll('section[data-email-studio-block="compliance-footer"]').length)
      .toBe(1);
  });

  it('still allows adding a compliance footer when the document has none', async () => {
    const withoutFooter: EmailEditorDocument = {
      type: 'doc',
      content: [
        {
          type: 'container',
          content: [
            {
              type: 'emailStudioBlock',
              attrs: { kind: 'hero', title: 'A New Chapter', body: 'Opening', themeKey: 'valorwell' },
            },
          ],
        },
      ],
    } as EmailEditorDocument;

    const { container } = render(
      <ClientNewsletterEmailStudioComposer
        initialContent={newsletterContent(withoutFooter)}
        onDirty={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('section[data-email-studio-block="hero"]')).toBeTruthy();
    });

    const library = container.querySelector('[data-testid="newsletter-block-library"]') as HTMLElement;
    const complianceButton = Array.from(library.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Compliance footer')) as HTMLButtonElement;
    expect(complianceButton).not.toBeDisabled();

    fireEvent.click(complianceButton);

    await waitFor(() => {
      expect(container.querySelectorAll('section[data-email-studio-block="compliance-footer"]').length)
        .toBe(1);
    });
    expect(screen.queryByText(/postal_address/)).toBeNull();
  });
});
