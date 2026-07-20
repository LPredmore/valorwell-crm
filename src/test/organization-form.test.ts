import { describe, expect, it } from 'vitest';
import { validateOrganizationInput } from '@/domain/relationships/organization-form';

describe('validateOrganizationInput', () => {
  it('requires a name and stage and validates website protocol', () => {
    expect(validateOrganizationInput({ website: 'example.org' })).toEqual({ valid: false, fieldErrors: { name: 'Organization name is required.', website: 'Website must begin with http:// or https://.', stage: 'Relationship stage is required.' } });
  });

  it('accepts a minimally valid organization input', () => {
    expect(validateOrganizationInput({ name: 'Veterans Forward', website: 'https://example.org', stage: 'identified' })).toEqual({ valid: true, fieldErrors: {} });
  });
});
