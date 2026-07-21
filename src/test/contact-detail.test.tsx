import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ContactDetailPage from '@/pages/crm/business-development/ContactDetailPage';
import { capabilityState } from '@/domain/relationships/capabilities';

const { relationships, useRelationshipCapability } = vi.hoisted(() => ({
  relationships: {
    getContact: vi.fn(),
    getOrganization: vi.fn(),
  },
  useRelationshipCapability: vi.fn(),
}));

vi.mock('@/services/dataProvider', () => ({
  dataProvider: { relationships },
}));

vi.mock('@/hooks/relationships/useRelationshipCapabilities', () => ({
  useRelationshipCapability: (...args: unknown[]) => useRelationshipCapability(...args),
}));

vi.mock('@/components/crm/relationships/RelationshipLifecyclePanel', () => ({
  RelationshipLifecyclePanel: ({ entityLabel }: { entityLabel: string }) => (
    <div>Lifecycle workflow for {entityLabel}</div>
  ),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/crm/business-development/contacts/contact-1']}>
        <Routes>
          <Route
            path="/crm/business-development/contacts/:id"
            element={<ContactDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContactDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRelationshipCapability.mockImplementation((capability: string) => ({
      capability: capabilityState(capability as 'contacts' | 'organizations', 'available'),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }));
    relationships.getContact.mockResolvedValue({
      id: 'contact-1',
      tenantId: 'tenant-1',
      kind: 'person',
      displayName: 'Jordan Reyes',
      firstName: 'Jordan',
      email: 'jordan@example.org',
      veteranAffiliation: 'veteran',
      stage: 'engaged',
      outreachStatus: 'engaged',
      doNotContact: false,
      source: 'crm_manual',
      affiliations: [
        {
          tenantId: 'tenant-1',
          contactId: 'contact-1',
          organizationId: 'org-1',
          roleTitle: 'Executive director',
          isPrimary: true,
          createdAt: '2026-07-21T12:00:00.000Z',
          updatedAt: '2026-07-21T12:00:00.000Z',
        },
      ],
      createdAt: '2026-07-21T12:00:00.000Z',
      updatedAt: '2026-07-21T12:00:00.000Z',
    });
    relationships.getOrganization.mockResolvedValue({
      id: 'org-1',
      tenantId: 'tenant-1',
      name: 'Veterans Forward',
      stage: 'active',
      outreachStatus: 'engaged',
      doNotContact: false,
      source: 'crm_manual',
      createdAt: '2026-07-21T12:00:00.000Z',
      updatedAt: '2026-07-21T12:00:00.000Z',
    });
  });

  it('renders the contact lifecycle workspace and organization affiliation', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Jordan Reyes' })).toBeInTheDocument();
    expect(screen.getByText('Engaged')).toBeInTheDocument();
    expect(screen.getByText('Lifecycle workflow for Jordan Reyes')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Veterans Forward' })).toHaveAttribute(
      'href',
      '/crm/business-development/organizations/org-1',
    );
    expect(screen.getByText('Executive director')).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
  });
});
