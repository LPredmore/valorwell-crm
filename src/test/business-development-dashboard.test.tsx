import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BusinessDevelopmentDashboard from '@/pages/crm/business-development/BusinessDevelopmentDashboard';
import BusinessDevelopmentArchitecture from '@/pages/crm/BusinessDevelopmentArchitecture';
import { relationshipCapabilities } from '@/domain/relationships/capabilities';

const useRelationshipCapabilities = vi.fn();
const listReportMetrics = vi.fn();

vi.mock('@/hooks/relationships/useRelationshipCapabilities', () => ({
  useRelationshipCapabilities: () => useRelationshipCapabilities(),
}));

vi.mock('@/services/dataProvider', () => ({
  dataProvider: {
    relationships: {
      listReportMetrics: (...args: unknown[]) => listReportMetrics(...args),
    },
  },
}));

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

  it('separates accepted implementation from held outbound activation', () => {
    renderStatus();
    expect(screen.getByText('Final acceptance status')).toBeInTheDocument();
    expect(screen.getByText('Implementation accepted')).toBeInTheDocument();
    expect(screen.getByText('Outbound activation')).toBeInTheDocument();
    expect(screen.getByText(/Intentionally held/)).toBeInTheDocument();
    expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0);
    expect(screen.getByText('Held')).toBeInTheDocument();
    expect(screen.getByText('Canonical database')).toBeInTheDocument();
  });

  it('accepts database contracts only when every capability is available', () => {
    const allAvailable = Object.fromEntries(
      relationshipCapabilities().map(({ capability }) => [capability, 'available']),
    );
    useRelationshipCapabilities.mockReturnValue({
      data: relationshipCapabilities(allAvailable),
      isLoading: false,
      isError: false,
    });
    renderStatus();
    expect(screen.getByText('Database contracts available')).toBeInTheDocument();
    expect(screen.getByText(/capability contracts are available/)).toBeInTheDocument();
  });

  it('keeps database-dependent functions disabled when the snapshot cannot be loaded', () => {
    useRelationshipCapabilities.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderStatus();
    expect(screen.getByRole('alert')).toHaveTextContent(/Capability status could not be loaded/);
    expect(screen.getByText('Database contracts available')).toBeInTheDocument();
  });
});
