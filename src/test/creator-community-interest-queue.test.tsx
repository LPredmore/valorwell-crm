import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import CreatorCommunityInterestQueue from '@/pages/crm/canonical/CreatorCommunityInterestQueue';
import type { InterestRecord } from '@/lib/crm/creator-community-interest';

const record: InterestRecord = {
  contact: { id: 'contact-1', tenantId: 'tenant-a', firstName: 'Morgan', lastName: 'River', preferredName: null, email: 'morgan@example.test', phone: null, state: 'MN', veteranAffiliation: 'none', outreachStatus: 'new', reviewState: 'review_needed', ownerProfileId: null, nextAction: 'Send welcome', nextActionDueAt: null, lastContactAt: null, doNotContact: false, source: 'valorwell_website_interest', sourceRecordKey: null, metadata: {}, createdAt: '2026-07-18T00:00:00Z', updatedAt: '2026-07-18T00:00:00Z' },
  profile: { contactId: 'contact-1', motivation: null, veteranConnection: null, willingToShare: null, comfortLevel: null, fundraisingGoal: null, additionalInfo: null, acceptedRules: true, highestFollowerPlatform: 'TikTok', highestFollowerCount: 12000, personalMission: 'Improve veteran access', avatarUrl: null, profileComplete: true, pastCompetitions: [], isCompeting: false, status: 'active', source: 'website', sourceRecordKey: null, metadata: {} },
  roles: [{ roleCode: 'creator', source: 'website', metadata: {} }], socials: [{ id: 'social-1', platformName: 'TikTok', handle: '@morgan', profileUrl: null, followerCount: 12000, approved: null, source: 'website', metadata: {} }], submissions: [], notes: [], owner: null,
};

vi.mock('@/hooks/crm/useCreatorCommunityInterest', () => ({
  CREATOR_INTEREST_CONFLICT_FEED_LIMIT: 25,
  useCreatorCommunityInterestQueue: () => ({
    data: {
      records: [record],
      owners: [],
      conflicts: [{
        id: 'conflict-1',
        source_record_key: 'conflict-key-1',
        status: 'reviewing',
        source_page: '/beyondtheyellow',
        payload: { email: 'conflict@example.test', first_name: 'Casey' },
        submitted_at: '2026-07-18T01:00:00Z',
      }],
    },
    isPending: false,
    error: null,
  }),
}));

describe('CreatorCommunityInterestQueue', () => {
  it('renders required queue context and a missing-avatar fallback', () => {
    render(<MemoryRouter><CreatorCommunityInterestQueue /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /Creator, Promoter & Community Interest/i })).toBeInTheDocument();
    expect(screen.getByText('Morgan River')).toBeInTheDocument();
    expect(screen.getByText('MO')).toBeInTheDocument();
    expect(screen.getByText('12,000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Morgan River/i })).toHaveAttribute('href', '/crm/creator-community-interest/contact-1');
  });

  it('applies search and review filters to the visible queue', () => {
    render(<MemoryRouter><CreatorCommunityInterestQueue /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Search by name/i), { target: { value: 'absent' } });
    expect(screen.getByText('No matching interest records')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Search by name/i), { target: { value: '@morgan' } });
    fireEvent.change(screen.getByLabelText('Review'), { target: { value: 'review_needed' } });
    expect(screen.getByText('Morgan River')).toBeInTheDocument();
  });

  it('renders an inspectable, explicitly bounded identity-conflict feed', () => {
    render(<MemoryRouter><CreatorCommunityInterestQueue /></MemoryRouter>);
    expect(screen.getByText('Recent identity conflicts')).toBeInTheDocument();
    expect(screen.getByText(/up to 25 most recent submissions/i)).toBeInTheDocument();
    expect(screen.getByText('conflict-key-1')).toBeInTheDocument();
    expect(screen.getByLabelText('Payload for conflict-key-1')).toHaveTextContent('conflict@example.test');
  });
});
