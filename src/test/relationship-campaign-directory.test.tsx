import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RelationshipCampaignDirectoryPage from '@/pages/crm/business-development/campaigns/RelationshipCampaignDirectoryPage';
import { capabilityState } from '@/domain/relationships/capabilities';

const useRelationshipCapability = vi.fn();
const useRelationshipCampaignDirectory = vi.fn();

vi.mock('@/hooks/relationships/useRelationshipCapabilities', () => ({
  useRelationshipCapability: (...args: unknown[]) => useRelationshipCapability(...args),
}));
vi.mock('@/hooks/relationships/useRelationshipCampaignDirectory', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/hooks/relationships/useRelationshipCampaignDirectory')>();
  return { ...original, useRelationshipCampaignDirectory: (...args: unknown[]) => useRelationshipCampaignDirectory(...args) };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <RelationshipCampaignDirectoryPage />
    </MemoryRouter>
  );
}

describe('RelationshipCampaignDirectoryPage', () => {
  beforeEach(() => {
    useRelationshipCapability.mockReset();
    useRelationshipCampaignDirectory.mockReset();
  });

  it('keeps campaign directory controls visible while the relationship capability is pending', () => {
    useRelationshipCapability.mockReturnValue({ capability: capabilityState('campaigns', 'pending'), isLoading: false, isError: false, refetch: vi.fn() });
    useRelationshipCampaignDirectory.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });

    renderPage();

    expect(screen.getByRole('textbox', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByText('Directory ready for database support')).toBeInTheDocument();
    expect(screen.queryByText('Relationship campaign results')).not.toBeInTheDocument();
  });

  it('renders campaign results and relationship metrics when capability support is available', () => {
    useRelationshipCapability.mockReturnValue({ capability: capabilityState('campaigns', 'available'), isLoading: false, isError: false, refetch: vi.fn() });
    useRelationshipCampaignDirectory.mockReturnValue({
      data: {
        items: [{
          id: 'camp-1',
          name: 'Spring launch',
          purpose: 'Invite new prospects to a community event.',
          initiative: 'BTY',
          ownerId: 'owner-1',
          senderName: 'Tina',
          senderEmail: 'tina@example.com',
          status: 'active',
          steps: [],
          enrollmentCount: 12,
          replyCount: 3,
          suppressionCount: 1,
          errorCount: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }],
        total: 1,
        page: 1,
        pageSize: 25,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText('Relationship campaign results')).toBeInTheDocument();
    expect(screen.getByText('Spring launch')).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getByText('Enrollment')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Replies')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders a truthful empty state when the capability is available but no campaigns match the current filters', () => {
    useRelationshipCapability.mockReturnValue({ capability: capabilityState('campaigns', 'available'), isLoading: false, isError: false, refetch: vi.fn() });
    useRelationshipCampaignDirectory.mockReturnValue({
      data: { items: [], total: 0, page: 1, pageSize: 25 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText('No relationship campaigns match the current filters.')).toBeInTheDocument();
    expect(screen.getByText('0 matching relationship campaigns.')).toBeInTheDocument();
  });
});
