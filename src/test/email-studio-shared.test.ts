import { describe, expect, it } from 'vitest';
import type { EmailEditorDocument } from '@/features/email-studio/contracts';
import {
  EMAIL_STUDIO_THEME_KEYS,
  getEmailStudioBlocksForMode,
} from '@/features/email-studio/studio/config';
import {
  createEmailStudioBlockNodeByKind,
  createEmailStudioDocument,
  createEmailStudioPresetDocument,
} from '@/features/email-studio/studio/documents';
import {
  isSafeEmailUrl,
  validateEmailStudioEditorDocument,
} from '@/features/email-studio/studio/validation';

describe('shared Email Studio', () => {
  it('exposes the four approved themes', () => {
    expect(EMAIL_STUDIO_THEME_KEYS).toEqual(['valorwell', 'ocs', 'bty', 'plain-outreach']);
  });

  it('restricts the block library by authoring mode', () => {
    const direct = getEmailStudioBlocksForMode('direct').map((block) => block.kind);
    const campaign = getEmailStudioBlocksForMode('campaign').map((block) => block.kind);
    const newsletter = getEmailStudioBlocksForMode('newsletter').map((block) => block.kind);

    expect(direct).toEqual(expect.arrayContaining(['text', 'callout', 'divider']));
    expect(direct).not.toContain('hero');
    expect(campaign).toContain('hero');
    expect(campaign).not.toContain('stats');
    expect(newsletter).toEqual(expect.arrayContaining(['stats', 'clinician-spotlight', 'social-footer']));
  });

  it('creates valid starter documents for every authoring mode', () => {
    const direct = createEmailStudioDocument({ mode: 'direct', scope: 'client' });
    const campaign = createEmailStudioDocument({ mode: 'campaign', scope: 'relationship' });
    const newsletter = createEmailStudioDocument({ mode: 'newsletter', scope: 'client' });

    expect(validateEmailStudioEditorDocument(direct, 'direct', 'client').valid).toBe(true);
    expect(validateEmailStudioEditorDocument(campaign, 'campaign', 'relationship').valid).toBe(true);
    expect(validateEmailStudioEditorDocument(newsletter, 'newsletter', 'client').valid).toBe(true);
  });

  it('keeps client and relationship starter variables isolated', () => {
    const client = JSON.stringify(createEmailStudioPresetDocument('personal-follow-up', 'client').document);
    const relationship = JSON.stringify(createEmailStudioPresetDocument('personal-follow-up', 'relationship').document);

    expect(client).toContain('first_name');
    expect(client).not.toContain('contact_first_name');
    expect(relationship).toContain('contact_first_name');
  });

  it('blocks a newsletter-only block in direct mode', () => {
    const document: EmailEditorDocument = {
      type: 'doc',
      content: [createEmailStudioBlockNodeByKind('stats', 'valorwell')],
    };

    const validation = validateEmailStudioEditorDocument(document, 'direct', 'client');
    expect(validation.valid).toBe(false);
    expect(validation.errors.map((issue) => issue.code)).toContain('block_not_allowed_in_mode');
  });

  it('requires compliance content for newsletters and relationship campaigns', () => {
    const document: EmailEditorDocument = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    };

    const newsletter = validateEmailStudioEditorDocument(document, 'newsletter', 'client');
    const relationshipCampaign = validateEmailStudioEditorDocument(document, 'campaign', 'relationship');
    const clientCampaign = validateEmailStudioEditorDocument(document, 'campaign', 'client');

    expect(newsletter.errors.map((issue) => issue.code)).toContain('missing_compliance_footer');
    expect(relationshipCampaign.errors.map((issue) => issue.code)).toContain('missing_compliance_footer');
    expect(clientCampaign.valid).toBe(true);
    expect(clientCampaign.warnings.map((issue) => issue.code)).toContain('recommended_compliance_footer');
  });

  it('rejects unsafe block URLs and images without alt text', () => {
    const document: EmailEditorDocument = {
      type: 'doc',
      content: [
        {
          type: 'emailStudioBlock',
          attrs: {
            kind: 'hero',
            title: 'Unsafe hero',
            body: 'Test',
            href: 'javascript:alert(1)',
            imageUrl: 'https://example.com/image.png',
            altText: '',
            themeKey: 'valorwell',
          },
        },
        createEmailStudioBlockNodeByKind('compliance-footer', 'valorwell'),
      ],
    };

    const validation = validateEmailStudioEditorDocument(document, 'newsletter', 'client');
    expect(validation.valid).toBe(false);
    expect(validation.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['unsafe_block_url', 'missing_image_alt_text']),
    );
  });

  it('allows only email-safe URL protocols', () => {
    expect(isSafeEmailUrl('https://valorwell.org')).toBe(true);
    expect(isSafeEmailUrl('mailto:hello@valorwell.org')).toBe(true);
    expect(isSafeEmailUrl('mailto:hello@valorwell.org', { image: true })).toBe(false);
    expect(isSafeEmailUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeEmailUrl('data:text/html,hello')).toBe(false);
  });
});
