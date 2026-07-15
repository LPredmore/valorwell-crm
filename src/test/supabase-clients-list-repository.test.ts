import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/integrations/supabase/types';
import { supabaseClientsRepository } from '@/repositories/supabase/clients';

type CanonicalRow = Database['public']['Views']['v_client_canonical_state']['Row'];

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

type FakeTable = 'canonical' | 'clients';
type Filter = { column: string; values?: unknown[]; value?: unknown };

const boundary = vi.hoisted(() => {
  const canonicalRows: CanonicalRow[] = [];
  const clientRows: ClientIdentityRow[] = [];
  const calls: Record<FakeTable, Filter[]> = { canonical: [], clients: [] };
  const ranges: Record<FakeTable, Array<{ from: number; to: number }>> = { canonical: [], clients: [] };
  return {
    calls,
    canonicalRows,
    clientRows,
    ranges,
    rpc: vi.fn(),
  };
});

vi.mock('@/integrations/supabase/client', () => {
  function valueAt(row: object, column: string): unknown {
    const directEntry = Object.entries(row).find(([key]) => key === column);
    if (directEntry) return directEntry[1];

    const [rootColumn, jsonKey] = column.split('->>');
    if (!jsonKey) return undefined;
    const root = Object.entries(row).find(([key]) => key === rootColumn)?.[1];
    if (typeof root !== 'object' || root === null || Array.isArray(root)) return undefined;
    return Object.entries(root).find(([key]) => key === jsonKey)?.[1];
  }

  function matchesOrExpression(row: object, expression: string): boolean {
    const needle = expression.match(/ilike\.%([^%]+)%/i)?.[1]?.toLowerCase();
    if (!needle) return true;
    return ['pat_name_f', 'pat_name_l', 'pat_name_preferred', 'email', 'phone'].some((column) => {
      const value = valueAt(row, column);
      return typeof value === 'string' && value.toLowerCase().includes(needle);
    });
  }

  class FakeQuery<T extends object> {
    private readonly filters: Filter[] = [];

    constructor(
      private readonly table: FakeTable,
      private readonly rows: T[],
    ) {}

    select() {
      return this;
    }

    in(column: string, values: unknown[]) {
      const filter = { column, values };
      this.filters.push(filter);
      boundary.calls[this.table].push(filter);
      return this;
    }

    eq(column: string, value: unknown) {
      const filter = { column, value };
      this.filters.push(filter);
      boundary.calls[this.table].push(filter);
      return this;
    }

    or(expression: string) {
      const filter = { column: 'or', value: expression };
      this.filters.push(filter);
      boundary.calls[this.table].push(filter);
      return this;
    }

    maybeSingle() {
      return this.range(0, this.rows.length).then(({ data, error }) => ({
        data: data?.[0] ?? null,
        error,
      }));
    }

    range(from: number, to: number) {
      boundary.ranges[this.table].push({ from, to });
      let rows = [...this.rows];
      for (const filter of this.filters) {
        if (filter.values) {
          rows = rows.filter((row) => filter.values?.includes(valueAt(row, filter.column)));
        } else if (filter.column === 'or' && typeof filter.value === 'string') {
          const expression = filter.value;
          rows = rows.filter((row) => matchesOrExpression(row, expression));
        } else if (filter.value !== undefined) {
          rows = rows.filter((row) => valueAt(row, filter.column) === filter.value);
        }
      }
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    }
  }

  return {
    supabase: {
      from: (table: string) => table === 'v_client_canonical_state'
        ? new FakeQuery('canonical', boundary.canonicalRows)
        : new FakeQuery('clients', boundary.clientRows),
      rpc: boundary.rpc,
    },
  };
});

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

function client(id: string, state: string, last: string): ClientIdentityRow {
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
    boundary.calls.canonical = [];
    boundary.calls.clients = [];
    boundary.ranges.canonical = [];
    boundary.ranges.clients = [];
    boundary.rpc.mockReset();
    boundary.canonicalRows = [
      canonical('1'),
      canonical('2'),
      canonical('3', 'closed'),
      canonical('4'),
    ];
    boundary.clientRows = [
      client('1', 'WA', 'Needle Zulu'),
      client('2', 'WA', 'Needle Alpha'),
      client('3', 'WA', 'Needle Bravo'),
      client('4', 'WA', 'Other Echo'),
    ];
  });

  it('filters before final pagination, reports the final intersection total, and sorts globally', async () => {
    const result = await supabaseClientsRepository.list({
      lifecycle: ['Scheduled'],
      states: ['WA'],
      search: 'Needle',
      sortBy: 'legalLastName',
      sortDir: 'asc',
      page: 2,
      pageSize: 1,
    });

    expect(boundary.calls.canonical).toContainEqual({ column: 'lifecycle', values: ['scheduled'] });
    expect(boundary.calls.clients).toContainEqual({ column: 'pat_state', values: ['WA'] });
    expect(boundary.calls.clients.some((call) => call.column === 'or')).toBe(true);
    expect(result.total).toBe(2);
    expect(result.rows.map((row) => row.id)).toEqual(['1']);
    expect(result.rows.map((row) => row.legalLastName)).toEqual(['Needle Zulu']);
  });

  it('allows an exactly-at-limit candidate set after checking the next row', async () => {
    boundary.canonicalRows = Array.from(
      { length: 10_000 },
      (_, index) => canonical(String(index + 1)),
    );
    boundary.clientRows = [];

    await expect(supabaseClientsRepository.list({ page: 1, pageSize: 50 })).resolves.toEqual({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
    expect(boundary.ranges.canonical.at(-1)).toEqual({ from: 10_000, to: 10_000 });
  });

  it('throws clearly instead of truncating an overflowing canonical candidate set', async () => {
    boundary.canonicalRows = Array.from(
      { length: 10_001 },
      (_, index) => canonical(String(index + 1)),
    );
    boundary.clientRows = [];

    await expect(supabaseClientsRepository.list({ page: 1, pageSize: 50 }))
      .rejects.toThrow('canonical client state candidate row limit exceeded (10000)');
  });

  it('throws clearly instead of truncating an overflowing identity candidate set', async () => {
    boundary.canonicalRows = [];
    boundary.clientRows = Array.from(
      { length: 10_001 },
      (_, index) => client(String(index + 1), 'WA', `Last ${index + 1}`),
    );

    await expect(supabaseClientsRepository.list({ page: 1, pageSize: 50 }))
      .rejects.toThrow('client identity candidate row limit exceeded (10000)');
  });

  it('rejects unsupported state values before querying the generated enum column', async () => {
    await expect(supabaseClientsRepository.list({ states: ['XX'] }))
      .rejects.toThrow('Unsupported client state filter: XX');
    expect(boundary.calls.clients).toEqual([]);
  });
});
