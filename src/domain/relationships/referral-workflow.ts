import type { CreateReferralInput, ReferralDisclosure, ValidationResult } from './contracts';

export const referralDisclosures: ReferralDisclosure[] = [
  'internal',
  'community_anonymous',
  'named_referrer',
  'compliance_review',
];

const disclosureLabels: Record<ReferralDisclosure, string> = {
  internal: 'Internal only',
  community_anonymous: 'Verified anonymous community referral',
  named_referrer: 'Verified named referrer',
  compliance_review: 'Compliance review required',
};

export function referralDisclosureLabel(disclosure: ReferralDisclosure) {
  return disclosureLabels[disclosure];
}

export function parseEvidenceUrlLines(value: string) {
  return [...new Set(value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean))];
}

export function validateReferralInput(input: Partial<CreateReferralInput>): ValidationResult {
  const fieldErrors: Record<string, string> = {};
  if (!input.organizationId && !input.contactId) fieldErrors.subject = 'Select an organization or contact.';
  if (!input.sourceCategory?.trim()) fieldErrors.sourceCategory = 'Source category is required.';
  if (!input.summary?.trim()) fieldErrors.summary = 'Source summary is required.';
  if (!input.disclosure) fieldErrors.disclosure = 'Disclosure handling is required.';
  if (input.disclosure === 'named_referrer' && !input.namedReferrer?.trim()) fieldErrors.namedReferrer = 'A named referrer is required for named disclosure.';
  return { valid: Object.keys(fieldErrors).length === 0, fieldErrors };
}

export function disclosureAllowsIdentity(disclosure: ReferralDisclosure) {
  return disclosure === 'named_referrer';
}