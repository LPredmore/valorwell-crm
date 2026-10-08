import { supabase } from '@/integrations/supabase/client';
import { dataProvider } from '@/services/dataProvider';
import {
  detectDuplicateCandidates, identityPair,
  type DuplicateCandidate, type IdentityDecision, type IdentityReview,
  type IdentitySourceDomain, type MatchBasis,
} from '@/domain/identity/review';
import type { RelationshipContactRecord } from '@/domain/relationships/records';

// This repository deliberately does not query provider_applicants, clients, or
// unscoped therapist_outreach_prospects. Those sources own their own permissions.
type ReviewRow = {
  id: string; tenant_id: string; contact_id: string; linked_domain: IdentitySourceDomain;
  linked_record_id: string; decision: IdentityDecision; match_basis: MatchBasis;
  review_note: string | null; reviewed_by: string; updated_at: string;
};
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class IdentityReviewNotDeployedError extends Error {
  constructor() {
    super('The reviewed-identity database migration has not been deployed yet.');
    this.name = 'IdentityReviewNotDeployedError';
  }
}
function checkDbError(error: { message: string; code?: string } | null): void {
  if (!error) return;
  if (error.code === '42P01' || error.code === 'PGRST205' || error.message.includes('schema cache')) {
    throw new IdentityReviewNotDeployedError();
  }
  throw new Error(error.message);
}
async function context() {
  const { data, error } = await supabase.rpc('get_crm_operating_context');
  checkDbError(error);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('CRM operating context unavailable.');
  const tenantId = data.current_tenant_id;
  const userId = data.profile_id;
  const role = data.crm_role;
  if (typeof tenantId !== 'string' || typeof userId !== 'string' || typeof role !== 'string')
    throw new Error('Select an authorized CRM tenant first.');
  return { tenantId, userId, role };
}

function toReview(row: ReviewRow): IdentityReview {
  return {
    id: row.id, tenantId: row.tenant_id, contactId: row.contact_id,
    linkedDomain: row.linked_domain, linkedRecordId: row.linked_record_id,
    decision: row.decision, matchBasis: row.match_basis,
    reviewNote: row.review_note ?? undefined,
    reviewedBy: row.reviewed_by, updatedAt: row.updated_at,
  };
}

export const identityReviewsRepository = {
  async findSuggestions(contact: RelationshipContactRecord): Promise<DuplicateCandidate[]> {
    if (contact.kind !== 'person' || (!contact.email && !contact.phone)) return [];
    const queryTerms = [...new Set([contact.email, contact.phone].filter((v): v is string => Boolean(v?.trim())))];
    const results = await Promise.all(queryTerms.map(term =>
      dataProvider.relationships.listContacts({ search: term, page: 1, pageSize: 100 }),
    ));
    const discovered = new Map<string, RelationshipContactRecord>();
    results.forEach(result => result.items.forEach(item => {
      if (item.tenantId === contact.tenantId) discovered.set(item.id, item);
    }));
    return detectDuplicateCandidates(contact, [...discovered.values()]);
  },

  async listForContact(contactId: string): Promise<IdentityReview[]> {
    const { tenantId } = await context();
    if (!idPattern.test(contactId)) throw new Error('Invalid contact identifier.');
    const { data, error } = await supabase
      .from('crm_identity_reviews' as 'crm_people')
      .select('*')
      .eq('tenant_id', tenantId)
      .or(`contact_id.eq.${contactId},linked_record_id.eq.${contactId}`)
      .order('updated_at', { ascending: false });
    checkDbError(error);
    return ((data ?? []) as unknown as ReviewRow[])
      .filter(row => row.contact_id === contactId ||
        (row.linked_domain === 'relationship_contact' && row.linked_record_id === contactId))
      .map(toReview);
  },

  async decide(input: {
    contactId: string; domain: IdentitySourceDomain; targetId: string;
    decision: IdentityDecision; basis: MatchBasis; note?: string;
  }): Promise<void> {
    const { tenantId, userId, role } = await context();
    if (role !== 'crm_admin' && role !== 'crm_operator') throw new Error('CRM editing permission is required.');
    if (!idPattern.test(input.contactId) || !idPattern.test(input.targetId))
      throw new Error('Both source and target must be valid UUIDs.');
    if (input.contactId === input.targetId && input.domain === 'relationship_contact')
      throw new Error('A contact cannot be linked to itself.');
    if (input.note && input.note.length > 2000) throw new Error('Review note is too long.');
    if (input.domain === 'client' && role !== 'crm_admin')
      throw new Error('Clinical links require an authorized CRM administrator.');
    if (['provider_applicant', 'therapist_prospect'].includes(input.domain) && role !== 'crm_admin')
      throw new Error('Recruitment source links require a CRM administrator.');
    const [contactId, targetId] = input.domain === 'relationship_contact'
      ? identityPair(input.contactId, input.targetId) : [input.contactId, input.targetId];
    const { error } = await supabase
      .from('crm_identity_reviews' as 'crm_people')
      .upsert({
        tenant_id: tenantId, contact_id: contactId,
        linked_domain: input.domain, linked_record_id: targetId,
        decision: input.decision, match_basis: input.basis,
        review_note: input.note?.trim() || null, reviewed_by: userId,
      } as never, { onConflict: 'tenant_id,contact_id,linked_domain,linked_record_id' });
    checkDbError(error);
  },

  async attributeProspect(prospectId: string, reason: string): Promise<void> {
    const { tenantId, userId, role } = await context();
    if (role !== 'crm_admin') throw new Error('Only CRM administrators may attribute unscoped prospects.');
    if (!idPattern.test(prospectId) || reason.trim().length < 8)
      throw new Error('A valid prospect UUID and documented source verification are required.');
    const { error } = await supabase
      .from('crm_therapist_prospect_attributions' as 'crm_people')
      .insert({ prospect_id: prospectId, tenant_id: tenantId, attested_by: userId, reason: reason.trim() } as never);
    checkDbError(error);
  },
};
