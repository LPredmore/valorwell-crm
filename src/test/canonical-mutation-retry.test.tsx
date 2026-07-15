import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT_VERSION } from '@/lib/crm/contracts';
import { useSetEngagement } from '@/hooks/crm/useCanonicalMutations';
import type {
  CanonicalRpcArgsByName,
  RpcErrorLike,
} from '@/lib/crm/canonicalRpcTransport';

type EngagementRpcArgs = CanonicalRpcArgsByName['crm_set_engagement'];
type MockRpc = (
  name: string,
  args: EngagementRpcArgs,
) => Promise<{ data: unknown; error: RpcErrorLike | null }>;

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn<MockRpc>() }));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retryDelay: 1 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('canonical mutation retry idempotency', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('reuses one idempotency key across a retryable transport failure and changes it for a later action', async () => {
    const payloads: EngagementRpcArgs[] = [];
    rpc.mockImplementation(async (_name, args) => {
      payloads.push(args);
      if (payloads.length === 1) throw new TypeError('fetch failed');
      return { data: { ok: true }, error: null };
    });

    const { result } = renderHook(() => useSetEngagement(), { wrapper });
    await result.current.mutateAsync({ client_id: 'c1', to_state: 'normal', reason: 'ui', concurrency_token: 'tok-1' });

    expect(payloads).toHaveLength(2);
    expect(payloads[0].p_idempotency_key).toBe(payloads[1].p_idempotency_key);
    expect(payloads[0].p_concurrency_token).toBe('tok-1');
    expect(payloads[1].p_concurrency_token).toBe('tok-1');
    expect(payloads[0].p_contract_version).toBe(CONTRACT_VERSION);
    expect(payloads[1].p_contract_version).toBe(CONTRACT_VERSION);

    rpc.mockImplementation(async (_name, args) => {
      payloads.push(args);
      return { data: { ok: true }, error: null };
    });
    await result.current.mutateAsync({ client_id: 'c1', to_state: 'normal', reason: 'ui', concurrency_token: 'tok-1' });
    expect(payloads).toHaveLength(3);
    expect(payloads[2].p_idempotency_key).not.toBe(payloads[0].p_idempotency_key);
  });

  it('uses a new idempotency key when the same input object is reused for a later action', async () => {
    const payloads: EngagementRpcArgs[] = [];
    rpc.mockImplementation(async (_name, args) => {
      payloads.push(args);
      return { data: { ok: true }, error: null };
    });

    const input = { client_id: 'c1', to_state: 'normal', reason: 'ui', concurrency_token: 'tok-1' };
    const { result } = renderHook(() => useSetEngagement(), { wrapper });
    await result.current.mutateAsync(input);
    await result.current.mutateAsync(input);

    expect(payloads).toHaveLength(2);
    expect(payloads[1].p_idempotency_key).not.toBe(payloads[0].p_idempotency_key);
  });

  it('does not retry backend ok:false business results', async () => {
    rpc.mockResolvedValue({ data: { ok: false, error_code: 'invalid_transition', message: 'Nope' }, error: null });
    const { result } = renderHook(() => useSetEngagement(), { wrapper });
    await result.current.mutateAsync({ client_id: 'c1', to_state: 'normal', reason: 'ui', concurrency_token: 'tok-1' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('stops after two attempts when the final transport failure is transient', async () => {
    rpc.mockRejectedValue(new TypeError('fetch failed'));
    const { result } = renderHook(() => useSetEngagement(), { wrapper });
    await expect(result.current.mutateAsync({
      client_id: 'c1',
      to_state: 'normal',
      reason: 'ui',
      concurrency_token: 'tok-1',
    })).rejects.toThrow('fetch failed');
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
