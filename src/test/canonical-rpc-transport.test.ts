import { describe, expect, it, vi } from 'vitest';
import { callCanonicalRpcWithRetry, buildCanonicalRpcArgs } from '@/lib/crm/canonicalRpcTransport';
import { CONTRACT_VERSION } from '@/lib/crm/contracts';

describe('canonical RPC transport retry classification', () => {
  const args = buildCanonicalRpcArgs({ p_client_id: 'c1', p_to_state: 'normal', p_reason: 'test' }, 'tok', 'idem');

  it('retries thrown retryable transport errors once', async () => {
    const rpc = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    await expect(callCanonicalRpcWithRetry(rpc, 'crm_set_engagement', args)).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1].p_idempotency_key).toBe(rpc.mock.calls[1][1].p_idempotency_key);
  });

  it('retries returned retryable transport errors once', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'network timeout' } })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    await expect(callCanonicalRpcWithRetry(rpc, 'crm_set_engagement', args)).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(2);
  });



  it('throws final transient transport failures after exactly one retry', async () => {
    const rpc = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(callCanonicalRpcWithRetry(rpc, 'crm_set_engagement', args)).rejects.toThrow('fetch failed');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('throws final returned retryable transport errors after exactly one retry', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'network timeout' } });
    await expect(callCanonicalRpcWithRetry(rpc, 'crm_set_engagement', args)).rejects.toThrow('network timeout');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('does not retry returned nonretryable database errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(callCanonicalRpcWithRetry(rpc, 'crm_set_engagement', args)).resolves.toMatchObject({ ok: false, error_code: '42501' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not retry backend ok:false business results', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: false, error_code: 'invalid_transition', message: 'Nope' }, error: null });
    await expect(callCanonicalRpcWithRetry(rpc, 'crm_set_engagement', args)).resolves.toMatchObject({ ok: false, error_code: 'invalid_transition' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('preserves concurrency token, idempotency key, and contract version in the shared args builder', () => {
    expect(args.p_concurrency_token).toBe('tok');
    expect(args.p_idempotency_key).toBe('idem');
    expect(args.p_contract_version).toBe(CONTRACT_VERSION);
  });
});
