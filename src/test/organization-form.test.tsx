import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { capabilityState } from '@/domain/relationships/capabilities';
import { prepareOrganizationSubmissionInput, validateOrganizationInput } from '@/domain/relationships/organization-form';
import OrganizationFormPage from '@/pages/crm/business-development/OrganizationFormPage';

vi.mock('@/hooks/relationships/useRelationshipCapabilities', () => ({
  useRelationshipCapability: () => ({ capability: capabilityState('organizations', 'available'), isLoading: false, isError: false, refetch: vi.fn() }),
}));

describe('validateOrganizationInput', () => {
  it('requires a name and stage and validates website protocol', () => {
    expect(validateOrganizationInput({ website: 'example.org' })).toEqual({ valid: false, fieldErrors: { name: 'Organization name is required.', website: 'Website must begin with http:// or https://.', stage: 'Relationship stage is required.' } });
  });

  it('accepts a minimally valid organization input', () => {
    expect(validateOrganizationInput({ name: 'Veterans Forward', website: 'https://example.org', stage: 'identified' })).toEqual({ valid: true, fieldErrors: {} });
  });
});

describe('organization form submission preparation', () => {
  it('retains typed role, social profile, and description values in the form', () => {
    render(<MemoryRouter><OrganizationFormPage /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText('Organization roles'), { target: { value: 'advocate, sponsor' } });
    fireEvent.change(screen.getByLabelText('Social profiles'), { target: { value: 'https://linkedin.com/company/valorwell, https://x.com/valorwell' } });
    fireEvent.change(screen.getByLabelText(/Description, mission/), { target: { value: 'Mission and outreach context' } });

    expect(screen.getByLabelText('Organization roles')).toHaveValue('advocate, sponsor');
    expect(screen.getByLabelText('Social profiles')).toHaveValue('https://linkedin.com/company/valorwell, https://x.com/valorwell');
    expect(screen.getByLabelText(/Description, mission/)).toHaveValue('Mission and outreach context');
  });

  it('converts comma-separated roles and social profiles to typed submission objects', () => {
    const result = prepareOrganizationSubmissionInput(
      { name: 'Veterans Forward', website: 'https://example.org', stage: 'identified' },
      'Advocate, Sponsor',
      'https://linkedin.com/company/valorwell, https://x.com/valorwell',
      'Mission and outreach context',
    );

    expect(result).toMatchObject({
      name: 'Veterans Forward',
      description: 'Mission and outreach context',
      roles: [
        { code: 'advocate', label: 'Advocate', primary: true },
        { code: 'sponsor', label: 'Sponsor', primary: false },
      ],
      socialProfiles: [
        { platform: 'linkedin.com', url: 'https://linkedin.com/company/valorwell' },
        { platform: 'x.com', url: 'https://x.com/valorwell' },
      ],
    });
  });
});
