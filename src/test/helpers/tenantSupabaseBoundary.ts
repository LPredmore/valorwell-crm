export type BoundaryRow = Record<string, any>;

type Filter =
  | { kind: 'eq'; column: string; value: unknown }
  | { kind: 'in'; column: string; values: unknown[] }
  | { kind: 'not-in'; column: string; values: string[] }
  | { kind: 'gte' | 'lte' | 'lt'; column: string; value: unknown };

type QueryResult = {
  data: any;
  error: { message: string } | null;
};

class FakeQuery implements PromiseLike<QueryResult> {
  private filters: Filter[] = [];
  private updatePayload: BoundaryRow | null = null;
  private insertPayload: BoundaryRow[] | null = null;
  private limitCount: number | null = null;

  constructor(
    private readonly boundary: TenantSupabaseBoundary,
    private readonly table: string,
  ) {}

  select() { return this; }
  order() { return this; }
  or() { return this; }

  limit(value: number) {
    this.limitCount = value;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: 'eq', column, value });
    return this;
  }

  is(column: string, value: unknown) {
    return this.eq(column, value);
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ kind: 'in', column, values });
    return this;
  }

  not(column: string, operator: string, value: string) {
    if (operator !== 'in') throw new Error('Unsupported not operator: ' + operator);
    this.filters.push({
      kind: 'not-in',
      column,
      values: value.replace(/[()]/g, '').split(',').filter(Boolean),
    });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ kind: 'gte', column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ kind: 'lte', column, value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push({ kind: 'lt', column, value });
    return this;
  }

  update(payload: BoundaryRow) {
    this.updatePayload = payload;
    return this;
  }

  insert(payload: BoundaryRow | BoundaryRow[]) {
    this.insertPayload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  private matches(row: BoundaryRow): boolean {
    return this.filters.every((filter) => {
      const value = row[filter.column];
      if (filter.kind === 'eq') return value === filter.value;
      if (filter.kind === 'in') return filter.values.includes(value);
      if (filter.kind === 'not-in') return !filter.values.includes(String(value));
      if (filter.kind === 'gte') return String(value ?? '') >= String(filter.value ?? '');
      if (filter.kind === 'lte') return String(value ?? '') <= String(filter.value ?? '');
      return String(value ?? '') < String(filter.value ?? '');
    });
  }

  private execute(): QueryResult {
    if (this.insertPayload) {
      const inserted = this.insertPayload.map((row) =>
        this.boundary.materializeInsert(this.table, row),
      );
      this.boundary.rows(this.table).push(...inserted);
      return { data: this.applyLimit(inserted), error: null };
    }

    const matching = this.boundary.rows(this.table).filter((row) => this.matches(row));
    if (this.updatePayload) {
      for (const row of matching) Object.assign(row, this.updatePayload);
    }
    return { data: this.applyLimit(matching), error: null };
  }

  private applyLimit(rows: BoundaryRow[]) {
    return this.limitCount === null ? rows : rows.slice(0, this.limitCount);
  }

  async maybeSingle(): Promise<QueryResult> {
    const result = this.execute();
    const rows = result.data as BoundaryRow[];
    if (rows.length > 1) {
      return { data: null, error: { message: 'Expected zero or one row' } };
    }
    return { data: rows[0] ?? null, error: null };
  }

  async single(): Promise<QueryResult> {
    const result = this.execute();
    const rows = result.data as BoundaryRow[];
    return rows.length === 1
      ? { data: rows[0], error: null }
      : { data: null, error: { message: 'Expected one row' } };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

export class TenantSupabaseBoundary {
  private tables = new Map<string, BoundaryRow[]>();
  private sequence = 0;
  authenticatedProfileId = 'profile-operator';
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  reset(seed: Record<string, BoundaryRow[]>) {
    this.tables = new Map(
      Object.entries(seed).map(([table, rows]) => [
        table,
        rows.map((row) => structuredClone(row)),
      ]),
    );
    this.sequence = 0;
    this.rpcCalls = [];
  }

  rows(table: string): BoundaryRow[] {
    const rows = this.tables.get(table);
    if (rows) return rows;
    const created: BoundaryRow[] = [];
    this.tables.set(table, created);
    return created;
  }

  materializeInsert(table: string, row: BoundaryRow): BoundaryRow {
    this.sequence += 1;
    const now = '2026-10-07T12:00:00.000Z';
    const base = {
      id: 'generated-' + table + '-' + this.sequence,
      created_at: now,
      updated_at: now,
    };
    if (table === 'crm_tasks') {
      return {
        ...base,
        description: null,
        client_id: null,
        staff_id: null,
        campaign_id: null,
        exception_id: null,
        type: 'general',
        priority: 'normal',
        status: 'not_started',
        owner_id: null,
        collaborator_ids: [],
        start_at: null,
        due_at: null,
        completed_at: null,
        recurrence: null,
        checklist: [],
        tags: [],
        ...structuredClone(row),
      };
    }
    return { ...base, ...structuredClone(row) };
  }

  readonly supabase = {
    from: (table: string) => new FakeQuery(this, table),
    auth: {
      getUser: async () => ({
        data: { user: { id: this.authenticatedProfileId } },
        error: null,
      }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      this.rpcCalls.push({ name, args: structuredClone(args) });
      return { data: [], error: null };
    },
  };
}

export const tenantBoundary = new TenantSupabaseBoundary();
