import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngagementState } from '@/domain/canonical';
import type { Database } from '@/integrations/supabase/types';
import { CONTRACT_VERSION } from '@/lib/crm/contracts';
import { supabaseClientsRepository } from '@/repositories/supabase/clients';

type CanonicalRow = Database['public']['Views']['v_client_canonical_state']['Row'];
type RpcPayload = Record<string, unknown>;

interface ClientIdentityRow {
  id: string;
  tenant_id: string;
  pat_name_f: string | null;
  pat_name_m: string | null;
  pat_name_l: string | null;
  pat_name_preferred: string | null;
  email: string | null;
  phone: string | null;
  pat_state: string | null;
  pat_dob: string | null;
  tags: string[];
  last_contact_at: string | null;
  last_contact_channel: string | null;
  last_contact_direction: string | null;
  created_at: string;
  updated_at: string;
}

const boundary = vi.hoisted(() => {
  const canonicalRows: CanonicalRow[] = [];
  const clientRows: ClientIdentityRow[] = [];
  return {
    canonicalRows,
    clientRows,
    rpc: vi.fn(),
  };
});

vi.mock('@/integrations/supabase/client', () => {
  function valueAt(row: object, column: string): unknown {
    return Object.entries(row).find(([key]) => key === column)?.[1];
  }

  class FakeQuery<T extends object> {
    private readonly filters: Array<{ column: string; value: unknown }> = [];

    constructor(private readonly rows: T[]) {}

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push({ column, value });
      return this;
    }

    maybeSingle() {
      const rows = this.filters.reduce(
        (matches, filter) => matches.filter(
          (row) => valueAt(row, filter.column) === filter.value,
        ),
        [...this.rows],
      );
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }
  }

  return {
    supabase: {
      from: (table: string) => table === 'v_client_canonical_state'
        ? new FakeQuery(boundary.canonicalRows)
        : new FakeQuery(boundary.clientRows),
      rpc: boundary.rpc,
    },
  };
});

function canonical(id: string): CanonicalRow {
  return {
    client_id: id,
    tenant_id: 't1',
    lifecycle: 'scheduled',
    engagement: 'normal',
    eligibility: 'eligible',
    contact_policy: 'normal',
    service_policy: 'normal',
    care_cadence: 'regular',
    assigned_therapist_id: null,
    at_risk: { at_risk: false },
    concurrency_token: `tok-${id}`,
    contract_version: CONTRACT_VERSION,
    disposition_at: null,
    disposition_reason: null,
    eligibility_manual_review: null,
    next_appointment_at: null,
    provider_demand_state: null,
    updated_at: '2026-07-15T00:00:00Z',
  };
}

function client(id: string): ClientIdentityRow {
  return {
    id,
    tenant_id: 't1',
    pat_name_f: 'Actual',
    pat_name_m: null,
    pat_name_l: 'Path',
    pat_name_preferred: null,
    email: 'actual.path@example.com',
    phone: null,
    pat_state: 'WA',
    pat_dob: null,
    tags: [],
    last_contact_at: null,
    last_contact_channel: null,
    last_contact_direction: null,
    created_at: '2026-07-14T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
  };
}

describe('supabaseClientsRepository canonical mutation path', () => {
  beforeEach(() => {
    boundary.rpc.mockReset();
    boundary.canonicalRows = [canonical('c1')];
    boundary.clientRows = [client('c1')];
  });

  it('reuses one action context for retry and creates a new key when the same input object is reused', async () => {
    const payloads: RpcPayload[] = [];
    let transientFailuresRemaining = 1;
    boundary.rpc.mockImplementation(async (_name: string, args: RpcPayload) => {
      payloads.push(args);
      if (transientFailuresRemaining > 0) {
        transientFailuresRemaining -= 1;
        throw new TypeError('fetch failed');
      }
      return { data: { ok: true }, error: null };
    });
    const action = {
      id: 'c1',
      next: 'Engaged',
    } satisfies { id: string; next: EngagementState };

    await expect(supabaseClientsRepository.updateEngagement(action.id, action.next))
      .resolves.toMatchObject({ id: 'c1' });
    expect(boundary.rpc).toHaveBeenCalledTimes(2);
    expect(payloads[0].p_idempotency_key).toBe(payloads[1].p_idempotency_key);
    expect(payloads[0].p_concurrency_token).toBe('tok-c1');
    expect(payloads[1].p_concurrency_token).toBe('tok-c1');
    expect(payloads[0].p_contract_version).toBe(CONTRACT_VERSION);
    expect(payloads[1].p_contract_version).toBe(CONTRACT_VERSION);

    await expect(supabaseClientsRepository.updateEngagement(action.id, action.next))
      .resolves.toMatchObject({ id: 'c1' });
    expect(boundary.rpc).toHaveBeenCalledTimes(3);
    expect(payloads).toHaveLength(3);
    expect(payloads[2].p_idempotency_key).not.toBe(payloads[0].p_idempotency_key);
    expect(payloads[2].p_contract_version).toBe(CONTRACT_VERSION);
  });

  it('throws a final transient transport failure after exactly two attempts', async () => {
    const payloads: RpcPayload[] = [];
    boundary.rpc.mockImplementation(async (_name: string, args: RpcPayload) => {
      payloads.push(args);
      throw new TypeError('fetch failed');
    });

    await expect(supabaseClientsRepository.updateEngagement('c1', 'Engaged'))
      .rejects.toThrow('fetch failed');
    expect(boundary.rpc).toHaveBeenCalledTimes(2);
    expect(payloads[0].p_idempotency_key).toBe(payloads[1].p_idempotency_key);
    expect(payloads[0].p_concurrency_token).toBe(payloads[1].p_concurrency_token);
  });

  it('retries one returned transient Supabase error', async () => {
    const payloads: RpcPayload[] = [];
    let attempts = 0;
    boundary.rpc.mockImplementation(async (_name: string, args: RpcPayload) => {
      payloads.push(args);
      attempts += 1;
      if (attempts === 1) {
        return {
          data: null,
          error: { code: '503', message: 'service unavailable' },
        };
      }
      return { data: { ok: true }, error: null };
    });

    await expect(supabaseClientsRepository.updateEngagement('c1', 'Engaged'))
      .resolves.toMatchObject({ id: 'c1' });
    expect(boundary.rpc).toHaveBeenCalledTimes(2);
    expect(payloads[0].p_idempotency_key).toBe(payloads[1].p_idempotency_key);
    expect(payloads[0].p_concurrency_token).toBe(payloads[1].p_concurrency_token);
  });

  it('does not retry a backend ok:false business result', async () => {
    boundary.rpc.mockResolvedValue({
      data: { ok: false, error_code: 'invalid_transition', message: 'Nope' },
      error: null,
    });

    await expect(supabaseClientsRepository.updateEngagement('c1', 'Engaged'))
      .rejects.toThrow('Nope');
    expect(boundary.rpc).toHaveBeenCalledTimes(1);
  });
});
