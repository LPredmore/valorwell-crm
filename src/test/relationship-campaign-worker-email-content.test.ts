import { describe, expect, it } from 'vitest';
import { buildRelationshipResendContent } from '../../supabase/functions/relationship-campaign-worker/email-content';

describe('relationship campaign worker email content', () => {
  it('sends canonical HTML with a plain-text fallback', () => {
    expect(buildRelationshipResendContent({
      subject: 'Partner update',
      renderedBody: 'Legacy body',
      renderedText: 'Canonical text',
      renderedHtml: '<p>Canonical HTML</p>',
    })).toEqual({
      subject: 'Partner update',
      text: 'Canonical text',
      html: '<p>Canonical HTML</p>',
    });
  });

  it('preserves legacy text-only communications', () => {
    expect(buildRelationshipResendContent({ renderedBody: 'Legacy body' })).toEqual({
      subject: 'ValorWell relationship outreach',
      text: 'Legacy body',
    });
  });
});
