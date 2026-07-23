import { describe, expect, it } from 'vitest';
import { createEmailRenderHash } from '@/features/email-studio/contracts/hash';
import type { EmailContentDraft } from '@/features/email-studio/contracts/document';
import {
  createCanonicalEmailRenderHash,
  prepareDirectEmailDelivery,
  renderTemplate,
} from '../../supabase/functions/crm-resend-email/email-content';

function directDraft(overrides: Partial<EmailContentDraft> = {}): EmailContentDraft {
  return {
    schemaVersion: 1,
    mode: 'direct',
    editorDocument: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hi ' },
          { type: 'emailVariable', attrs: { key: 'first_name', label: 'Client first name' } },
        ],
      }],
    },
    renderedHtml: '<p>Hi {{first_name}}</p>',
    renderedText: 'Hi {{first_name}}',
    preheader: 'A note for {{preferred_name}}',
    themeKey: 'valorwell',
    ...overrides,
  };
}

async function canonicalContent(overrides: Partial<EmailContentDraft> = {}) {
  const draft = directDraft(overrides);
  return { ...draft, renderHash: await createEmailRenderHash(draft) };
}

describe('Direct Email Studio server delivery contract', () => {
  it('uses the same deterministic hash as the browser contract', async () => {
    const draft = directDraft();
    expect(await createCanonicalEmailRenderHash(draft)).toBe(await createEmailRenderHash(draft));
  });

  it('renders and escapes client variables in canonical HTML', async () => {
    const prepared = await prepareDirectEmailDelivery({
      subjectTemplate: 'Hello {{preferred_name}}',
      content: await canonicalContent(),
      values: {
        first_name: '<Jordan>',
        preferred_name: 'J & J',
        last_name: 'Taylor',
        therapist_name: 'Dr. Lee',
        sender_name: 'ValorWell Care Team',
      },
    });

    expect(prepared.subject).toBe('Hello J & J');
    expect(prepared.text).toBe('Hi <Jordan>');
    expect(prepared.html).toContain('Hi &lt;Jordan&gt;');
    expect(prepared.html).toContain('A note for J &amp; J');
    expect(prepared.preheader).toBe('A note for J & J');
  });

  it('rejects content changed after the browser hash was created', async () => {
    const content = await canonicalContent();
    content.renderedText = 'Changed after export';
    await expect(prepareDirectEmailDelivery({
      subjectTemplate: 'Hello',
      content,
      values: {},
    })).rejects.toThrow('CANONICAL_RENDER_HASH_MISMATCH');
  });

  it('blocks relationship and unknown variables in client email', async () => {
    const relationship = directDraft({ renderedText: 'Hi {{contact_first_name}}' });
    const content = { ...relationship, renderHash: await createEmailRenderHash(relationship) };
    await expect(prepareDirectEmailDelivery({
      subjectTemplate: 'Hello',
      content,
      values: {},
    })).rejects.toThrow('UNKNOWN_EMAIL_VARIABLE:contact_first_name');
  });

  it('requires safe HTTP URLs for system URL variables', () => {
    expect(() => renderTemplate(
      'Manage preferences: {{unsubscribe_url}}',
      { unsubscribe_url: 'javascript:alert(1)' },
      'html',
    )).toThrow('INVALID_EMAIL_VARIABLE:unsubscribe_url');
  });

  it('requires every referenced variable at send time', async () => {
    await expect(prepareDirectEmailDelivery({
      subjectTemplate: 'Hello {{first_name}}',
      content: await canonicalContent(),
      values: {},
    })).rejects.toThrow('MISSING_EMAIL_VARIABLE:first_name,preferred_name');
  });
});
