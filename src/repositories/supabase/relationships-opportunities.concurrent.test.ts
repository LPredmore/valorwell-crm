// Prepared only; execution deferred to Todoist task 42.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { context, from, query } = vi.hoisted(() => ({ context: vi.fn(), from: vi.fn(),
  query: { update: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn() } }));
vi.mock('../selectedCrmScope', () => ({ selectedRelationshipContext: context }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from } }));
vi.mock('./relationships-referrals', () => ({ supabaseRelationshipsRepository: {} }));
import { supabaseRelationshipsRepository } from './relationships-opportunities';
beforeEach(() => {
  vi.resetAllMocks(); context.mockResolvedValue({ tenantId: 'tenant', profileId: 'actor', canMutate: true });
  from.mockReturnValue(query);
  for (const method of ['update', 'eq', 'select'] as const) query[method].mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: null, error: null });
});
describe('ordinary opportunity field stale-write rejection', () => {
  it('conditions a field update on the displayed source timestamp and rejects a lost race', async () => {
    const updatedAt = '2026-10-15T12:00:00.123456+00:00';
    await expect(supabaseRelationshipsRepository.updateOpportunity('opportunity', { ownerId: 'owner', expectedUpdatedAt: updatedAt }))
      .rejects.toThrow(/changed or is unavailable/);
    expect(query.eq).toHaveBeenCalledWith('tenant_id', 'tenant');
    expect(query.eq).toHaveBeenCalledWith('updated_at', updatedAt);
    expect(query.update).toHaveBeenCalledWith({ updated_by_profile_id: 'actor', owner_profile_id: 'owner' });
  });
  it('rejects readonly edits and malformed optimistic evidence before requesting a write', async () => {
    context.mockResolvedValueOnce({ canMutate: false });
    await expect(supabaseRelationshipsRepository.updateOpportunity('opportunity', {})).rejects.toThrow(/permission/);
    await expect(supabaseRelationshipsRepository.updateOpportunity('opportunity', { expectedUpdatedAt: 'bad' })).rejects.toThrow(/timestamp/);
    expect(from).not.toHaveBeenCalled();
  });
});
