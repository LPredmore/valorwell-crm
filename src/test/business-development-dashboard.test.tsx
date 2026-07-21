import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BusinessDevelopmentDashboard from '@/pages/crm/business-development/BusinessDevelopmentDashboard';
import BusinessDevelopmentArchitecture from '@/pages/crm/BusinessDevelopmentArchitecture';
import { relationshipCapabilities } from '@/domain/relationships/capabilities';

const useRelationshipCapabilities = vi.fn();

vi.mock('@/hooks/relationships/useRelationshipCapabilities', () => ({
  useRelationshipCapabilities: () => useRelationshipCapabilities(),
}));

function renderDashboard() {
  return render(<MemoryRouter><BusinessDevelopmentDashboard /></MemoryRouter>);
}

function renderStatus() {
  return render(<MemoryRouter><BusinessDevelopmentArchitecture /></MemoryRouter>);
}

describe('Business Development dashboard and system status', () => {
  beforeEach(() => {
    useRelationshipCapabilities.mockReturnValue({
      data: relationshipCapabilities(),
      isLoading: false,
      isError: false,
    });
  });

  it('shows pending metrics rather than misleading zero values', () => {
    renderDashboard();
    expect(screen.getByText('Organizations needing review')).toBeInTheDocument();
    expect(screen.getAllByText(/Database support pending; no relationship data is read or written/).length).toBeGreaterThan(0);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('describes available database support as awaiting verified metric integration', () => {
    useRelationshipCapabilities.mockReturnValue({
      data: relationshipCapabilities({ organizations: 'available' }),
      isLoading: false,
      isError: false,
    });
    renderDashboard();
    expect(screen.getAllByText('Database support is available; this metric will appear after its integration is verified.').length).toBeGreaterThan(0);
  });

  it('separates first-slice integration from full production readiness', () => {
    renderStatus();
    expect(screen.getByText('Architecture established')).toBeInTheDocument();
    expect(screen.getByText('Application code implemented')).toBeInTheDocument();
    expect(screen.getByText('Production ready')).toBeInTheDocument();
    expect(screen.getAllByText('Not verified').length).toBeGreaterThan(0);
    expect(screen.getByText('Canonical database')).toBeInTheDocument();
  });

  it('verifies integration only when organizations and contacts are available', () => {
    useRelationshipCapabilities.mockReturnValue({
      data: relationshipCapabilities({
        organizations: 'available',
        contacts: 'available',
      }),
      isLoading: false,
      isError: false,
    });
    renderStatus();
    expect(screen.getByText('Organizations and contacts are verified against the selected Billing Hub tenant.')).toBeInTheDocument();
    expect(screen.getByText('The first persistence slice is live; later workflow and operational-approval requirements remain.')).toBeInTheDocument();
  });

  it('keeps database-dependent functions disabled when the snapshot cannot be loaded', () => {
    useRelationshipCapabilities.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderStatus();
    expect(screen.getByText(/Capability status could not be loaded/)).toBeInTheDocument();
    expect(screen.getByText('Database support available')).toBeInTheDocument();
  });
});
