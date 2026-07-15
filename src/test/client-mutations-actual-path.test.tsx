import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useClientMutations } from '@/hooks/canonical/useCanonicalClients';
import { CONTRACT_VERSION } from '@/lib/crm/contracts';
import { buildCanonicalRpcArgs, callCanonicalRpcWithRetry, newIdempotencyKey } from '@/lib/crm/canonicalRpcTransport';

const payloads: Record<string, unknown>[] = [];
const rpc = vi.fn();

vi.mock('@/services/dataProvider', () => ({
  dataProvider: {
    clients: {
      updateEngagement: async (id: string) => {
        const key = newIdempotencyKey();
        const args = buildCanonicalRpcArgs({ p_client_id: id, p_to_state: 'normal', p_reason: 'ui_update' }, 'tok-actual', key);
        const result = await callCanonicalRpcWithRetry(rpc, 'crm_set_engagement', args);
        if (!result.ok) throw new Error(result.message ?? result.error_code ?? 'Canonical write refused');
        return { id };
      },
    },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, retryDelay: 1 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useClientMutations canonical mutation path', () => {
  beforeEach(() => {
    payloads.length = 0;
    rpc.mockReset();
  });

  it('retries transient transport failures with one logical idempotency key and uses a new key for a later action', async () => {
    rpc.mockImplementation(async (_name, args) => {
      payloads.push(args);
      if (payloads.length === 1) throw new TypeError('fetch failed');
      return { data: { ok: true }, error: null };
    });
    const { result } = renderHook(() => useClientMutations('c1'), { wrapper });
    result.current.updateEngagement.mutate('Engaged');
    await waitFor(() => expect(result.current.updateEngagement.isSuccess).toBe(true));

    expect(payloads).toHaveLength(2);
    expect(payloads[0].p_idempotency_key).toBe(payloads[1].p_idempotency_key);
    expect(payloads[0].p_concurrency_token).toBe('tok-actual');
    expect(payloads[1].p_concurrency_token).toBe('tok-actual');
    expect(payloads[0].p_contract_version).toBe(CONTRACT_VERSION);
    expect(payloads[1].p_contract_version).toBe(CONTRACT_VERSION);

    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    result.current.updateEngagement.mutate('Engaged');
    await waitFor(() => expect(payloads).toHaveLength(3));
    expect(payloads[2].p_idempotency_key).not.toBe(payloads[0].p_idempotency_key);
  });

  it('does not retry backend ok:false results', async () => {
    rpc.mockImplementation(async (_name, args) => {
      payloads.push(args);
      return { data: { ok: false, error_code: 'invalid_transition', message: 'Nope' }, error: null };
    });
    const { result } = renderHook(() => useClientMutations('c1'), { wrapper });
    result.current.updateEngagement.mutate('Engaged');
    await waitFor(() => expect(result.current.updateEngagement.isError).toBe(true));
    expect(payloads).toHaveLength(1);
  });
});
