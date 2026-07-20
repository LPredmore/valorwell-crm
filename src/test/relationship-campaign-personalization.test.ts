import { describe, expect, it } from 'vitest';
import { resolveRelationshipCampaignPersonalization } from '@/services/relationships/personalization';
import type { CommunicationPersonalizationContext, Referral } from '@/domain/relationships/contracts';

const context: CommunicationPersonalizationContext = {
  contactKind: 'person',
  contactFirstName: 'Mina',
  contactDisplayName: 'Mina Rivera',
  organizationName: 'ValorWell Partners',
  organizationType: 'nonprofit',
  realActionSummary: 'Hosted a volunteer orientation',
  causeArea: 'veteran services',
  opportunityContext: 'A proven fit for community outreach',
  senderName: 'Tina',
  postalAddress: '123 Main St',
  unsubscribeUrl: 'https://example.test/unsubscribe',
  approvedSourceLanguage: 'research',
};

describe('relationship campaign personalization', () => {
  it('resolves the approved relationship variables and leaves unresolved placeholders intact', () => {
    const result = resolveRelationshipCampaignPersonalization(
      'Hello {{contact_first_name}} from {{organization_name}}. {{unknown_variable}}',
      context,
    );

    expect(result.rendered).toContain('Hello Mina from ValorWell Partners.');
    expect(result.rendered).toContain('{{unknown_variable}}');
    expect(result.unresolvedVariables).toEqual(['{{unknown_variable}}']);
  });

  it('renders named contacts and role inboxes safely with the same resolver', () => {
    const named = resolveRelationshipCampaignPersonalization('Hi {{contact_display_name}}', context);
    const roleInbox = resolveRelationshipCampaignPersonalization('Hi {{contact_display_name}}', {
      ...context,
      contactKind: 'role_inbox',
      contactDisplayName: 'partnerships@example.com',
      contactFirstName: undefined,
    });

    expect(named.rendered).toBe('Hi Mina Rivera');
    expect(roleInbox.rendered).toBe('Hi partnerships@example.com');
    expect(roleInbox.unresolvedVariables).toEqual([]);
  });

  it('uses the approved source-language sentence and blocks direct referral-claim variables', () => {
    const referral: Referral = {
      id: 'ref-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sourceCategory: 'community',
      summary: 'Shared by a partner',
      evidenceUrls: [],
      verified: true,
      disclosure: 'community_anonymous',
    };

    const result = resolveRelationshipCampaignPersonalization(
      'We heard {{approved_source_sentence}} and also {{referral_claim}}',
      context,
      referral,
    );

    expect(result.rendered).toContain('A verified community recommendation brought your work to our attention.');
    expect(result.rendered).toContain('{{referral_claim}}');
    expect(result.blockedClaims).toEqual(['Blocked referral-claim variable: {{referral_claim}}']);
  });

  it('reports missing optional variables safely without using raw client information', () => {
    const result = resolveRelationshipCampaignPersonalization(
      'Hello {{contact_first_name}} from {{organization_name}}. {{organization_type}} {{cause_area}}',
      { ...context, organizationType: undefined, causeArea: undefined },
    );

    expect(result.rendered).toContain('Hello Mina from ValorWell Partners.');
    expect(result.rendered).toContain('{{organization_type}}');
    expect(result.rendered).toContain('{{cause_area}}');
    expect(result.unresolvedVariables).toEqual(['{{organization_type}}', '{{cause_area}}']);
  });

  it('handles mixed-case placeholders by normalizing them before allowlist checks', () => {
    const result = resolveRelationshipCampaignPersonalization('Hello {{CONTACT_FIRST_NAME}} from {{ORGANIZATION_NAME}} and {{Unknown_VAR}}', context);

    expect(result.rendered).toBe('Hello Mina from ValorWell Partners and {{Unknown_VAR}}');
    expect(result.unresolvedVariables).toEqual(['{{Unknown_VAR}}']);
  });
});
