import { supabase } from '@/integrations/supabase/client';
import { identitySupabase } from '@/integrations/supabase/identity-schema';
import type { IdentityDatabase } from '@/integrations/supabase/identity-schema';
import { dataProvider } from '@/services/dataProvider';
import {
  detectDuplicateCandidates, identityPair,
  type DuplicateCandidate, type IdentityDecision, type IdentityReview, type IdentityReviewEvent,
  type IdentitySourceDomain, type MatchBasis,
} from '@/domain/identity/review';
import type { RelationshipContactRecord } from '@/domain/relationships/records';

// Protected applicant/prospect/client payloads are never queried by this repository.
type ReviewRow = IdentityDatabase['public']['Tables']['crm_identity_reviews']['Row'];
type EventRow = IdentityDatabase['public']['Tables']['crm_identity_review_events']['Row'];
export type IdentityScope = { tenantId: string; userId: string };
export type IdentityPage<T> = { items: T[]; nextOffset: number | undefined };
const pageSize = 25;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const domains: readonly string[] = ['relationship_contact', 'bty_opportunity', 'provider_applicant', 'therapist_prospect', 'client'];
const bases: readonly string[] = ['email', 'phone', 'manual', 'name_and_email'];

export class IdentityReviewNotDeployedError extends Error {
  constructor() {
    super('Identity review storage is unavailable.');
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
function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
async function context(scope: IdentityScope) {
  if (!idPattern.test(scope.tenantId) || !idPattern.test(scope.userId)) throw new Error('Select an authorized CRM tenant first.');
  const { data, error } = await supabase.rpc('get_crm_operating_context');
  checkDbError(error);
  if (!isObject(data) || data.authenticated !== true || data.profile_id !== scope.userId) {
    throw new Error('CRM session changed. Reload this workspace.');
  }
  const available = Array.isArray(data.available_tenants) ? data.available_tenants : [];
  const selected = available.find(item => isObject(item) && item.tenant_id === scope.tenantId);
  if (!isObject(selected) || !['crm_admin', 'crm_operator', 'crm_readonly'].includes(String(selected.crm_role))) {
    throw new Error('Select an authorized CRM tenant first.');
  }
  return { ...scope, role: selected.crm_role };
}
function toReview(row: ReviewRow): IdentityReview {
  if (!domains.includes(row.linked_domain) || !bases.includes(row.match_basis)
    || !['linked', 'rejected'].includes(row.decision)) throw new Error('Unsupported identity review contract.');
  return {
    id: row.id, tenantId: row.tenant_id, contactId: row.contact_id,
    linkedDomain: row.linked_domain as IdentitySourceDomain, linkedRecordId: row.linked_record_id,
    decision: row.decision as IdentityDecision, matchBasis: row.match_basis as MatchBasis,
    reviewNote: row.review_note ?? undefined,
    reviewedBy: row.reviewed_by, updatedAt: row.updated_at,
  };
}
function toEvent(row: EventRow): IdentityReviewEvent {
  return {
    id: row.id, reviewId: row.review_id, actorId: row.actor_id, changedAt: row.changed_at,
    previousDecision: row.previous_decision, nextDecision: row.next_decision,
    previousBasis: row.previous_match_basis, nextBasis: row.next_match_basis,
    previousNote: row.previous_review_note, nextNote: row.next_review_note,
  };
}
function contactFilter(contactId: string) {
  if (!idPattern.test(contactId)) throw new Error('Invalid contact identifier.');
  return `contact_id.eq.${contactId},and(linked_domain.eq.relationship_contact,linked_record_id.eq.${contactId})`;
}
function page<T>(rows: T[], offset: number): IdentityPage<T> {
  return { items: rows.slice(0, pageSize), nextOffset: rows.length > pageSize ? offset + pageSize : undefined };
}
function validOffset(offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid identity page.');
}
export const identityReviewsRepository = {
  async findSuggestions(contact: RelationshipContactRecord, scope: IdentityScope): Promise<DuplicateCandidate[]> {
    await context(scope);
    if (contact.tenantId !== scope.tenantId) throw new Error('Contact tenant changed.');
    if (contact.kind !== 'person' || (!contact.email && !contact.phone)) return [];
    const queryTerms = [...new Set([contact.email, contact.phone].filter((v): v is string => Boolean(v?.trim())))];
    const results = await Promise.all(queryTerms.map(term =>
      dataProvider.relationships.listContacts({ search: term, page: 1, pageSize: 100 }),
    ));
    const discovered = new Map<string, RelationshipContactRecord>();
    results.forEach(result => result.items.forEach(item => {
      if (item.tenantId === scope.tenantId) discovered.set(item.id, item);
    }));
    return detectDuplicateCandidates(contact, [...discovered.values()]);
  },
  async listForContact(contactId: string, scope: IdentityScope, offset = 0): Promise<IdentityPage<IdentityReview>> {
    await context(scope);
    validOffset(offset);
    const filter = contactFilter(contactId);
    const { data, error } = await identitySupabase.from('crm_identity_reviews').select('*')
      .eq('tenant_id', scope.tenantId).or(filter)
      .order('updated_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + pageSize);
    checkDbError(error);
    return page((data ?? []).map(toReview), offset);
  },
  async listEventsForContact(contactId: string, scope: IdentityScope, offset = 0): Promise<IdentityPage<IdentityReviewEvent>> {
    await context(scope);
    validOffset(offset);
    const filter = contactFilter(contactId);
    const { data, error } = await identitySupabase.from('crm_identity_review_events')
      .select('*,review:crm_identity_reviews!inner(contact_id,linked_domain,linked_record_id)')
      .eq('tenant_id', scope.tenantId).or(filter, { referencedTable: 'review' })
      .order('changed_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + pageSize);
    checkDbError(error);
    return page((data ?? []).map(toEvent), offset);
  },
  async decide(input: {
    contactId: string; domain: IdentitySourceDomain; targetId: string;
    decision: IdentityDecision; basis: MatchBasis; note?: string;
  }, scope: IdentityScope): Promise<void> {
    const { tenantId, userId, role } = await context(scope);
    if (role !== 'crm_admin' && role !== 'crm_operator') throw new Error('CRM editing permission is required.');
    if (!idPattern.test(input.contactId) || !idPattern.test(input.targetId))
      throw new Error('Both source and target must be valid UUIDs.');
    if (input.contactId === input.targetId && input.domain === 'relationship_contact')
      throw new Error('A contact cannot be linked to itself.');
    if (input.note && input.note.length > 2000) throw new Error('Review note is too long.');
    if (['client', 'provider_applicant', 'therapist_prospect'].includes(input.domain) && role !== 'crm_admin')
      throw new Error('This source link requires an authorized CRM administrator.');
    const [contactId, targetId] = input.domain === 'relationship_contact'
      ? identityPair(input.contactId.toLowerCase(), input.targetId.toLowerCase())
      : [input.contactId, input.targetId];
    const { error } = await identitySupabase.from('crm_identity_reviews').upsert({
      tenant_id: tenantId, contact_id: contactId,
      linked_domain: input.domain, linked_record_id: targetId,
      decision: input.decision, match_basis: input.basis,
      review_note: input.note?.trim() || null, reviewed_by: userId,
    }, { onConflict: 'tenant_id,contact_id,linked_domain,linked_record_id' });
    checkDbError(error);
  },
};
