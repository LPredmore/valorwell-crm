import { describe, expect, it } from 'vitest';
import { approvedSourceLanguage, canTransition, isValidValidationResult, normalizeDomain, parseCsv, relationshipReadModelKinds, type CampaignEligibilityResult, type CommunicationPersonalizationContext, type ImportConflict, type Referral } from '@/domain/relationships/contracts';
import { relationshipCapabilities } from '@/domain/relationships/capabilities';

describe('relationship domain safety', () => {
  it('does not enable uninstalled database capabilities', () => {
    expect(relationshipCapabilities().every(capability => !capability.available)).toBe(true);
  });
  it('keeps every required relationship read model inside the non-clinical domain', () => {
    expect(relationshipReadModelKinds).toEqual(expect.arrayContaining([
      'organization', 'contact', 'organization_affiliation', 'stage_history',
      'referral', 'opportunity', 'interaction', 'campaign', 'enrollment',
      'communication_log', 'reply', 'suppression', 'unsubscribe_request',
      'report_metric', 'search_result', 'actor_permissions',
    ]));
  });
  it('keeps campaign eligibility, import conflicts, and personalization in typed application contracts', () => {
    const eligibility: CampaignEligibilityResult = { eligible: false, reasons: ['suppressed'], sourceLanguage: 'none' };
    const conflict: ImportConflict = { row: 4, candidates: [], decision: 'defer' };
    const context: CommunicationPersonalizationContext = {
      contactKind: 'role_inbox', contactDisplayName: 'Partnerships team', organizationName: 'Example Org',
      senderName: 'ValorWell', postalAddress: '123 Main St', unsubscribeUrl: 'https://example.test/unsubscribe', approvedSourceLanguage: 'research',
    };
    expect(eligibility.reasons).toContain('suppressed');
    expect(conflict.decision).toBe('defer');
    expect(context.contactKind).toBe('role_inbox');
  });
  it('only treats a validation result as valid when it has no field or form errors', () => {
    expect(isValidValidationResult({ valid: true, fieldErrors: {} })).toBe(true);
    expect(isValidValidationResult({ valid: true, fieldErrors: { name: 'Required' } })).toBe(false);
    expect(isValidValidationResult({ valid: false, fieldErrors: {} })).toBe(false);
  });
  it('allows only intentional lifecycle transitions', () => {
    expect(canTransition('identified', 'qualified_outreach')).toBe(true);
    expect(canTransition('closed_no_fit', 'active')).toBe(false);
  });
  it('prevents unverified and internal referral claims', () => {
    const internal: Referral = {
      id: '1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      sourceCategory: 'client', summary: 'private', verified: true, disclosure: 'internal', evidenceUrls: [],
    };
    expect(approvedSourceLanguage(internal)).toBe('none');
    expect(approvedSourceLanguage({ ...internal, disclosure: 'named_referrer', namedReferrer: 'Pat' })).toBe('verified_named');
  });
  it('parses a safe import preview and requires organization_name', () => {
    expect(parseCsv('organization_name,website\nValorWell,https://www.valorwell.org').rows).toHaveLength(1);
    expect(parseCsv('name\nValorWell').errors).toContain('Required header: organization_name.');
    expect(normalizeDomain(' https://www.Example.org/hello ')).toBe('example.org');
  });

  it('parses quoted CSV values with commas and escaped quotes', () => {
    const withCommas = parseCsv('organization_name,summary\nValorWell,"A, B, C"');
    expect(withCommas.rows).toEqual([{ organization_name: 'ValorWell', summary: 'A, B, C' }]);

    const withEscapedQuotes = parseCsv('organization_name,summary\nValorWell,"She said ""hello"""');
    expect(withEscapedQuotes.rows).toEqual([{ organization_name: 'ValorWell', summary: 'She said "hello"' }]);
  });
});
