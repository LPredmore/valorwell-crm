import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTEREST_FILTERS,
  filterAndSortInterestRecords,
  isOverdue,
  type InterestRecord,
} from '@/lib/crm/creator-community-interest';

function record(overrides: Partial<InterestRecord['contact']> = {}, mission = 'Support military families', handle = '@valor'): InterestRecord {
  return {
    contact: {
      id: overrides.id ?? 'contact-1', tenantId: 'tenant-a', firstName: 'Taylor', lastName: 'Creator', preferredName: null,
      email: 'taylor@example.test', phone: null, state: 'TX', veteranAffiliation: 'family_member', outreachStatus: 'new', reviewState: 'review_needed',
      ownerProfileId: null, nextAction: null, nextActionDueAt: null, lastContactAt: null, doNotContact: false,
      source: 'valorwell_website_interest', sourceRecordKey: null, metadata: {}, createdAt: '2026-07-17T12:00:00Z', updatedAt: '2026-07-17T12:00:00Z', ...overrides,
    },
    profile: { contactId: overrides.id ?? 'contact-1', motivation: null, veteranConnection: null, willingToShare: true, comfortLevel: null, fundraisingGoal: null, additionalInfo: null, acceptedRules: true, highestFollowerPlatform: 'Instagram', highestFollowerCount: 5000, personalMission: mission, avatarUrl: null, profileComplete: true, pastCompetitions: [], isCompeting: false, status: 'active', source: 'valorwell_website_interest', sourceRecordKey: null, metadata: {} },
    roles: [{ roleCode: 'creator', source: 'website', metadata: {} }],
    socials: [{ id: 'social-1', platformName: 'Instagram', handle, profileUrl: null, followerCount: 5000, approved: null, source: 'website', metadata: {} }],
    submissions: [], notes: [], owner: null,
  };
}

describe('creator/community interest queue helpers', () => {
  it('searches name, email, handle, and personal mission', () => {
    const item = record();
    for (const search of ['Taylor', 'example.test', '@valor', 'military families']) {
      expect(filterAndSortInterestRecords([item], { ...DEFAULT_INTEREST_FILTERS, search })).toHaveLength(1);
    }
    expect(filterAndSortInterestRecords([item], { ...DEFAULT_INTEREST_FILTERS, search: 'not present' })).toHaveLength(0);
  });

  it('combines queue filters and identifies overdue work', () => {
    const due = record({ nextActionDueAt: '2026-07-10T00:00:00Z', ownerProfileId: null });
    expect(isOverdue(due, new Date('2026-07-18T00:00:00Z'))).toBe(true);
    expect(filterAndSortInterestRecords([due], { ...DEFAULT_INTEREST_FILTERS, role: 'creator', state: 'TX', veteran: 'family_member', social: 'yes', avatar: 'no', platform: 'Instagram', owner: 'unassigned', overdue: 'yes', source: 'valorwell_website_interest' }, new Date('2026-07-18T00:00:00Z'))).toEqual([due]);
  });

  it('sorts oldest unreviewed first, then supports follower, due, name, and newest sorts', () => {
    const old = record({ id: 'old', createdAt: '2026-07-01T00:00:00Z', nextActionDueAt: '2026-07-20T00:00:00Z' });
    const newer = record({ id: 'new', firstName: 'Alex', createdAt: '2026-07-10T00:00:00Z', nextActionDueAt: '2026-07-19T00:00:00Z' });
    if (newer.profile) newer.profile.highestFollowerCount = 9000;
    expect(filterAndSortInterestRecords([newer, old], { ...DEFAULT_INTEREST_FILTERS, sort: 'oldest_unreviewed' }).map((item) => item.contact.id)).toEqual(['old', 'new']);
    expect(filterAndSortInterestRecords([old, newer], { ...DEFAULT_INTEREST_FILTERS, sort: 'followers' })[0].contact.id).toBe('new');
    expect(filterAndSortInterestRecords([old, newer], { ...DEFAULT_INTEREST_FILTERS, sort: 'due' })[0].contact.id).toBe('new');
    expect(filterAndSortInterestRecords([old, newer], { ...DEFAULT_INTEREST_FILTERS, sort: 'name' })[0].contact.id).toBe('new');
    expect(filterAndSortInterestRecords([old, newer], { ...DEFAULT_INTEREST_FILTERS, sort: 'newest' })[0].contact.id).toBe('new');
  });

  it('uses latest submission history for live-source filtering and newest sorting', () => {
    const historicalThenLive = record({
      id: 'historical-live',
      source: 'therapist_crm_interest_migration',
      createdAt: '2026-01-01T00:00:00Z',
    });
    historicalThenLive.submissions = [
      { id: 'historical-raw', submissionType: 'interest_submission', normalizedLane: 'partnership_support', originalLane: 'legacy', sourceSystem: 'therapist_crm_interest_migration', sourcePage: null, status: 'migrated', payload: null, submittedAt: '2026-01-01T00:00:00Z' },
      { id: 'live-raw', submissionType: 'interest_submission', normalizedLane: 'partnership_support', originalLane: 'creator_promoter_community_interest', sourceSystem: 'valorwell_website_interest', sourcePage: '/beyondtheyellow', status: 'new', payload: null, submittedAt: '2026-07-18T12:00:00Z' },
    ];
    const newerContactButOlderSubmission = record({ id: 'newer-contact', createdAt: '2026-07-17T00:00:00Z' });

    expect(filterAndSortInterestRecords(
      [historicalThenLive, newerContactButOlderSubmission],
      { ...DEFAULT_INTEREST_FILTERS, source: 'valorwell_website_interest' },
    )).toHaveLength(2);
    expect(filterAndSortInterestRecords(
      [newerContactButOlderSubmission, historicalThenLive],
      { ...DEFAULT_INTEREST_FILTERS, sort: 'newest' },
    )[0].contact.id).toBe('historical-live');
  });

  it('sorts oldest unreviewed by the latest interest receipt, not contact creation', () => {
    const reusedOlderContact = record({
      id: 'reused-contact',
      createdAt: '2025-01-01T00:00:00Z',
    });
    reusedOlderContact.submissions = [{
      id: 'recent-interest',
      submissionType: 'interest_submission',
      normalizedLane: 'partnership_support',
      originalLane: 'creator_promoter_community_interest',
      sourceSystem: 'valorwell_website_interest',
      sourcePage: '/beyondtheyellow',
      status: 'new',
      payload: null,
      submittedAt: '2026-07-18T12:00:00Z',
    }];
    const actuallyOlderInterest = record({
      id: 'older-interest',
      createdAt: '2026-07-01T00:00:00Z',
    });

    expect(filterAndSortInterestRecords(
      [reusedOlderContact, actuallyOlderInterest],
      { ...DEFAULT_INTEREST_FILTERS, sort: 'oldest_unreviewed' },
    ).map(({ contact }) => contact.id)).toEqual(['older-interest', 'reused-contact']);
  });
});
