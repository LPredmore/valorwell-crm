import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BusinessDevelopmentDashboard from '@/pages/crm/business-development/BusinessDevelopmentDashboard';
import BusinessDevelopmentArchitecture from '@/pages/crm/BusinessDevelopmentArchitecture';
import { relationshipCapabilities } from '@/domain/relationships/capabilities';
import { RELATIONSHIP_ARCHITECTURE_FALLBACK } from '@/lib/crm/relationship-architecture';

const useRelationshipCapabilities = vi.fn();
const useRelationshipReleaseContract = vi.fn();
const listReportMetrics = vi.fn();

vi.mock('@/hooks/relationships/useRelationshipCapabilities', () => ({
  useRelationshipCapabilities: () => useRelationshipCapabilities(),
}));

vi.mock('@/hooks/relationships/useRelationshipReleaseContract', () => ({
  useRelationshipReleaseContract: () => useRelationshipReleaseContract(),
}));

vi.mock('@/services/dataProvider', () => ({
  dataProvider: {
    relationships: {
      listReportMetrics: (...args: unknown[]) => listReportMetrics(...args),
    },
  },
}));

const acceptedLockedContract = {
  ...RELATIONSHIP_ARCHITECTURE_FALLBACK,
  implementation_status: 'production_hardened',
  release_status: 'accepted' as const,
  activation_status: 'locked' as const,
  schema_fingerprint: 'abcdef1234567890abcdef1234567890',
  generated_type_hash: 'typehash',
  accepted_at: '2026-07-22T22:45:00Z',
  activation_blockers: [
    'delivery_provider_not_configured',
    'pilot_campaign_not_approved',
  ],
};

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><BusinessDevelopmentDashboard /></MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderStatus() {
  return render(<MemoryRouter><BusinessDevelopmentArchitecture /></MemoryRouter>);
}

describe('Business Development dashboard and system status', () => {
  beforeEach(() => {
    listReportMetrics.mockReset();
    useRelationshipCapabilities.mockReturnValue({
      data: relationshipCapabilities(),
      isLoading: false,
      isError: false,
    });
    useRelationshipReleaseContract.mockReturnValue({
      data: acceptedLockedContract,
      isLoading: false,
      isError: false,
    });
  });

  it('shows unavailable metrics rather than misleading zero values while reporting is pending', () => {
    renderDashboard();
    expect(screen.getByText('Organizations needing review')).toBeInTheDocument();
    expect(screen.getAllByText(/Database support pending; no relationship data is read or written/).length).toBeGreaterThan(0);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(listReportMetrics).not.toHaveBeenCalled();
  });

  it('displays verified numeric zero values when reporting is available', async () => {
    useRelationshipCapabilities.mockReturnValue({
      data: relationshipCapabilities({ reporting: 'available' }),
      isLoading: false,
      isError: false,
    });
    listReportMetrics.mockResolvedValue([
      { key: 'organizations_needing_review', label: 'Organizations needing review', value: 0 },
      { key: 'opportunities_needing_qualification', label: 'BTY opportunities needing qualification', value: 0 },
      { key: 'overdue_next_actions', label: 'Overdue next actions', value: 0 },
      { key: 'unassigned_relationships', label: 'Unassigned relationships', value: 87 },
      { key: 'active_outreach_campaigns', label: 'Active outreach campaigns', value: 0 },
      { key: 'replies_requiring_staff_action', label: 'Replies requiring staff action', value: 0 },
      { key: 'import_conflicts', label: 'Import conflicts', value: 0 },
      { key: 'recently_updated_relationships', label: 'Recently updated relationships', value: 87 },
    ]);
    renderDashboard();
    expect((await screen.findAllByText('0')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('87').length).toBeGreaterThan(0);
    expect(screen.queryByText(/this metric will appear after its integration is verified/i)).not.toBeInTheDocument();
  });

  it('separates final implementation acceptance from production activation', () => {
    renderStatus();
    expect(screen.getByText('Implementation accepted')).toBeInTheDocument();
    expect(screen.getByText('Implementation accepted; production delivery locked')).toBeInTheDocument();
    expect(screen.getByText('Production activation')).toBeInTheDocument();
    expect(screen.getByText('No-go / locked')).toBeInTheDocument();
    expect(screen.getByText('Delivery Provider Not Configured')).toBeInTheDocument();
    expect(screen.getByText('Pilot Campaign Not Approved')).toBeInTheDocument();
    expect(screen.getByText('Canonical database')).toBeInTheDocument();
  });

  it('does not claim acceptance when the live contract is unavailable', () => {
    useRelationshipReleaseContract.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderStatus();
    expect(screen.getByText('The live release contract could not be loaded. Production activation remains locked.')).toBeInTheDocument();
    expect(screen.getByText('Not accepted')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });

  it('keeps database-dependent functions disabled when the capability snapshot cannot be loaded', () => {
    useRelationshipCapabilities.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderStatus();
    expect(screen.getByText(/Capability status could not be loaded/)).toBeInTheDocument();
    expect(screen.getByText('Capabilities verified')).toBeInTheDocument();
    expect(screen.getByText('Not verified')).toBeInTheDocument();
  });
});
