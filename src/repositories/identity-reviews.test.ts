import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, query, database, listContacts } = vi.hoisted(() => {
  const query = {
    select: vi.fn(), eq: vi.fn(), or: vi.fn(), order: vi.fn(), range: vi.fn(), upsert: vi.fn(),
  };
  return { rpc: vi.fn(), query, database: { from: vi.fn() }, listContacts: vi.fn() };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
vi.mock('@/integrations/supabase/identity-schema', () => ({ identitySupabase: database }));
vi.mock('@/services/dataProvider', () => ({ dataProvider: { relationships: { listContacts } } }));
import { identityReviewsRepository, IdentityReviewNotDeployedError } from './identity-reviews';
const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secondTenant = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const contactId = '00000000-0000-4000-8000-000000000001';
const targetId = '00000000-0000-4000-8000-000000000002';
const scope = { tenantId, userId };

describe('identity repository selected-tenant authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rpc.mockResolvedValue({ error: null, data: {
      authenticated: true, profile_id: userId, current_tenant_id: null, crm_role: 'crm_none',
      available_tenants: [{ tenant_id: tenantId, crm_role: 'crm_operator' }, { tenant_id: secondTenant, crm_role: 'crm_readonly' }],
    } });
    database.from.mockReturnValue(query);
    for (const name of ['select', 'eq', 'or', 'order'] as const) query[name].mockReturnValue(query);
    query.range.mockResolvedValue({ data: [], error: null });
    query.upsert.mockResolvedValue({ data: null, error: null });
  });
  it('uses an explicitly authorized tenant when the server has no auto-selected tenant', async () => {
    await expect(identityReviewsRepository.listForContact(contactId, scope)).resolves.toEqual({ items: [], nextOffset: undefined });
    expect(query.eq).toHaveBeenCalledWith('tenant_id', tenantId);
    expect(query.or).toHaveBeenCalledWith(`contact_id.eq.${contactId},and(linked_domain.eq.relationship_contact,linked_record_id.eq.${contactId})`);
    expect(query.range).toHaveBeenCalledWith(0, 25);
  });
  it('rejects a session/user switch before touching storage', async () => {
    await expect(identityReviewsRepository.listForContact(contactId, { tenantId, userId: targetId })).rejects.toThrow(/session changed/);
    expect(database.from).not.toHaveBeenCalled();
  });
  it('rejects a tenant absent from the current signed-in capability set', async () => {
    await expect(identityReviewsRepository.listForContact(contactId, { tenantId: targetId, userId })).rejects.toThrow(/authorized CRM tenant/);
    expect(database.from).not.toHaveBeenCalled();
  });
  it('keeps missing-schema reads unavailable rather than returning a successful empty list', async () => {
    query.range.mockResolvedValue({ data: null, error: { code: 'PGRST205', message: 'Missing schema cache table' } });
    await expect(identityReviewsRepository.listForContact(contactId, scope)).rejects.toBeInstanceOf(IdentityReviewNotDeployedError);
  });
  it('reads history through an inner parent relationship with the complete contact predicate', async () => {
    await identityReviewsRepository.listEventsForContact(contactId, scope, 25);
    expect(query.select).toHaveBeenCalledWith('*,review:crm_identity_reviews!inner(contact_id,linked_domain,linked_record_id)');
    expect(query.or).toHaveBeenCalledWith(expect.stringContaining('and(linked_domain.eq.relationship_contact'), { referencedTable: 'review' });
    expect(query.range).toHaveBeenCalledWith(25, 50);
  });
  it('forbids readonly decisions and operator access to protected domains', async () => {
    const input = { contactId, domain: 'provider_applicant' as const, targetId, decision: 'linked' as const, basis: 'manual' as const };
    await expect(identityReviewsRepository.decide(input, scope)).rejects.toThrow(/administrator/);
    await expect(identityReviewsRepository.decide({ ...input, domain: 'relationship_contact' }, { tenantId: secondTenant, userId })).rejects.toThrow(/editing permission/);
    expect(query.upsert).not.toHaveBeenCalled();
  });
  it('normalizes reversed contact UUIDs and writes only the review overlay', async () => {
    await identityReviewsRepository.decide({ contactId: targetId, targetId: contactId, domain: 'relationship_contact', decision: 'rejected', basis: 'email' }, scope);
    expect(database.from).toHaveBeenCalledWith('crm_identity_reviews');
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: tenantId, contact_id: contactId, linked_record_id: targetId, reviewed_by: userId }), expect.anything());
    expect(listContacts).not.toHaveBeenCalled();
  });
});
