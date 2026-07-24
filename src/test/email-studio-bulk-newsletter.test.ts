import { describe, expect, it } from 'vitest';
import { createEmailRenderHash } from '@/features/email-studio/contracts/hash';
import type { EmailContentDraft } from '@/features/email-studio/contracts/document';
import {
  createCanonicalEmailRenderHash,
  prepareNewsletterEmailDelivery,
} from '../../supabase/functions/crm-resend-email/email-content';

type NewsletterDraft = EmailContentDraft & { mode: 'newsletter' };

function newsletterDraft(overrides: Partial<Omit<NewsletterDraft, 'mode'>> = {}): NewsletterDraft {
  return {
    schemaVersion: 1,
    mode: 'newsletter',
    editorDocument: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hi {{preferred_name}}' }],
        },
        {
          type: 'emailStudioBlock',
          attrs: {
            kind: 'compliance-footer',
            title: 'Email preferences',
            body: 'Manage preferences: {{unsubscribe_url}} • {{postal_address}}',
          },
        },
      ],
    },
    renderedHtml: '<p>Hi {{preferred_name}}</p><p>{{unsubscribe_url}} • {{postal_address}}</p>',
    renderedText: 'Hi {{preferred_name}}\n{{unsubscribe_url}} • {{postal_address}}',
    preheader: 'A note for {{preferred_name}}',
    themeKey: 'valorwell',
    ...overrides,
  };
}

async function canonicalNewsletter(overrides: Partial<Omit<NewsletterDraft, 'mode'>> = {}) {
  const draft = newsletterDraft(overrides);
  return { ...draft, renderHash: await createEmailRenderHash(draft) };
}

describe('bulk Newsletter Email Studio delivery contract', () => {
  it('uses the browser canonical render hash', async () => {
    const draft = newsletterDraft();
    expect(await createCanonicalEmailRenderHash(draft)).toBe(await createEmailRenderHash(draft));
  });

  it('renders personalized and compliance variables safely', async () => {
    const prepared = await prepareNewsletterEmailDelivery({
      subjectTemplate: 'Hello {{preferred_name}}',
      content: await canonicalNewsletter(),
      values: {
        preferred_name: 'J & J',
        unsubscribe_url: 'https://example.org/unsubscribe?token=1',
        postal_address: '100 Main & First, Kansas City, MO',
      },
    });

    expect(prepared.mode).toBe('newsletter');
    expect(prepared.subject).toBe('Hello J & J');
    expect(prepared.html).toContain('J &amp; J');
    expect(prepared.html).toContain('100 Main &amp; First');
    expect(prepared.text).toContain('https://example.org/unsubscribe?token=1');
  });

  it('rejects missing unsubscribe and mailing-address values', async () => {
    await expect(prepareNewsletterEmailDelivery({
      subjectTemplate: 'Hello',
      content: await canonicalNewsletter(),
      values: { preferred_name: 'Jordan' },
    })).rejects.toThrow('MISSING_EMAIL_VARIABLE:postal_address,unsubscribe_url');
  });

  it('rejects unsafe unsubscribe URLs', async () => {
    await expect(prepareNewsletterEmailDelivery({
      subjectTemplate: 'Hello',
      content: await canonicalNewsletter(),
      values: {
        preferred_name: 'Jordan',
        unsubscribe_url: 'javascript:alert(1)',
        postal_address: '100 Main Street',
      },
    })).rejects.toThrow('INVALID_EMAIL_VARIABLE:unsubscribe_url');
  });

  it('rejects Direct-mode content at the newsletter boundary', async () => {
    const draft = newsletterDraft();
    const direct = { ...draft, mode: 'direct' as const };
    const content = { ...direct, renderHash: await createEmailRenderHash(direct) };
    await expect(prepareNewsletterEmailDelivery({
      subjectTemplate: 'Hello',
      content,
      values: {},
    })).rejects.toThrow('CANONICAL_MODE_MUST_BE_NEWSLETTER');
  });
});
