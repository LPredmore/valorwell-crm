/**
 * Business-development application contracts.  These deliberately do not mirror
 * Supabase rows: the database implementation is a separately versioned concern.
 */
export const relationshipStages = ['identified', 'qualified_outreach', 'contacted', 'engaged', 'discovery', 'next_step_agreed', 'active', 'nurture', 'closed_no_fit', 'inactive'] as const;
export type RelationshipStage = (typeof relationshipStages)[number];
export type ContactKind = 'person' | 'role_inbox';
export type Capability = 'organizations' | 'contacts' | 'referrals' | 'opportunities' | 'interactions' | 'imports' | 'campaigns' | 'enrollment' | 'suppression' | 'unsubscribe' | 'replies' | 'reporting';
export type CapabilityAvailability = { capability: Capability; available: boolean; reason: string };
export type AuditMetadata = { createdAt: string; updatedAt: string; createdBy?: string; updatedBy?: string };
export type Organization = AuditMetadata & { id: string; name: string; website?: string; type?: string; stage: RelationshipStage; owner?: string; nextAction?: string; nextActionDueAt?: string; doNotContact: boolean };
export type RelationshipContact = AuditMetadata & { id: string; kind: ContactKind; displayName: string; email?: string; phone?: string; organizationIds: string[]; title?: string; stage: RelationshipStage; doNotContact: boolean };
export type ReferralDisclosure = 'internal' | 'community_anonymous' | 'named_referrer' | 'compliance_review';
export type Referral = { id: string; sourceCategory: string; summary: string; verified: boolean; disclosure: ReferralDisclosure; namedReferrer?: string };
export type SourceLanguageMode = 'research' | 'community' | 'verified_anonymous' | 'verified_named' | 'none';
export type OperationError = { code: 'capability_pending' | 'permission_denied' | 'network' | 'query' | 'invalid_response' | 'validation'; message: string; diagnostic?: string };
export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number };

const transitions: Record<RelationshipStage, RelationshipStage[]> = {
  identified: ['qualified_outreach', 'nurture', 'closed_no_fit', 'inactive'], qualified_outreach: ['contacted', 'nurture', 'closed_no_fit'], contacted: ['engaged', 'discovery', 'nurture', 'closed_no_fit'], engaged: ['discovery', 'next_step_agreed', 'nurture', 'inactive'], discovery: ['next_step_agreed', 'active', 'nurture', 'closed_no_fit'], next_step_agreed: ['active', 'nurture', 'closed_no_fit'], active: ['nurture', 'inactive'], nurture: ['qualified_outreach', 'contacted', 'closed_no_fit', 'inactive'], closed_no_fit: ['identified'], inactive: ['identified', 'nurture'],
};
export function canTransition(from: RelationshipStage, to: RelationshipStage) { return transitions[from].includes(to); }
export function approvedSourceLanguage(referral?: Referral): SourceLanguageMode {
  if (!referral) return 'research';
  if (!referral.verified || referral.disclosure === 'internal' || referral.disclosure === 'compliance_review') return 'none';
  if (referral.disclosure === 'named_referrer' && referral.namedReferrer) return 'verified_named';
  return referral.disclosure === 'community_anonymous' ? 'verified_anonymous' : 'community';
}
export function normalizeDomain(value: string) { return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]; }
export function normalizeEmail(value: string) { return value.trim().toLowerCase(); }
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[]; errors: string[] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { headers: [], rows: [], errors: ['The CSV is empty.'] };
  const split = (line: string) => line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
  const headers = split(lines[0]);
  if (!headers.includes('organization_name')) return { headers, rows: [], errors: ['Required header: organization_name.'] };
  return { headers, rows: lines.slice(1).map(line => Object.fromEntries(headers.map((header, index) => [header, split(line)[index] ?? '']))), errors: [] };
}
