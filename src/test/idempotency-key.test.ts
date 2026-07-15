import { describe, it, expect } from 'vitest';
import {
  buildCanonicalRpcArgs,
  newIdempotencyKey,
} from '@/lib/crm/canonicalRpcTransport';
import { CONTRACT_VERSION } from '@/lib/crm/contracts';

describe('canonical RPC idempotency-key handling', () => {
  it('forwards a caller-provided key verbatim on retry (retry safety)', () => {
    const key = '11111111-1111-4111-8111-111111111111';
    const a = buildCanonicalRpcArgs({ p_client_id: 'c1' }, 'tok', key);
    const b = buildCanonicalRpcArgs({ p_client_id: 'c1' }, 'tok', key);
    expect(a.p_idempotency_key).toBe(key);
    expect(b.p_idempotency_key).toBe(key);
    expect(a.p_contract_version).toBe(CONTRACT_VERSION);
  });

  it('generates a fresh UUID for each new action when no key is supplied', () => {
    const a = buildCanonicalRpcArgs({ p_client_id: 'c1' }, 'tok', undefined);
    const b = buildCanonicalRpcArgs({ p_client_id: 'c1' }, 'tok', undefined);
    expect(a.p_idempotency_key).not.toBe(b.p_idempotency_key);
    expect(String(a.p_idempotency_key)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('newIdempotencyKey produces unique UUIDs across invocations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(newIdempotencyKey());
    expect(seen.size).toBe(50);
  });
});

describe('logical retry idempotency behavior', () => {
  it('reuses one logical action key across a retry and uses a new key for a later action', async () => {
    const payloads: Record<string, unknown>[] = [];
    const logicalActionKey = newIdempotencyKey();
    const attempt = async () => {
      const payload = buildCanonicalRpcArgs({ p_client_id: 'c1' }, 'tok', logicalActionKey);
      payloads.push(payload);
      if (payloads.length === 1) throw new TypeError('fetch failed');
      return { ok: true };
    };

    await expect(attempt()).rejects.toThrow('fetch failed');
    await expect(attempt()).resolves.toEqual({ ok: true });

    const laterAction = buildCanonicalRpcArgs({ p_client_id: 'c1' }, 'tok', newIdempotencyKey());
    expect(payloads[0].p_idempotency_key).toBe(logicalActionKey);
    expect(payloads[1].p_idempotency_key).toBe(logicalActionKey);
    expect(laterAction.p_idempotency_key).not.toBe(logicalActionKey);
  });
});
