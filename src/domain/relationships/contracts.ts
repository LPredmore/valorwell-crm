/** Stable application contracts for the non-clinical relationship domain. */
export const RELATIONSHIP_DOMAIN = 'business-development' as const;
export const relationshipStages = ['identified', 'qualified_outreach', 'contacted', 'engaged', 'discovery', 'next_step_agreed', 'active', 'nurture', 'closed_no_fit', 'inactive'] as const;
export type RelationshipStage = (typeof relationshipStages)[number];
export type ContactKind = 'person' | 'role_inbox';
export type OpportunityStatus = 'identified' | 'researching' | 'qualified' | 'ready_for_campaign' | 'contacted' | 'responded' | 'interested' | 'recording_planned' | 'booked' | 'declined' | 'nurture' | 'disqualified' | 'completed';
export type Capability = 'organizations' | 'contacts' | 'referrals' | 'opportunities' | 'interactions' | 'imports' | 'campaigns' | 'enrollment' | 'suppression' | 'unsubscribe' | 'replies' | 'reporting' | 'search';
export type CapabilityStatus = 'available' | 'pending' | 'permission_denied' | 'network_error' | 'query_error' | 'invalid_response' | 'missing_contract';
export type CapabilityAvailability = { capability: Capability; status: CapabilityStatus; available: boolean; reason: string; diagnostic?: string };
export type AuditMetadata = { createdAt: string; updatedAt: string; createdBy?: string; updatedBy?: string };
export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number };
export type SortDirection = 'asc' | 'desc';
export type OperationErrorCode = 'capability_pending' | 'permission_denied' | 'network' | 'query' | 'invalid_response' | 'validation' | 'not_found';
export type OperationError = { code: OperationErrorCode; message: string; diagnostic?: string };
export type ValidationResult = { valid: boolean; fieldErrors: Record<string, string>; formError?: string };
export type OrganizationRole = { id: string; code: string; label: string; primary: boolean };
export type SocialProfile = { platform: string; handle?: string; url: string; followers?: number };
export type Organization = AuditMetadata & { id: string; name: string; website?: string; type?: string; state?: string; veteranAffiliation?: boolean; stage: RelationshipStage; outreachStatus?: string; reviewStatus?: string; ownerId?: string; nextAction?: string; nextActionDueAt?: string; doNotContact: boolean; roles: OrganizationRole[]; socialProfiles: SocialProfile[] };
export type OrganizationInput = Omit<Organization, 'id' | keyof AuditMetadata>;
export type RelationshipContact = AuditMetadata & { id: string; kind: ContactKind; displayName: string; firstName?: string; email?: string; phone?: string; organizationIds: string[]; primaryOrganizationId?: string; title?: string; stage: RelationshipStage; ownerId?: string; nextAction?: string; nextActionDueAt?: string; doNotContact: boolean };
export type ContactInput = Omit<RelationshipContact, 'id' | keyof AuditMetadata>;
export type ReferralDisclosure = 'internal' | 'community_anonymous' | 'named_referrer' | 'compliance_review';
export type Referral = AuditMetadata & { id: string; organizationId?: string; contactId?: string; sourceCategory: string; summary: string; evidenceUrls: string[]; verified: boolean; verifiedAt?: string; verifiedBy?: string; revokedAt?: string; disclosure: ReferralDisclosure; namedReferrer?: string; notes?: string };
export type SourceLanguageMode = 'research' | 'community' | 'verified_anonymous' | 'verified_named' | 'none';
export type RelationshipOpportunity = AuditMetadata & { id: string; organizationId: string; primaryContactId?: string; status: OpportunityStatus; ownerId?: string; causeArea?: string; veteranPriority?: boolean; qualification: Record<string, string | boolean | number | undefined>; nextAction?: string; nextActionDueAt?: string };
export type InteractionType = 'outbound_email' | 'inbound_reply' | 'phone_call' | 'meeting' | 'manual_note' | 'stage_transition' | 'owner_change' | 'next_action_change' | 'referral_verification' | 'opportunity_status_change' | 'campaign_enrollment' | 'campaign_stop' | 'suppression' | 'unsubscribe' | 'import' | 'system';
export type RelationshipInteraction = AuditMetadata & { id: string; organizationId?: string; contactId?: string; opportunityId?: string; type: InteractionType; actorId?: string; occurredAt: string; summary: string };
export type OrganizationQuery = { search?: string; stages?: RelationshipStage[]; owners?: string[]; states?: string[]; page?: number; pageSize?: number; sortBy?: keyof Organization; sortDir?: SortDirection };
export type ContactQuery = { search?: string; kinds?: ContactKind[]; organizationId?: string; stages?: RelationshipStage[]; page?: number; pageSize?: number; sortBy?: keyof RelationshipContact; sortDir?: SortDirection };
export type DuplicateCandidate = { entity: 'organization' | 'contact'; id: string; score: number; signals: string[] };
export type ImportPreview = { rows: Array<{ row: number; decision: 'create' | 'update' | 'duplicate' | 'ambiguous' | 'invalid' | 'excluded'; errors: string[]; candidates: DuplicateCandidate[] }>; mapping: Record<string, string>; valid: boolean };

const transitions: Record<RelationshipStage, RelationshipStage[]> = { identified: ['qualified_outreach', 'nurture', 'closed_no_fit', 'inactive'], qualified_outreach: ['contacted', 'nurture', 'closed_no_fit'], contacted: ['engaged', 'discovery', 'nurture', 'closed_no_fit'], engaged: ['discovery', 'next_step_agreed', 'nurture', 'inactive'], discovery: ['next_step_agreed', 'active', 'nurture', 'closed_no_fit'], next_step_agreed: ['active', 'nurture', 'closed_no_fit'], active: ['nurture', 'inactive'], nurture: ['qualified_outreach', 'contacted', 'closed_no_fit', 'inactive'], closed_no_fit: ['identified'], inactive: ['identified', 'nurture'] };
export function canTransition(from: RelationshipStage, to: RelationshipStage) { return transitions[from].includes(to); }
export function approvedSourceLanguage(referral?: Referral): SourceLanguageMode { if (!referral) return 'research'; if (!referral.verified || referral.revokedAt || referral.disclosure === 'internal' || referral.disclosure === 'compliance_review') return 'none'; if (referral.disclosure === 'named_referrer' && referral.namedReferrer) return 'verified_named'; return referral.disclosure === 'community_anonymous' ? 'verified_anonymous' : 'community'; }
export function normalizeDomain(value: string) { return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]; }
export function normalizeEmail(value: string) { return value.trim().toLowerCase(); }
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[]; errors: string[] } { const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean); if (!lines.length) return { headers: [], rows: [], errors: ['The CSV is empty.'] }; const split = (line: string) => line.split(',').map(v => v.trim().replace(/^"|"$/g, '')); const headers = split(lines[0]); if (!headers.includes('organization_name')) return { headers, rows: [], errors: ['Required header: organization_name.'] }; return { headers, rows: lines.slice(1).map(line => Object.fromEntries(headers.map((header, index) => [header, split(line)[index] ?? '']))), errors: [] }; }
