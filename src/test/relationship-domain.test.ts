import { describe, expect, it } from 'vitest';
import { approvedSourceLanguage, canTransition, normalizeDomain, parseCsv, relationshipReadModelKinds, type Referral } from '@/domain/relationships/contracts';
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
  it('allows only intentional lifecycle transitions', () => {
    expect(canTransition('identified', 'qualified_outreach')).toBe(true);
    expect(canTransition('closed_no_fit', 'active')).toBe(false);
  });
  it('prevents unverified and internal referral claims', () => {
    const internal: Referral = { id: '1', sourceCategory: 'client', summary: 'private', verified: true, disclosure: 'internal' };
    expect(approvedSourceLanguage(internal)).toBe('none');
    expect(approvedSourceLanguage({ ...internal, disclosure: 'named_referrer', namedReferrer: 'Pat' })).toBe('verified_named');
  });
  it('parses a safe import preview and requires organization_name', () => {
    expect(parseCsv('organization_name,website\nValorWell,https://www.valorwell.org').rows).toHaveLength(1);
    expect(parseCsv('name\nValorWell').errors).toContain('Required header: organization_name.');
    expect(normalizeDomain(' https://www.Example.org/hello ')).toBe('example.org');
  });
});
