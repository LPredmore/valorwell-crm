/**
 * Minimal in-memory stand-in for the supabase-js query builder, used to exercise Edge
 * Function handlers and workers without a network or database. It implements only the
 * subset of PostgREST behaviour those modules use: column projection, one level of
 * resource embedding (including !inner and filters on embedded columns), the common
 * filter operators, ordering, limits, single/maybeSingle, insert/update/delete with
 * optional returning, RPCs, and per-table trigger hooks that emulate database triggers.
 */
type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

export type Relation = {
  /** Parent table being selected from. */
  from: string;
  /** Embedded resource name as written in the select string. */
  to: string;
  /** Column on the parent row. */
  localKey: string;
  /** Column on the embedded row that must equal the parent's localKey. */
  foreignKey: string;
  many: boolean;
};

export type TableTriggers = {
  /** Runs before insert; may mutate/return the row or throw to reject it. */
  beforeInsert?: (row: Row, db: FakeSupabase) => Row | void;
  afterInsert?: (row: Row, db: FakeSupabase) => void;
  afterUpdate?: (before: Row, after: Row, db: FakeSupabase) => void;
};

export type RpcHandler = (args: Record<string, unknown>, db: FakeSupabase) => unknown | Promise<unknown>;

export type Mutation = { table: string; op: "insert" | "update" | "delete"; rows: Row[]; patch?: Row };

const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

function splitTopLevel(spec: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of spec) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean);
}

type SelectItem =
  | { kind: "all" }
  | { kind: "column"; name: string }
  | { kind: "embed"; name: string; alias: string; inner: boolean; spec: string };

function parseSelect(spec: string): SelectItem[] {
  return splitTopLevel(spec || "*").map((part) => {
    if (part === "*") return { kind: "all" } as const;
    const embed = part.match(/^(?:(\w+):)?(\w+)(!inner)?\s*\(([\s\S]*)\)$/);
    if (embed) {
      return { kind: "embed", alias: embed[1] ?? embed[2], name: embed[2], inner: Boolean(embed[3]), spec: embed[4] } as const;
    }
    return { kind: "column", name: part } as const;
  });
}

export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  relations: Relation[] = [];
  triggers: Record<string, TableTriggers> = {};
  rpcs: Record<string, RpcHandler> = {};
  mutations: Mutation[] = [];
  private serial = 1000;

  constructor(init: { tables?: Record<string, Row[]>; relations?: Relation[] } = {}) {
    for (const [name, rows] of Object.entries(init.tables ?? {})) this.tables[name] = rows.map((row) => ({ ...row }));
    this.relations = init.relations ?? [];
  }

  table(name: string): Row[] {
    if (!this.tables[name]) this.tables[name] = [];
    return this.tables[name];
  }

  nextSerial(): number {
    this.serial += 1;
    return this.serial;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  async rpc(name: string, args: Record<string, unknown> = {}): Promise<Result> {
    const handler = this.rpcs[name];
    if (!handler) return { data: null, error: { message: `rpc ${name} is not registered` } };
    try {
      return { data: clone(await handler(args, this)), error: null };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
    }
  }

  /** Materialises one row against a select spec, resolving embedded resources. */
  project(table: string, row: Row, spec: string): Row | null {
    const items = parseSelect(spec);
    const out: Row = {};
    for (const item of items) {
      if (item.kind === "all") Object.assign(out, clone(row));
      else if (item.kind === "column") out[item.name] = clone(row[item.name]) ?? null;
    }
    for (const item of items) {
      if (item.kind !== "embed") continue;
      const relation = this.relations.find((candidate) => candidate.from === table && candidate.to === item.name);
      if (!relation) throw new Error(`No fake relation ${table} -> ${item.name}`);
      const children = this.table(item.name).filter((child) => child[relation.foreignKey] === row[relation.localKey]);
      if (relation.many) {
        out[item.alias] = children.map((child) => this.project(item.name, child, item.spec)).filter(Boolean);
      } else {
        const child = children[0];
        if (!child && item.inner) return null;
        out[item.alias] = child ? this.project(item.name, child, item.spec) : null;
      }
    }
    return out;
  }
}

type Filter = (row: Row) => boolean;

function readPath(row: Row, column: string): unknown {
  if (!column.includes(".")) return row[column];
  return column.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object") return (value as Row)[key];
    return undefined;
  }, row);
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return String(a) < String(b) ? -1 : 1;
}

class FakeQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private spec = "*";
  private returning = false;
  private payload: Row | Row[] | null = null;
  private filters: Filter[] = [];
  private embedFilters: Filter[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private max: number | null = null;
  private mode: "many" | "single" | "maybeSingle" = "many";

  constructor(private db: FakeSupabase, private tableName: string) {}

  select(spec = "*") {
    if (this.op === "select") this.spec = spec;
    else {
      this.returning = true;
      this.spec = spec;
    }
    return this;
  }
  insert(rows: Row | Row[]) { this.op = "insert"; this.payload = rows; return this; }
  update(patch: Row) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }

  private addFilter(column: string, predicate: (value: unknown) => boolean) {
    const filter: Filter = (row) => predicate(readPath(row, column));
    if (column.includes(".")) this.embedFilters.push(filter);
    else this.filters.push(filter);
    return this;
  }
  eq(column: string, value: unknown) { return this.addFilter(column, (v) => v === value); }
  neq(column: string, value: unknown) { return this.addFilter(column, (v) => v !== value); }
  in(column: string, values: unknown[]) { return this.addFilter(column, (v) => values.includes(v)); }
  is(column: string, value: unknown) { return this.addFilter(column, (v) => (value === null ? v === null || v === undefined : v === value)); }
  gt(column: string, value: unknown) { return this.addFilter(column, (v) => v !== null && v !== undefined && String(v) > String(value)); }
  gte(column: string, value: unknown) { return this.addFilter(column, (v) => v !== null && v !== undefined && String(v) >= String(value)); }
  lt(column: string, value: unknown) { return this.addFilter(column, (v) => v !== null && v !== undefined && String(v) < String(value)); }
  lte(column: string, value: unknown) { return this.addFilter(column, (v) => v !== null && v !== undefined && String(v) <= String(value)); }
  not(column: string, operator: string, value: unknown) {
    if (operator !== "is") throw new Error(`fake not(${operator}) unsupported`);
    return this.addFilter(column, (v) => !(value === null ? v === null || v === undefined : v === value));
  }
  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    this.orders.push({ column, ascending: options.ascending !== false });
    return this;
  }
  limit(count: number) { this.max = count; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybeSingle"; return this; }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected);
  }

  private matching(): Row[] {
    return this.db.table(this.tableName).filter((row) => this.filters.every((filter) => filter(row)));
  }

  private shape(rows: Row[]): Result {
    let sorted = [...rows];
    for (const { column, ascending } of [...this.orders].reverse()) {
      sorted = [...sorted].sort((a, b) => compare(a[column], b[column]) * (ascending ? 1 : -1));
    }
    let projected = sorted
      .map((row) => this.db.project(this.tableName, row, this.spec))
      .filter((row): row is Row => row !== null)
      .filter((row) => this.embedFilters.every((filter) => filter(row)));
    if (this.max !== null) projected = projected.slice(0, this.max);
    if (this.mode === "single") {
      if (projected.length !== 1) return { data: null, error: { message: `expected 1 row, got ${projected.length}` } };
      return { data: projected[0], error: null };
    }
    if (this.mode === "maybeSingle") {
      if (projected.length > 1) return { data: null, error: { message: "multiple rows returned" } };
      return { data: projected[0] ?? null, error: null };
    }
    return { data: projected, error: null };
  }

  private execute(): Result {
    try {
      if (this.op === "select") return this.shape(this.matching());
      const triggers = this.db.triggers[this.tableName] ?? {};

      if (this.op === "insert") {
        const inputs = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
        const inserted: Row[] = [];
        for (const input of inputs) {
          let row: Row = { ...clone(input) };
          if (row.id === undefined) row.id = crypto.randomUUID();
          if (row.created_at === undefined) row.created_at = new Date().toISOString();
          row = (triggers.beforeInsert?.(row, this.db) as Row | undefined) ?? row;
          this.db.table(this.tableName).push(row);
          inserted.push(row);
          triggers.afterInsert?.(row, this.db);
        }
        this.db.mutations.push({ table: this.tableName, op: "insert", rows: clone(inserted) });
        return this.returning ? this.shape(inserted) : { data: null, error: null };
      }

      if (this.op === "update") {
        const targets = this.matching();
        const before = targets.map((row) => clone(row));
        for (const row of targets) Object.assign(row, clone(this.payload as Row));
        this.db.mutations.push({ table: this.tableName, op: "update", rows: clone(targets), patch: clone(this.payload as Row) });
        targets.forEach((row, index) => triggers.afterUpdate?.(before[index], row, this.db));
        return this.returning ? this.shape(targets) : { data: null, error: null };
      }

      const targets = this.matching();
      this.db.tables[this.tableName] = this.db.table(this.tableName).filter((row) => !targets.includes(row));
      this.db.mutations.push({ table: this.tableName, op: "delete", rows: clone(targets) });
      return this.returning ? this.shape(targets) : { data: null, error: null };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
    }
  }
}
