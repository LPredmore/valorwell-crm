import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInterestMutations } from '@/hooks/crm/useCreatorCommunityInterest';

const boundary = vi.hoisted(() => {
  const calls: { table: string; action: string; payload?: unknown; filters: [string, unknown][] }[] = [];
  return { calls, row: { id: 'row-id' } as unknown };
});

vi.mock('@/hooks/crm/useCrmAuth', () => ({ useCrmAuth: () => ({ tenantId: 'tenant-a', userId: 'profile-a', isAuthenticated: true, capabilities: { mutate: true } }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (name: string, payload: unknown) => {
      boundary.calls.push({ table: name, action: 'rpc', payload, filters: [] });
      return Promise.resolve({ data: boundary.row === null ? null : { ok: true }, error: null });
    },
    from: (table: string) => {
      const entry = { table, action: '', payload: undefined as unknown, filters: [] as [string, unknown][] };
      const chain = {
        update(payload: unknown) { entry.action = 'update'; entry.payload = payload; boundary.calls.push(entry); return chain; },
        insert(payload: unknown) { entry.action = 'insert'; entry.payload = payload; boundary.calls.push(entry); return chain; },
        upsert(payload: unknown) { entry.action = 'upsert'; entry.payload = payload; boundary.calls.push(entry); return chain; },
        delete() { entry.action = 'delete'; boundary.calls.push(entry); return chain; },
        eq(column: string, value: unknown) { entry.filters.push([column, value]); return chain; },
        select() { return chain; },
        maybeSingle() { return Promise.resolve({ data: boundary.row, error: null }); },
      };
      return chain;
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{children}</QueryClientProvider>;
}

describe('creator/community interest mutations', () => {
  beforeEach(() => { boundary.calls.length = 0; boundary.row = { id: 'row-id' }; });

  it('uses one tenant-scoped RPC for canonical contact and profile corrections', async () => {
    const { result } = renderHook(() => useInterestMutations('contact-a'), { wrapper });
    await act(() => result.current.updateRecord.mutateAsync({
      contactChanges: { first_name: 'Corrected' },
      profileChanges: { motivation: 'Corrected motivation' },
    }));
    expect(boundary.calls[0]).toMatchObject({
      table: 'update_creator_interest_record',
      action: 'rpc',
      payload: {
        p_tenant_id: 'tenant-a',
        p_contact_id: 'contact-a',
        p_contact_changes: { first_name: 'Corrected' },
        p_profile_changes: { motivation: 'Corrected motivation' },
      },
    });
  });

  it('sends do-not-contact workflow changes through the tenant-scoped atomic RPC', async () => {
    const { result } = renderHook(() => useInterestMutations('contact-a'), { wrapper });
    await act(() => result.current.updateRecord.mutateAsync({
      contactChanges: {
        review_state: 'managed',
        outreach_status: 'do_not_contact',
        do_not_contact: true,
      },
    }));
    expect(boundary.calls[0]).toMatchObject({
      table: 'update_creator_interest_record',
      action: 'rpc',
      payload: {
        p_tenant_id: 'tenant-a',
        p_contact_id: 'contact-a',
        p_contact_changes: {
          review_state: 'managed',
          outreach_status: 'do_not_contact',
          do_not_contact: true,
        },
      },
    });
  });

  it('fails safely when the atomic RPC does not confirm an update', async () => {
    boundary.row = null;
    const { result } = renderHook(() => useInterestMutations('contact-a'), { wrapper });
    await expect(result.current.updateRecord.mutateAsync({ contactChanges: { review_state: 'managed' } })).rejects.toThrow('Unable to update this interest record.');
  });

  it('writes interaction notes into the existing tenant-scoped crm_notes model', async () => {
    const { result } = renderHook(() => useInterestMutations('contact-a'), { wrapper });
    await act(() => result.current.addNote.mutateAsync(' Followed up '));
    expect(boundary.calls[0]).toMatchObject({ table: 'crm_notes', action: 'insert', payload: { tenant_id: 'tenant-a', relationship_contact_id: 'contact-a', created_by_profile_id: 'profile-a', note_content: 'Followed up', note_type: 'internal' } });
  });

  it('adds and removes roles within the active tenant and contact', async () => {
    const { result } = renderHook(() => useInterestMutations('contact-a'), { wrapper });
    await act(() => result.current.addRole.mutateAsync('creator'));
    await act(() => result.current.removeRole.mutateAsync('creator'));
    expect(boundary.calls[0]).toMatchObject({ table: 'relationship_contact_roles', action: 'upsert', payload: { tenant_id: 'tenant-a', contact_id: 'contact-a', role_code: 'creator' } });
    expect(boundary.calls[1]).toMatchObject({ table: 'relationship_contact_roles', action: 'delete', filters: [['tenant_id', 'tenant-a'], ['contact_id', 'contact-a'], ['role_code', 'creator']] });
  });

  it('rejects non-interest role mutations before issuing a database request', async () => {
    const { result } = renderHook(() => useInterestMutations('contact-a'), { wrapper });
    await expect(result.current.addRole.mutateAsync('clinician')).rejects.toThrow('cannot be changed');
    await expect(result.current.removeRole.mutateAsync('clinician')).rejects.toThrow('cannot be changed');
    expect(boundary.calls).toEqual([]);
  });
});
