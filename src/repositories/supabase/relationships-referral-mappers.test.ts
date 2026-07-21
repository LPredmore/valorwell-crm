import { describe, expect, it } from 'vitest';
import {
  buildReferralInsert,
  buildReferralUpdate,
  mapReferralRow,
  normalizeEvidenceUrls,
  type RelationshipReferralRow,
} from './relationships-referral-mappers';

const row: RelationshipReferralRow = {
  id: 'referral-1',
  tenant_id: 'tenant-1',
  organization_id: 'organization-1',
  contact_id: null,
  source_category: 'community_referral',
  summary: 'Recommended by a community member.',
  evidence_urls: ['https://example.org/evidence'],
  verified: true,
  verified_at: '2026-07-21T20:00:00.000Z',
  verified_by_profile_id: 'profile-1',
  revoked_at: null,
  disclosure: 'community_anonymous',
  named_referrer: null,
  notes: 'Reviewed.',
  metadata: {},
  created_by_profile_id: 'profile-1',
  updated_by_profile_id: 'profile-1',
  created_at: '2026-07-21T19:00:00.000Z',
  updated_at: '2026-07-21T20:00:00.000Z',
};

describe('relationship referral persistence mappers', () => {
  it('normalizes and deduplicates evidence URLs', () => {
    expect(normalizeEvidenceUrls([
      ' https://example.org/evidence ',
      'https://example.org/evidence',
    ])).toEqual(['https://example.org/evidence']);
  });

  it('rejects non-http evidence URLs', () => {
    expect(() => normalizeEvidenceUrls(['ftp://example.org/evidence'])).toThrow(/HTTP or HTTPS/);
  });

  it('creates an unverified tenant-scoped referral with actor attribution', () => {
    expect(buildReferralInsert('tenant-1', 'profile-1', {
      organizationId: 'organization-1',
      sourceCategory: ' community_referral ',
      summary: ' Recommended by a community member. ',
      evidenceUrls: ['https://example.org/evidence'],
      verified: false,
      disclosure: 'community_anonymous',
    })).toEqual({
      tenant_id: 'tenant-1',
      organization_id: 'organization-1',
      contact_id: null,
      source_category: 'community_referral',
      summary: 'Recommended by a community member.',
      evidence_urls: ['https://example.org/evidence'],
      verified: false,
      disclosure: 'community_anonymous',
      named_referrer: null,
      notes: null,
      created_by_profile_id: 'profile-1',
      updated_by_profile_id: 'profile-1',
    });
  });

  it('requires verification changes to use the verification workflow', () => {
    expect(() => buildReferralUpdate('profile-1', { verified: true })).toThrow(/verification workflow/);
  });

  it('maps database rows into the stable referral contract', () => {
    expect(mapReferralRow(row)).toMatchObject({
      id: 'referral-1',
      organizationId: 'organization-1',
      sourceCategory: 'community_referral',
      verified: true,
      verifiedBy: 'profile-1',
      disclosure: 'community_anonymous',
      createdBy: 'profile-1',
    });
  });
});