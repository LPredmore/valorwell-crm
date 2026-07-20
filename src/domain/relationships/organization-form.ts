import type { ValidationResult } from './contracts';
import type { RelationshipOrganizationInput } from './records';

export function prepareOrganizationSubmissionInput(
  input: Partial<RelationshipOrganizationInput>,
): Partial<RelationshipOrganizationInput> {
  return {
    ...input,
    name: input.name?.trim(),
    website: input.website?.trim() || undefined,
    organizationKind: input.organizationKind?.trim() || undefined,
    ownerId: input.ownerId?.trim() || undefined,
    nextAction: input.nextAction?.trim() || undefined,
    nextActionDueAt: input.nextActionDueAt || undefined,
  };
}

/** Application-side guard; repository and tenant RLS remain write authority. */
export function validateOrganizationInput(
  input: Partial<RelationshipOrganizationInput>,
): ValidationResult {
  const fieldErrors: Record<string, string> = {};
  if (!input.name?.trim()) fieldErrors.name = 'Organization name is required.';
  if (input.website && !/^https?:\/\//i.test(input.website)) {
    fieldErrors.website = 'Website must begin with http:// or https://.';
  }
  return { valid: Object.keys(fieldErrors).length === 0, fieldErrors };
}
