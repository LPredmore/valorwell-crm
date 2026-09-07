import { describe, expect, it } from 'vitest';
import type { EmailContentDocument } from '@/features/email-studio/contracts';
import {
  NEWSLETTER_AUDIENCE_DOMAINS,
  buildCanonicalNewsletterUpsertArgs,
  buildScheduleNewsletterArgs,
  newsletterDetailToContent,
  type NewsletterDetail,
} from '@/lib/crm/newsletter-control-plane';

const content: EmailContentDocument = {
  schemaVersion: 1,
  mode: 'newsletter',
  editorDocument: { type: 'doc', content: [] },
  renderedHtml: '<p>Hello</p>',
  renderedText: 'Hello',
  preheader: 'Preview',
  themeKey: 'valorwell',
  renderHash: 'fnv1a32:1234abcd',
};

const detail: NewsletterDetail = {
  id: 'newsletter-1',
  name: 'Weekly update',
  subject: 'This week at ValorWell',
  preheader: content.preheader,
  bodyHtml: content.renderedHtml,
  bodyText: content.renderedText,
  editorDocument: content.editorDocument,
  schemaVersion: content.schemaVersion,
  themeKey: content.themeKey,
  renderHash: content.renderHash,
  templateVersionId: null,
  canonical: true,
  audienceDomains: ['client', 'staff'],
  status: 'draft',
  scheduledAt: null,
  startedAt: null,
  completedAt: null,
  updatedAt: '2026-09-07T12:00:00.000Z',
  recipientCounts: {},
};

describe('canonical newsletter control plane', () => {
  it('exposes only audiences accepted by the canonical newsletter RPC', () => {
    expect(NEWSLETTER_AUDIENCE_DOMAINS).toEqual(['client', 'staff', 'donor', 'bty']);
  });

  it('maps Email Studio content to the canonical newsletter upsert contract without rewriting it', () => {
    expect(buildCanonicalNewsletterUpsertArgs({
      newsletterId: null,
      name: 'Weekly update',
      subject: 'This week at ValorWell',
      content,
      audienceDomains: ['client', 'donor'],
      reason: 'Prepare weekly newsletter',
    })).toEqual({
      p_newsletter_id: null,
      p_name: 'Weekly update',
      p_subject: 'This week at ValorWell',
      p_content: content,
      p_audience_domains: ['client', 'donor'],
      p_reason: 'Prepare weekly newsletter',
      p_template_version_id: null,
    });
  });

  it('uses a null schedule timestamp for the server-authoritative Send now path', () => {
    expect(buildScheduleNewsletterArgs({
      newsletterId: 'newsletter-1',
      reason: 'Send approved newsletter',
    })).toEqual({
      p_newsletter_id: 'newsletter-1',
      p_scheduled_at: null,
      p_reason: 'Send approved newsletter',
    });
  });

  it('reconstructs canonical Email Studio content from a stored draft', () => {
    expect(newsletterDetailToContent(detail)).toEqual(content);
  });

  it('refuses to reconstruct an incomplete or legacy newsletter as canonical Email Studio content', () => {
    expect(newsletterDetailToContent({ ...detail, canonical: false })).toBeNull();
    expect(newsletterDetailToContent({ ...detail, editorDocument: null })).toBeNull();
    expect(newsletterDetailToContent({ ...detail, renderHash: null })).toBeNull();
  });
});
