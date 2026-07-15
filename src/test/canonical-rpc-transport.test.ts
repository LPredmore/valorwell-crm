import { describe, expect, it, vi } from 'vitest';
import {
  buildCanonicalRpcArgs,
  callCanonicalRpcWithRetry,
  MAX_CANONICAL_RPC_ATTEMPTS,
} from '@/lib/crm/canonicalRpcTransport';
import { CONTRACT_VERSION } from '@/lib/crm/contracts';

describe('canonical RPC transport retry classification', () => {
  const args = buildCanonicalRpcArgs({ p_client_id: 'c1', p_to_state: 'normal', p_reason: 'test' }, 'tok', 'idem');

  it('retries thrown retryable transport errors once', async () => {
    const rpc = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    await expect(callCanonicalRpcWithRetry(rpc, 'crm_set_engagement', args)).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1]).toBe(args);
    expect(rpc.mock.calls[1][1]).toBe(args);
    expect(rpc.mock.calls[0][1].p_idempotency_key).toBe(rpc.mock.calls[1][1].p_idempotency_key);
    expect(rpc.mock.calls[0][1].p_concurrency_token).toBe(rpc.mock.calls[1][1].p_concurrency_token);
    expect(rpc.mock.calls[0][1].p_contract_version).toBe(rpc.mock.calls[1][1].p_contract_version);
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
    expect(rpc).toHaveBeenCalledTimes(MAX_CANONICAL_RPC_ATTEMPTS);
  });

  it('throws final returned retryable transport errors after exactly one retry', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'network timeout' } });
    await expect(callCanonicalRpcWithRetry(rpc, 'crm_set_engagement', args)).rejects.toThrow('network timeout');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('does not retry returned authorization errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(callCanonicalRpcWithRetry(rpc, 'crm_set_engagement', args)).resolves.toMatchObject({ ok: false, error_code: 'unauthorized' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['database', { code: '23505', message: 'duplicate key violates unique constraint' }, 'unknown'],
    ['database timeout', { code: '57014', message: 'canceling statement due to statement timeout' }, 'unknown'],
    ['concurrency', { message: 'concurrency conflict' }, 'concurrency_conflict'],
    ['contract', { message: 'contract version mismatch' }, 'contract_version_mismatch'],
    ['invalid transition', { message: 'invalid_transition' }, 'invalid_transition'],
  ])('does not retry returned %s errors', async (_category, error, errorCode) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    await expect(callCanonicalRpcWithRetry(rpc, 'crm_set_engagement', args)).resolves.toMatchObject({
      ok: false,
      error_code: errorCode,
    });
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
    expect(args.p_contract_version).toBe('valorwell-crm-contracts@1.0.1+20260714');
    expect(CONTRACT_VERSION).toBe('valorwell-crm-contracts@1.0.1+20260714');
  });
});
