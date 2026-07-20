import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrganizationDirectoryPage from '@/pages/crm/business-development/OrganizationDirectoryPage';
import { capabilityState } from '@/domain/relationships/capabilities';

const useRelationshipCapability = vi.fn();
const useOrganizationDirectory = vi.fn();

vi.mock('@/hooks/relationships/useRelationshipCapabilities', () => ({ useRelationshipCapability: (...args: unknown[]) => useRelationshipCapability(...args) }));
vi.mock('@/hooks/relationships/useOrganizationDirectory', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/hooks/relationships/useOrganizationDirectory')>();
  return { ...original, useOrganizationDirectory: (...args: unknown[]) => useOrganizationDirectory(...args) };
});

function renderPage() {
  return render(<MemoryRouter><OrganizationDirectoryPage /></MemoryRouter>);
}

describe('OrganizationDirectoryPage', () => {
  beforeEach(() => {
    useRelationshipCapability.mockReturnValue({ capability: capabilityState('organizations'), isLoading: false, isError: false, refetch: vi.fn() });
    useOrganizationDirectory.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
  });

  it('keeps query controls visible but does not show fabricated organization results while pending', () => {
    renderPage();
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByText('Directory ready for database support')).toBeInTheDocument();
    expect(screen.queryByText('Organization results')).not.toBeInTheDocument();
    expect(useOrganizationDirectory).toHaveBeenLastCalledWith(expect.any(Object), false);
  });

  it('stores directory search filters in the URL and can reset them', () => {
    renderPage();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'ValorWell' } });
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveValue('ValorWell');
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveValue('');
  });

  it('renders a truthful empty result only when the database capability is available', () => {
    useRelationshipCapability.mockReturnValue({ capability: capabilityState('organizations', 'available'), isLoading: false, isError: false, refetch: vi.fn() });
    useOrganizationDirectory.mockReturnValue({ data: { items: [], total: 0, page: 1, pageSize: 25 }, isLoading: false, isError: false, refetch: vi.fn() });
    renderPage();
    expect(screen.getByText('No organizations match the current filters.')).toBeInTheDocument();
    expect(screen.getByText('0 matching relationship organizations.')).toBeInTheDocument();
  });

  it('supports selecting capability-backed rows and paginating the result set', () => {
    useRelationshipCapability.mockReturnValue({ capability: capabilityState('organizations', 'available'), isLoading: false, isError: false, refetch: vi.fn() });
    useOrganizationDirectory.mockReturnValue({ data: { items: [{ id: 'org-1', name: 'Veterans Forward', stage: 'identified', doNotContact: false, roles: [], socialProfiles: [], createdAt: '2026-01-01', updatedAt: '2026-01-02' }], total: 26, page: 1, pageSize: 25 }, isLoading: false, isError: false, refetch: vi.fn() });
    renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Veterans Forward' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });
});
