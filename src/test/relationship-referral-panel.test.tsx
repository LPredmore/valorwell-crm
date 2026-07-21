import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RelationshipReferralPanel } from '@/components/crm/relationships/RelationshipReferralPanel';
import { capabilityState } from '@/domain/relationships/capabilities';

const { relationships, useRelationshipCapability } = vi.hoisted(() => ({
  relationships: {
    listReferrals: vi.fn(),
    createReferral: vi.fn(),
    updateReferral: vi.fn(),
    verifyReferral: vi.fn(),
    revokeReferral: vi.fn(),
  },
  useRelationshipCapability: vi.fn(),
}));

vi.mock('@/services/dataProvider', () => ({ dataProvider: { relationships } }));
vi.mock('@/hooks/relationships/useRelationshipCapabilities', () => ({
  useRelationshipCapability: (...args: unknown[]) => useRelationshipCapability(...args),
}));

const referral = {
  id: 'referral-1',
  organizationId: 'org-1',
  sourceCategory: 'community_referral',
  summary: 'Recommended by a community member.',
  evidenceUrls: ['https://example.org/evidence'],
  verified: false,
  disclosure: 'community_anonymous' as const,
  createdAt: '2026-07-21T19:00:00.000Z',
  updatedAt: '2026-07-21T19:00:00.000Z',
};

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RelationshipReferralPanel subject={{ organizationId: 'org-1' }} entityLabel="Veterans Forward" />
    </QueryClientProvider>,
  );
}

describe('RelationshipReferralPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRelationshipCapability.mockReturnValue({
      capability: capabilityState('referrals', 'available'),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    relationships.listReferrals.mockResolvedValue([referral]);
    relationships.createReferral.mockResolvedValue(referral);
    relationships.updateReferral.mockResolvedValue(referral);
    relationships.verifyReferral.mockResolvedValue({
      ...referral,
      verified: true,
      verifiedAt: '2026-07-21T20:00:00.000Z',
      verifiedBy: 'profile-1',
    });
    relationships.revokeReferral.mockResolvedValue({
      ...referral,
      verified: true,
      revokedAt: '2026-07-21T21:00:00.000Z',
    });
  });

  it('loads persisted referral evidence without treating it as verified', async () => {
    renderPanel();
    expect(await screen.findByText('Recommended by a community member.')).toBeInTheDocument();
    expect(screen.getByText('Unverified')).toBeInTheDocument();
    expect(screen.getByText('Source language: none')).toBeInTheDocument();
    expect(relationships.listReferrals).toHaveBeenCalledWith({ organizationId: 'org-1' });
  });

  it('validates and creates referral evidence for the current subject', async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Source summary'), {
      target: { value: 'Introduced by a local veteran organization.' },
    });
    fireEvent.change(screen.getByLabelText('Evidence URLs'), {
      target: { value: 'https://example.org/source' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record referral evidence' }));

    await waitFor(() => expect(relationships.createReferral).toHaveBeenCalledWith({
      organizationId: 'org-1',
      sourceCategory: 'community_referral',
      summary: 'Introduced by a local veteran organization.',
      evidenceUrls: ['https://example.org/source'],
      verified: false,
      disclosure: 'internal',
      namedReferrer: undefined,
      notes: '',
    }));
  });

  it('saves disclosure details before server-authoritative verification', async () => {
    renderPanel();
    await screen.findByText('Recommended by a community member.');
    fireEvent.click(screen.getByRole('button', { name: 'Verify referral' }));

    await waitFor(() => expect(relationships.updateReferral).toHaveBeenCalledWith('referral-1', {
      disclosure: 'community_anonymous',
      namedReferrer: undefined,
      notes: '',
    }));
    await waitFor(() => expect(relationships.verifyReferral).toHaveBeenCalledWith(
      'referral-1',
      expect.objectContaining({
        verified: true,
        disclosure: 'community_anonymous',
      }),
    ));
  });
});