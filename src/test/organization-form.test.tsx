import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { capabilityState } from '@/domain/relationships/capabilities';
import { prepareOrganizationSubmissionInput, validateOrganizationInput } from '@/domain/relationships/organization-form';
import OrganizationFormPage from '@/pages/crm/business-development/OrganizationFormPage';

const { createOrganization, getOrganization, updateOrganization } = vi.hoisted(() => ({
  createOrganization: vi.fn(),
  getOrganization: vi.fn(),
  updateOrganization: vi.fn(),
}));

vi.mock('@/hooks/relationships/useRelationshipCapabilities', () => ({
  useRelationshipCapability: () => ({ capability: capabilityState('organizations', 'available'), isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/services/dataProvider', () => ({
  dataProvider: {
    relationships: {
      createOrganization,
      getOrganization,
      updateOrganization,
    },
  },
}));

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><OrganizationFormPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('validateOrganizationInput', () => {
  it('requires a name and validates website protocol', () => {
    expect(validateOrganizationInput({ website: 'example.org' })).toEqual({
      valid: false,
      fieldErrors: {
        name: 'Organization name is required.',
        website: 'Website must begin with http:// or https://.',
      },
    });
  });

  it('accepts a minimally valid persisted organization input', () => {
    expect(validateOrganizationInput({
      name: 'Veterans Forward',
      website: 'https://example.org',
      outreachStatus: 'new',
    })).toEqual({ valid: true, fieldErrors: {} });
  });
});

describe('organization form submission preparation', () => {
  beforeEach(() => {
    createOrganization.mockReset();
    getOrganization.mockReset();
    updateOrganization.mockReset();
    createOrganization.mockResolvedValue({
      id: 'org-1',
      tenantId: 'tenant-1',
      name: 'Veterans Forward',
      outreachStatus: 'new',
      doNotContact: false,
      source: 'crm_manual',
      createdAt: '2026-07-20T00:00:00Z',
      updatedAt: '2026-07-20T00:00:00Z',
    });
  });

  it('shows persisted fields and omits unsupported future-state fields', () => {
    renderForm();

    expect(screen.getByLabelText('Organization name')).toBeInTheDocument();
    expect(screen.getByLabelText('Organization kind')).toBeInTheDocument();
    expect(screen.getByLabelText('Outreach status')).toBeInTheDocument();
    expect(screen.queryByLabelText('Organization roles')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Social profiles')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Description, mission/)).not.toBeInTheDocument();
  });

  it('normalizes only persisted organization submission values', () => {
    const result = prepareOrganizationSubmissionInput({
      name: '  Veterans Forward  ',
      website: ' https://example.org ',
      organizationKind: ' nonprofit ',
      outreachStatus: 'new',
      doNotContact: false,
    });

    expect(result).toEqual({
      name: 'Veterans Forward',
      website: 'https://example.org',
      organizationKind: 'nonprofit',
      outreachStatus: 'new',
      doNotContact: false,
      ownerId: undefined,
      nextAction: undefined,
      nextActionDueAt: undefined,
    });
  });

  it('submits the tenant-scoped repository create path', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Veterans Forward' } });
    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'https://example.org' } });
    fireEvent.change(screen.getByLabelText('Organization kind'), { target: { value: 'nonprofit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));

    await waitFor(() => expect(createOrganization).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Veterans Forward',
      website: 'https://example.org',
      organizationKind: 'nonprofit',
      outreachStatus: 'new',
      doNotContact: false,
    })));
  });
});
