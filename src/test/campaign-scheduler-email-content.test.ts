import { describe, expect, it } from 'vitest';
import {
  appendSignature,
  buildCampaignResendContent,
  createCanonicalCampaignRenderHash,
  prepareCampaignEmail,
} from '../../supabase/functions/campaign-scheduler/email-content';

const editorDocument = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello {{first_name}}' }] }],
};

async function canonicalStep(overrides: {
  renderedHtml?: string;
  renderedText?: string;
  preheader?: string | null;
} = {}) {
  const content = {
    schemaVersion: 1,
    mode: 'campaign' as const,
    editorDocument,
    renderedHtml: overrides.renderedHtml ?? '<p>Hello {{first_name}} from {{therapist_name}}</p>',
    renderedText: overrides.renderedText ?? 'Hello {{first_name}} from {{therapist_name}}',
    preheader: overrides.preheader === undefined ? 'Update for {{first_name}}' : overrides.preheader,
    themeKey: 'valorwell',
  };
  return {
    subjectTemplate: 'Hello {{first_name}}',
    renderedHtml: content.renderedHtml,
    renderedText: content.renderedText,
    preheader: content.preheader,
    contentMode: 'campaign',
    editorDocument: content.editorDocument,
    themeKey: content.themeKey,
    schemaVersion: content.schemaVersion,
    renderHash: await createCanonicalCampaignRenderHash(content),
    templateVersionId: '11111111-1111-4111-8111-111111111111',
  };
}

describe('client campaign scheduler email content', () => {
  it('verifies and personalizes canonical HTML and text', async () => {
    const prepared = await prepareCampaignEmail({
      step: await canonicalStep(),
      values: {
        first_name: '<Jordan>',
        therapist_name: 'Dr. Lee',
      },
    });

    expect(prepared.canonical).toBe(true);
    expect(prepared.subject).toBe('Hello <Jordan>');
    expect(prepared.html).toContain('Hello &lt;Jordan&gt; from Dr. Lee');
    expect(prepared.html).toContain('display:none');
    expect(prepared.text).toBe('Hello <Jordan> from Dr. Lee');
    expect(buildCampaignResendContent(prepared)).toEqual({
      subject: 'Hello <Jordan>',
      html: prepared.html,
      text: 'Hello <Jordan> from Dr. Lee',
    });
  });

  it('supplies safe runtime defaults for canonical system variables', async () => {
    const prepared = await prepareCampaignEmail({
      step: await canonicalStep({
        renderedHtml: '<p>{{unsubscribe_url}}</p><p>{{postal_address}}</p>',
        renderedText: '{{unsubscribe_url}}\n{{postal_address}}',
        preheader: null,
      }),
      values: { first_name: 'Jordan' },
    });

    expect(prepared.html).toContain('https://crm.valorwell.org/unsubscribe');
    expect(prepared.html).toContain('ValorWell, Lee’s Summit, Missouri');
    expect(prepared.text).toContain('https://crm.valorwell.org/unsubscribe');
    expect(prepared.text).toContain('ValorWell, Lee’s Summit, Missouri');
  });

  it('prefers supplied system values over runtime defaults', async () => {
    const prepared = await prepareCampaignEmail({
      step: await canonicalStep({
        renderedHtml: '<p>{{unsubscribe_url}}</p><p>{{postal_address}}</p>',
        renderedText: '{{unsubscribe_url}}\n{{postal_address}}',
        preheader: null,
      }),
      values: {
        first_name: 'Jordan',
        unsubscribe_url: 'https://example.org/unsubscribe/token',
        postal_address: '123 Main Street, Kansas City, MO',
      },
    });

    expect(prepared.html).toContain('https://example.org/unsubscribe/token');
    expect(prepared.text).toContain('123 Main Street, Kansas City, MO');
  });

  it('fails closed when canonical content is altered after hashing', async () => {
    const step = await canonicalStep();
    await expect(prepareCampaignEmail({
      step: { ...step, renderedHtml: `${step.renderedHtml}<p>changed</p>` },
      values: { first_name: 'Jordan', therapist_name: 'Dr. Lee' },
    })).rejects.toThrow('CANONICAL_RENDER_HASH_MISMATCH');
  });

  it('fails closed when a required canonical client variable is unavailable', async () => {
    await expect(prepareCampaignEmail({
      step: await canonicalStep(),
      values: { first_name: 'Jordan' },
    })).rejects.toThrow('MISSING_EMAIL_VARIABLE:therapist_name');
  });

  it('keeps legacy HTML delivery backward compatible', async () => {
    const prepared = await prepareCampaignEmail({
      step: {
        subjectTemplate: 'Hello {{first_name}}',
        renderedHtml: '<p>Legacy {{first_name}}</p>',
      },
      values: { first_name: 'Jordan' },
    });
    expect(prepared).toEqual({
      canonical: false,
      subject: 'Hello Jordan',
      html: '<p>Legacy Jordan</p>',
      preheader: null,
      renderHash: null,
      templateVersionId: null,
      schemaVersion: null,
      themeKey: null,
    });
    expect(buildCampaignResendContent(prepared)).toEqual({
      subject: 'Hello Jordan',
      html: '<p>Legacy Jordan</p>',
    });
  });

  it('preserves unknown and unavailable tokens in legacy HTML', async () => {
    const prepared = await prepareCampaignEmail({
      step: {
        subjectTemplate: 'Hello {{first_name}} {{legacy_subject_token}}',
        renderedHtml: '<p>{{organization_name}} {{therapist_name}}</p>',
      },
      values: { first_name: 'Jordan' },
    });

    expect(prepared.subject).toBe('Hello Jordan {{legacy_subject_token}}');
    expect(prepared.html).toBe('<p>{{organization_name}} {{therapist_name}}</p>');
  });

  it('adds text and HTML signatures without changing canonical metadata', async () => {
    const prepared = await prepareCampaignEmail({
      step: await canonicalStep(),
      values: { first_name: 'Jordan', therapist_name: 'Dr. Lee' },
    });
    const signed = appendSignature(prepared, { bodyHtml: '<p>Care Team</p>', bodyText: 'Care Team' });
    expect(signed.html).toContain('<p>Care Team</p>');
    expect(signed.text).toContain('Care Team');
    expect(signed.renderHash).toBe(prepared.renderHash);
  });
});
