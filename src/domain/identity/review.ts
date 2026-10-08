import type { RelationshipContactRecord } from '@/domain/relationships/records';

export type IdentitySourceDomain =
  | 'relationship_contact' | 'bty_opportunity' | 'provider_applicant'
  | 'therapist_prospect' | 'client';
export type IdentityDecision = 'linked' | 'rejected';
export type MatchBasis = 'email' | 'phone' | 'manual' | 'name_and_email';

export interface IdentityReview {
  id: string;
  tenantId: string;
  contactId: string;
  linkedDomain: IdentitySourceDomain;
  linkedRecordId: string;
  decision: IdentityDecision;
  matchBasis: MatchBasis;
  reviewNote?: string;
  reviewedBy: string;
  updatedAt: string;
}

export interface DuplicateCandidate {
  contact: RelationshipContactRecord;
  matchBasis: 'email' | 'phone' | 'name_and_email';
  ambiguous: boolean;
  evidence: string;
}

// Do not strip +aliases, Gmail dots, accents or country codes: those transformations
// can collapse real people or unrelated mailboxes into a single identity.
export function normalizedEmail(value: string | undefined): string | null {
  const cleaned = value?.trim().toLocaleLowerCase('en-US') ?? '';
  return cleaned.includes('@') && cleaned.split('@').length === 2 ? cleaned : null;
}
export function normalizedPhone(value: string | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  // US national format only; avoid treating foreign/local extensions as identical.
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return null;
}
export function normalizedName(contact: Pick<RelationshipContactRecord, 'firstName' | 'lastName'>): string | null {
  const first = contact.firstName?.trim().toLocaleLowerCase('en-US');
  const last = contact.lastName?.trim().toLocaleLowerCase('en-US');
  return first && last ? first + '|' + last : null;
}

export function detectDuplicateCandidates(
  subject: RelationshipContactRecord,
  possible: readonly RelationshipContactRecord[],
): DuplicateCandidate[] {
  if (subject.kind !== 'person') return [];
  const email = normalizedEmail(subject.email);
  const phone = normalizedPhone(subject.phone);
  const name = normalizedName(subject);
  return possible.flatMap((contact) => {
    if (contact.id === subject.id || contact.tenantId !== subject.tenantId || contact.kind !== 'person') return [];
    const emailMatch = email !== null && email === normalizedEmail(contact.email);
    const phoneMatch = phone !== null && phone === normalizedPhone(contact.phone);
    if (!emailMatch && !phoneMatch) return []; // Name-only is not identity evidence.
    const nameMatch = name !== null && name === normalizedName(contact);
    const matchBasis: DuplicateCandidate['matchBasis'] =
      emailMatch && nameMatch ? 'name_and_email' : emailMatch ? 'email' : 'phone';
    return [{
      contact,
      matchBasis,
      ambiguous: !nameMatch || !phoneMatch,
      evidence: emailMatch && phoneMatch ? 'Exact email and phone match'
        : emailMatch ? 'Exact email match (shared/family addresses are possible)'
          : 'Matching US phone number (shared phone numbers are possible)',
    }];
  }).sort((a, b) =>
    Number(a.ambiguous) - Number(b.ambiguous)
    || a.contact.displayName.localeCompare(b.contact.displayName),
  );
}

export function identityPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Clinical records are links to their existing secure source only, never copied into CRM. */
export function linkedRecordUrl(domain: IdentitySourceDomain, id: string): string | null {
  if (domain === 'relationship_contact') return '/crm/business-development/contacts/' + encodeURIComponent(id);
  if (domain === 'bty_opportunity') return '/crm/business-development/opportunities/' + encodeURIComponent(id);
  if (domain === 'client') return '/crm/clients/' + encodeURIComponent(id);
  return null; // Applicants/prospects have no verified authenticated detail route here.
}
