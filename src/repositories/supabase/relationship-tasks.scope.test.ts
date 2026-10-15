import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, from, query, complete } = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), complete: vi.fn(),
  query: { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), range: vi.fn() },
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc, from } }));
vi.mock('@/services/dataProvider', () => ({ dataProvider: { tasks: { complete } } }));
import { relationshipTasksRepository, type RelationshipTaskRow } from './relationship-tasks';
const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherTenant = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const scope = { tenantId, userId };
describe('selected tenant relationship task authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rpc.mockResolvedValue({ data: { authenticated: true, profile_id: userId, current_tenant_id: null,
      available_tenants: [{ tenant_id: tenantId, crm_role: 'crm_operator' }, { tenant_id: otherTenant, crm_role: 'crm_readonly' }] }, error: null });
    from.mockReturnValue(query);
    for (const method of ['select', 'eq', 'in', 'order'] as const) query[method].mockReturnValue(query);
    query.range.mockResolvedValue({ data: [], error: null });
  });
  it('reads the explicitly selected authorized tenant even without server auto-selection', async () => {
    await relationshipTasksRepository.list({ contactId: 'contact' }, scope, { page: 3, view: 'open' });
    expect(query.eq).toHaveBeenCalledWith('tenant_id', tenantId);
    expect(query.range).toHaveBeenCalledWith(100, 149);
  });
  it('rejects a changed session before requesting tasks', async () => {
    await expect(relationshipTasksRepository.list({ contactId: 'contact' }, { ...scope, userId: 'different' })).rejects.toThrow(/current session/);
    expect(from).not.toHaveBeenCalled();
  });
  it('denies readonly and foreign-tenant task mutations', async () => {
    const task = { id: 'task', tenant_id: otherTenant } as RelationshipTaskRow;
    await expect(relationshipTasksRepository.complete(task, { tenantId: otherTenant, userId })).rejects.toThrow(/permission/);
    await expect(relationshipTasksRepository.complete(task, scope)).rejects.toThrow(/permission/);
    expect(complete).not.toHaveBeenCalled();
  });
});
