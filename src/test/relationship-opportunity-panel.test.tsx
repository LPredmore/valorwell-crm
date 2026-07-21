import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RelationshipOpportunityPanel } from '@/components/crm/relationships/RelationshipOpportunityPanel';
import { capabilityState } from '@/domain/relationships/capabilities';

const { relationships, useRelationshipCapability } = vi.hoisted(() => ({
  relationships: {
    listOpportunities: vi.fn(),
    createOpportunity: vi.fn(),
  },
  useRelationshipCapability: vi.fn(),
}));

vi.mock('@/services/dataProvider', () => ({ dataProvider: { relationships } }));
vi.mock('@/hooks/relationships/useRelationshipCapabilities', () => ({
  useRelationshipCapability: (...args: unknown[]) => useRelationshipCapability(...args),
}));

const opportunity = {
  id: 'opportunity-1',
  organizationId: 'organization-1',
  status: 'identified' as const,
  causeArea: 'veteran mental health',
  veteranPriority: true,
  qualification: { mission_fit: true },
  nextAction: 'Research audience fit',
  createdAt: '2026-07-21T20:00:00.000Z',
  updatedAt: '2026-07-21T20:00:00.000Z',
};

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <RelationshipOpportunityPanel
          organizationId="organization-1"
          entityLabel="Veterans Forward"
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('RelationshipOpportunityPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRelationshipCapability.mockReturnValue({
      capability: capabilityState('opportunities', 'available'),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    relationships.listOpportunities.mockResolvedValue({
      items: [opportunity],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    relationships.createOpportunity.mockResolvedValue(opportunity);
  });

  it('loads linked opportunities from the typed repository', async () => {
    renderPanel();
    expect(await screen.findByText('veteran mental health')).toBeInTheDocument();
    expect(screen.getByText('Identified')).toBeInTheDocument();
    expect(relationships.listOpportunities).toHaveBeenCalledWith({
      organizationIds: ['organization-1'],
      contactIds: undefined,
      page: 1,
      pageSize: 100,
      sortBy: 'updatedAt',
      sortDirection: 'desc',
    });
  });

  it('creates a new identified opportunity with parsed qualification evidence', async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Cause area'), {
      target: { value: 'claims education' },
    });
    fireEvent.change(screen.getByLabelText('Next action'), {
      target: { value: 'Research creator fit' },
    });
    fireEvent.change(screen.getByLabelText('Qualification evidence'), {
      target: { value: 'mission_fit=true\naudience_reach=4' },
    });
    fireEvent.click(screen.getByLabelText('Veteran-priority opportunity'));
    fireEvent.click(screen.getByRole('button', { name: 'Create opportunity' }));

    await waitFor(() => expect(relationships.createOpportunity).toHaveBeenCalledWith({
      organizationId: 'organization-1',
      primaryContactId: undefined,
      status: 'identified',
      veteranPriority: true,
      causeArea: 'claims education',
      qualification: { mission_fit: true, audience_reach: 4 },
      nextAction: 'Research creator fit',
      nextActionDueAt: undefined,
    }));
  });
});
