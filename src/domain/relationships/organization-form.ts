import type { OrganizationInput, OrganizationRole, SocialProfile, ValidationResult } from './contracts';

function parseCommaSeparatedValues(value: string) {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function normalizeRoleCode(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function prepareOrganizationSubmissionInput(
  input: Partial<OrganizationInput>,
  rolesText: string,
  socialProfilesText: string,
  description: string,
): Partial<OrganizationInput> {
  const roles: OrganizationRole[] = parseCommaSeparatedValues(rolesText).map((value, index) => ({
    id: `role-${index + 1}`,
    code: normalizeRoleCode(value),
    label: value,
    primary: index === 0,
  }));

  const socialProfiles: SocialProfile[] = parseCommaSeparatedValues(socialProfilesText).map((value) => {
    try {
      const parsed = new URL(value);
      return { platform: parsed.hostname.replace(/^www\./, ''), url: parsed.toString() };
    } catch {
      return { platform: value, url: value };
    }
  });

  return {
    ...input,
    description,
    roles,
    socialProfiles,
  };
}

/** Application-side guard; repository/RLS remain the eventual write authority. */
export function validateOrganizationInput(input: Partial<OrganizationInput>): ValidationResult {
  const fieldErrors: Record<string, string> = {};
  if (!input.name?.trim()) fieldErrors.name = 'Organization name is required.';
  if (input.website && !/^https?:\/\//i.test(input.website)) fieldErrors.website = 'Website must begin with http:// or https://.';
  if (!input.stage) fieldErrors.stage = 'Relationship stage is required.';
  return { valid: Object.keys(fieldErrors).length === 0, fieldErrors };
}
