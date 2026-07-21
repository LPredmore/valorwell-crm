import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RelationshipLifecyclePanel } from '@/components/crm/relationships/RelationshipLifecyclePanel';
import { capabilityState } from '@/domain/relationships/capabilities';

const { relationships, useRelationshipCapability } = vi.hoisted(() => ({
  relationships: {
    listStageHistory: vi.fn(),
    listInteractions: vi.fn(),
    transitionStage: vi.fn(),
    createInteraction: vi.fn(),
  },
  useRelationshipCapability: vi.fn(),
}));

vi.mock('@/services/dataProvider', () => ({
  dataProvider: { relationships },
}));

vi.mock('@/hooks/relationships/useRelationshipCapabilities', () => ({
  useRelationshipCapability: (...args: unknown[]) => useRelationshipCapability(...args),
}));

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RelationshipLifecyclePanel
        subject={{ organizationId: 'org-1' }}
        currentStage="identified"
        entityLabel="Veterans Forward"
      />
    </QueryClientProvider>,
  );
}

describe('RelationshipLifecyclePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRelationshipCapability.mockReturnValue({
      capability: capabilityState('interactions', 'available'),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    relationships.listStageHistory.mockResolvedValue([
      {
        id: 'history-1',
        organizationId: 'org-1',
        from: 'identified',
        to: 'qualified_outreach',
        changedAt: '2026-07-21T12:00:00.000Z',
        reason: 'Research confirms a strong fit.',
        createdAt: '2026-07-21T12:00:00.000Z',
        updatedAt: '2026-07-21T12:00:00.000Z',
      },
    ]);
    relationships.listInteractions.mockResolvedValue({
      items: [
        {
          id: 'interaction-1',
          organizationId: 'org-1',
          type: 'manual_note',
          occurredAt: '2026-07-21T13:00:00.000Z',
          summary: 'Confirmed the primary contact.',
          createdAt: '2026-07-21T13:00:00.000Z',
          updatedAt: '2026-07-21T13:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    relationships.transitionStage.mockResolvedValue({
      id: 'history-2',
      organizationId: 'org-1',
      from: 'identified',
      to: 'qualified_outreach',
      changedAt: '2026-07-21T14:00:00.000Z',
      reason: 'Ready for outreach.',
      createdAt: '2026-07-21T14:00:00.000Z',
      updatedAt: '2026-07-21T14:00:00.000Z',
    });
    relationships.createInteraction.mockResolvedValue({
      id: 'interaction-2',
      organizationId: 'org-1',
      type: 'meeting',
      occurredAt: '2026-07-21T15:00:00.000Z',
      summary: 'Discussed next steps.',
      createdAt: '2026-07-21T15:00:00.000Z',
      updatedAt: '2026-07-21T15:00:00.000Z',
    });
  });

  it('loads stage history and relationship interactions', async () => {
    renderPanel();
    expect(await screen.findByText('Research confirms a strong fit.')).toBeInTheDocument();
    expect(await screen.findByText('Confirmed the primary contact.')).toBeInTheDocument();
    expect(relationships.listStageHistory).toHaveBeenCalledWith({ organizationId: 'org-1' });
    expect(relationships.listInteractions).toHaveBeenCalledWith(
      { organizationId: 'org-1' },
      { page: 1, pageSize: 50 },
    );
  });

  it('requires an audit reason before changing lifecycle stage', async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Next stage'), {
      target: { value: 'qualified_outreach' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change lifecycle stage' }));
    expect(await screen.findByText('Record a reason for the lifecycle change.')).toBeInTheDocument();
    expect(relationships.transitionStage).not.toHaveBeenCalled();
  });

  it('executes an allowed stage transition and records a manual interaction', async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Next stage'), {
      target: { value: 'qualified_outreach' },
    });
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Ready for outreach.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change lifecycle stage' }));

    await waitFor(() => expect(relationships.transitionStage).toHaveBeenCalledWith({
      subject: { organizationId: 'org-1' },
      to: 'qualified_outreach',
      reason: 'Ready for outreach.',
    }));

    fireEvent.change(screen.getByLabelText('Interaction type'), {
      target: { value: 'meeting' },
    });
    fireEvent.change(screen.getByLabelText('Occurred at'), {
      target: { value: '2026-07-21T15:00' },
    });
    fireEvent.change(screen.getByLabelText('Summary'), {
      target: { value: 'Discussed next steps.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record interaction' }));

    await waitFor(() => expect(relationships.createInteraction).toHaveBeenCalledWith({
      organizationId: 'org-1',
      type: 'meeting',
      occurredAt: new Date('2026-07-21T15:00').toISOString(),
      summary: 'Discussed next steps.',
    }));
  });
});
