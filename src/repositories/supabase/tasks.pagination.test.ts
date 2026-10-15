import { beforeEach, describe, expect, it, vi } from 'vitest';
const { from, query } = vi.hoisted(() => ({ from: vi.fn(), query: {
  select: vi.fn(), eq: vi.fn(), in: vi.fn(), not: vi.fn(), order: vi.fn(), range: vi.fn(),
} }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from } }));
import { supabaseTasksRepository } from './tasks';
describe('canonical task source paging', () => {
  beforeEach(() => {
    vi.resetAllMocks(); from.mockReturnValue(query);
    for (const method of ['select', 'eq', 'in', 'not', 'order'] as const) query[method].mockReturnValue(query);
    query.range.mockResolvedValue({ data: [], error: null });
  });
  it('applies tenant/view/status/priority on the source before requesting page three', async () => {
    await supabaseTasksRepository.list({ tenantId: 'tenant', view: 'team', statuses: ['Waiting'], priorities: ['Urgent'], page: 3, pageSize: 50 });
    expect(query.eq).toHaveBeenCalledWith('tenant_id', 'tenant');
    expect(query.in).toHaveBeenCalledWith('status', ['waiting']);
    expect(query.in).toHaveBeenCalledWith('priority', ['urgent']);
    expect(query.order).toHaveBeenLastCalledWith('id', { ascending: true });
    expect(query.range).toHaveBeenCalledWith(100, 149);
    expect(query.in.mock.invocationCallOrder[query.in.mock.invocationCallOrder.length-1]).toBeLessThan(query.range.mock.invocationCallOrder[0]);
  });
  it('rejects invalid pages before querying data', async () => {
    await expect(supabaseTasksRepository.list({ tenantId: 'tenant', page: -1 })).rejects.toThrow(/Invalid task page/);
    expect(from).not.toHaveBeenCalled();
  });
});
