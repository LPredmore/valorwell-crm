import type { CreateReferralInput, ReferralDisclosure, ValidationResult } from './contracts';

export function validateReferralInput(input: Partial<CreateReferralInput>): ValidationResult {
  const fieldErrors: Record<string, string> = {};
  if (!input.organizationId && !input.contactId) fieldErrors.subject = 'Select an organization or contact.';
  if (!input.sourceCategory?.trim()) fieldErrors.sourceCategory = 'Source category is required.';
  if (!input.summary?.trim()) fieldErrors.summary = 'Source summary is required.';
  if (input.disclosure === 'named_referrer' && !input.namedReferrer?.trim()) fieldErrors.namedReferrer = 'A named referrer is required for named disclosure.';
  return { valid: Object.keys(fieldErrors).length === 0, fieldErrors };
}

export function disclosureAllowsIdentity(disclosure: ReferralDisclosure) { return disclosure === 'named_referrer'; }
