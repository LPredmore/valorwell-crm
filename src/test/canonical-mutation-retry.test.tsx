import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import { CONTRACT_VERSION } from '@/lib/crm/contracts';
import { useSetEngagement } from '@/hooks/crm/useCanonicalMutations';

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn() },
}));

const rpc = vi.mocked(supabase.rpc);

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retryDelay: 1 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('canonical mutation retry idempotency', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('reuses one idempotency key across a retryable transport failure and changes it for a later action', async () => {
    const payloads: unknown[] = [];
    rpc.mockImplementation(async (_name, args) => {
      payloads.push(args);
      if (payloads.length === 1) throw new TypeError('fetch failed');
      return { data: { ok: true }, error: null } as never;
    });

    const { result } = renderHook(() => useSetEngagement(), { wrapper });
    result.current.mutate({ client_id: 'c1', to_state: 'normal', reason: 'ui', concurrency_token: 'tok-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(payloads).toHaveLength(2);
    expect((payloads[0] as Record<string, unknown>).p_idempotency_key).toBe((payloads[1] as Record<string, unknown>).p_idempotency_key);
    expect((payloads[0] as Record<string, unknown>).p_concurrency_token).toBe('tok-1');
    expect((payloads[1] as Record<string, unknown>).p_concurrency_token).toBe('tok-1');
    expect((payloads[0] as Record<string, unknown>).p_contract_version).toBe(CONTRACT_VERSION);
    expect((payloads[1] as Record<string, unknown>).p_contract_version).toBe(CONTRACT_VERSION);

    rpc.mockResolvedValue({ data: { ok: true }, error: null } as never);
    result.current.mutate({ client_id: 'c1', to_state: 'normal', reason: 'ui', concurrency_token: 'tok-1' });
    await waitFor(() => expect(payloads).toHaveLength(3));
    expect((payloads[2] as Record<string, unknown>).p_idempotency_key).not.toBe((payloads[0] as Record<string, unknown>).p_idempotency_key);
  });



  it('uses a new idempotency key when the same input object is reused for a later action', async () => {
    const payloads: unknown[] = [];
    rpc.mockImplementation(async (_name, args) => {
      payloads.push(args);
      return { data: { ok: true }, error: null } as never;
    });

    const input = { client_id: 'c1', to_state: 'normal', reason: 'ui', concurrency_token: 'tok-1' };
    const { result } = renderHook(() => useSetEngagement(), { wrapper });
    result.current.mutate(input);
    await waitFor(() => expect(payloads).toHaveLength(1));
    result.current.mutate(input);
    await waitFor(() => expect(payloads).toHaveLength(2));

    expect((payloads[1] as Record<string, unknown>).p_idempotency_key).not.toBe((payloads[0] as Record<string, unknown>).p_idempotency_key);
  });

  it('does not retry backend ok:false business results', async () => {
    rpc.mockResolvedValue({ data: { ok: false, error_code: 'invalid_transition', message: 'Nope' }, error: null } as never);
    const { result } = renderHook(() => useSetEngagement(), { wrapper });
    result.current.mutate({ client_id: 'c1', to_state: 'normal', reason: 'ui', concurrency_token: 'tok-1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
