import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseClientsRepository } from '@/repositories/supabase/clients';
import type { Database } from '@/integrations/supabase/types';

type CanonicalRow = Database['public']['Views']['v_client_canonical_state']['Row'];

type Filter = { column: string; values?: unknown[]; value?: unknown };

const calls: Record<string, Filter[]> = { canonical: [], clients: [] };
let canonicalRows: CanonicalRow[] = [];
let clientRows: Record<string, unknown>[] = [];

class FakeQuery<T extends Record<string, unknown>> {
  constructor(private readonly table: 'canonical' | 'clients', private readonly rows: T[]) {}
  private filters: Filter[] = [];
  select() { return this; }
  in(column: string, values: unknown[]) { this.filters.push({ column, values }); calls[this.table].push({ column, values }); return this; }
  eq(column: string, value: unknown) { this.filters.push({ column, value }); calls[this.table].push({ column, value }); return this; }
  or(expression: string) { this.filters.push({ column: 'or', value: expression }); calls[this.table].push({ column: 'or', value: expression }); return this; }
  range(from: number, to: number) {
    let rows = [...this.rows];
    for (const filter of this.filters) {
      if (filter.values) rows = rows.filter((row) => filter.values?.includes(row[filter.column]));
      if (filter.column === 'or' && typeof filter.value === 'string') rows = rows.filter((row) => String(row.pat_name_l).includes('Needle'));
    }
    return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
  }
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => table === 'v_client_canonical_state'
      ? new FakeQuery('canonical', canonicalRows as unknown as Record<string, unknown>[])
      : new FakeQuery('clients', clientRows),
    rpc: vi.fn(),
  },
}));

function canonical(id: string, lifecycle = 'scheduled'): CanonicalRow {
  return {
    client_id: id,
    tenant_id: 't1',
    lifecycle,
    engagement: 'normal',
    eligibility: 'eligible',
    contact_policy: 'normal',
    service_policy: 'normal',
    care_cadence: 'regular',
    assigned_therapist_id: null,
    at_risk: { at_risk: false },
    concurrency_token: `tok-${id}`,
    contract_version: 'valorwell-crm-contracts@1.0.1+20260714',
    disposition_at: null,
    disposition_reason: null,
    eligibility_manual_review: null,
    next_appointment_at: null,
    provider_demand_state: null,
    updated_at: `2026-01-${id.padStart(2, '0')}T00:00:00Z`,
  };
}

function client(id: string, state: string, last: string) {
  return {
    id,
    tenant_id: 't1',
    pat_name_f: 'Test',
    pat_name_m: null,
    pat_name_l: last,
    pat_name_preferred: null,
    email: null,
    phone: null,
    pat_state: state,
    pat_dob: null,
    tags: [],
    last_contact_at: null,
    last_contact_channel: null,
    last_contact_direction: null,
    created_at: `2026-01-${id.padStart(2, '0')}T00:00:00Z`,
    updated_at: `2026-02-${id.padStart(2, '0')}T00:00:00Z`,
  };
}

describe('supabaseClientsRepository.list query composition', () => {
  beforeEach(() => {
    calls.canonical = [];
    calls.clients = [];
    canonicalRows = [canonical('1'), canonical('2'), canonical('3', 'closed'), canonical('4')];
    clientRows = [client('1', 'WA', 'Needle C'), client('2', 'CA', 'Needle A'), client('3', 'WA', 'Needle B'), client('4', 'WA', 'Other')];
  });

  it('applies source filters before composition, intersects them, totals after intersection, and paginates after global sorting', async () => {
    const result = await supabaseClientsRepository.list({ lifecycle: ['Scheduled'], states: ['WA'], search: 'Needle', sortBy: 'legalLastName', sortDir: 'asc', page: 1, pageSize: 1 });
    expect(calls.canonical).toContainEqual({ column: 'lifecycle', values: ['scheduled'] });
    expect(calls.clients).toContainEqual({ column: 'pat_state', values: ['WA'] });
    expect(calls.clients.some((call) => call.column === 'or')).toBe(true);
    expect(result.total).toBe(1);
    expect(result.rows.map((row) => row.id)).toEqual(['1']);
  });
});
