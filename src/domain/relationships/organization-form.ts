import type { OrganizationInput, ValidationResult } from './contracts';

/** Application-side guard; repository/RLS remain the eventual write authority. */
export function validateOrganizationInput(input: Partial<OrganizationInput>): ValidationResult {
  const fieldErrors: Record<string, string> = {};
  if (!input.name?.trim()) fieldErrors.name = 'Organization name is required.';
  if (input.website && !/^https?:\/\//i.test(input.website)) fieldErrors.website = 'Website must begin with http:// or https://.';
  if (!input.stage) fieldErrors.stage = 'Relationship stage is required.';
  return { valid: Object.keys(fieldErrors).length === 0, fieldErrors };
}
