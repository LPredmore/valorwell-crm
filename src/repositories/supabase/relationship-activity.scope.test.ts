import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, from, query } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(),
  query: { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc, from } }));
import { listRelationshipEmails } from './relationship-activity';
const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
beforeEach(() => {
  vi.resetAllMocks(); from.mockReturnValue(query);
  for (const method of ['select', 'eq', 'order'] as const) query[method].mockReturnValue(query);
  query.range.mockResolvedValue({ data: [], count: 0, error: null });
  rpc.mockResolvedValue({ data: { authenticated: true, profile_id: userId, current_tenant_id: null,
    available_tenants: [{ tenant_id: tenantId, crm_role: 'crm_readonly' }] }, error: null });
});
describe('relationship-only email timeline selected scope', () => {
  it('pages the selected authorized tenant without requiring server automatic selection', async () => {
    await expect(listRelationshipEmails({ contactId: 'contact' }, 2, { tenantId, userId }))
      .resolves.toEqual({ items: [], total: 0 });
    expect(from).toHaveBeenCalledWith('relationship_communications');
    expect(query.eq).toHaveBeenCalledWith('tenant_id', tenantId);
    expect(query.eq).toHaveBeenCalledWith('contact_id', 'contact');
    expect(query.range).toHaveBeenCalledWith(100, 199);
  });
  it('does not request messages for a different session or unauthorized tenant', async () => {
    await expect(listRelationshipEmails({ contactId: 'contact' }, 1, { tenantId, userId: 'other' }))
      .rejects.toThrow(/current session/);
    expect(from).not.toHaveBeenCalled();
  });
});
