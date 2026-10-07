import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskViewDateBounds } from '@/domain/taskViews';
import { supabaseTasksRepository } from '@/repositories/supabase/tasks';

type Row = Record<string, unknown>;

type Filter =
  | { kind: 'eq'; column: string; value: unknown }
  | { kind: 'in'; column: string; values: unknown[] }
  | { kind: 'gte' | 'lte' | 'lt'; column: string; value: string }
  | { kind: 'is'; column: string; value: unknown }
  | { kind: 'not-in'; column: string; values: string[] };

interface Order {
  column: string;
  ascending: boolean;
  nullsFirst: boolean;
}

const boundary = vi.hoisted(() => ({
  rows: [] as Row[],
  calls: [] as { filters: Filter[]; orders: Order[] }[],
}));

vi.mock('@/integrations/supabase/client', () => {
  const valueAt = (row: Row, column: string) => row[column];

  class FakeQuery {
    private readonly filters: Filter[] = [];
    private readonly orders: Order[] = [];

    constructor() {
      boundary.calls.push({ filters: this.filters, orders: this.orders });
    }

    select() { return this; }

    eq(column: string, value: unknown) {
      this.filters.push({ kind: 'eq', column, value });
      return this;
    }

    in(column: string, values: unknown[]) {
      this.filters.push({ kind: 'in', column, values });
      return this;
    }

    gte(column: string, value: string) {
      this.filters.push({ kind: 'gte', column, value });
      return this;
    }

    lte(column: string, value: string) {
      this.filters.push({ kind: 'lte', column, value });
      return this;
    }

    lt(column: string, value: string) {
      this.filters.push({ kind: 'lt', column, value });
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.push({ kind: 'is', column, value });
      return this;
    }

    not(column: string, operator: string, value: string) {
      if (operator !== 'in') throw new Error(`Unsupported fake not operator: ${operator}`);
      this.filters.push({
        kind: 'not-in',
        column,
        values: value.replace(/[()]/g, '').split(','),
      });
      return this;
    }

    or() {
      return this;
    }

    order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
      this.orders.push({
        column,
        ascending: options.ascending ?? true,
        nullsFirst: options.nullsFirst ?? false,
      });
      return this;
    }

    then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
      onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      let rows = [...boundary.rows];

      for (const filter of this.filters) {
        rows = rows.filter((row) => {
          const value = valueAt(row, filter.column);
          switch (filter.kind) {
            case 'eq':
              return value === filter.value;
            case 'in':
              return filter.values.includes(value);
            case 'is':
              return value === filter.value;
            case 'not-in':
              return !filter.values.includes(String(value));
            case 'gte':
              return value != null && new Date(String(value)).getTime() >= new Date(filter.value).getTime();
            case 'lte':
              return value != null && new Date(String(value)).getTime() <= new Date(filter.value).getTime();
            case 'lt':
              return value != null && new Date(String(value)).getTime() < new Date(filter.value).getTime();
          }
        });
      }

      rows.sort((left, right) => {
        for (const order of this.orders) {
          const leftValue = valueAt(left, order.column);
          const rightValue = valueAt(right, order.column);
          if (leftValue === rightValue) continue;
          if (leftValue == null) return order.nullsFirst ? -1 : 1;
          if (rightValue == null) return order.nullsFirst ? 1 : -1;
          const comparison = String(leftValue).localeCompare(String(rightValue));
          if (comparison !== 0) return order.ascending ? comparison : -comparison;
        }
        return 0;
      });

      return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
    }
  }

  return {
    supabase: {
      from: (table: string) => {
        if (table !== 'crm_tasks') throw new Error(`Unexpected table ${table}`);
        return new FakeQuery();
      },
    },
  };
});

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const ME = 'profile-me';
const OTHER = 'profile-other';
const NOW = '2026-10-07T02:00:00.000Z';

const bounds: TaskViewDateBounds = {
  timeZone: 'America/Chicago',
  dayStartIso: '2026-10-06T05:00:00.000Z',
  nextDayStartIso: '2026-10-07T05:00:00.000Z',
  weekStartIso: '2026-10-04T05:00:00.000Z',
  nextWeekStartIso: '2026-10-11T05:00:00.000Z',
};

function row(
  id: string,
  {
    tenant = TENANT,
    owner = OTHER,
    status = 'not_started',
    type = 'general',
    due = '2026-10-09T15:00:00.000Z',
    completed = null as string | null,
  } = {},
): Row {
  return {
    id,
    tenant_id: tenant,
    title: id,
    description: null,
    client_id: null,
    staff_id: null,
    campaign_id: null,
    exception_id: null,
    type,
    priority: 'normal',
    status,
    owner_id: owner,
    collaborator_ids: [],
    created_by_profile_id: ME,
    start_at: null,
    due_at: due,
    completed_at: completed,
    recurrence: null,
    checklist: [],
    tags: [],
    created_at: '2026-10-01T12:00:00.000Z',
    updated_at: completed ?? '2026-10-01T12:00:00.000Z',
  };
}

function seedRows() {
  boundary.rows = [
    row('mine-future', { owner: ME, due: '2026-10-08T15:00:00.000Z' }),
    row('other-future', { owner: OTHER, due: '2026-10-09T15:00:00.000Z' }),
    row('unassigned', { owner: null as unknown as string, due: '2026-10-10T15:00:00.000Z' }),
    row('overdue', { owner: OTHER, due: '2026-10-05T15:00:00.000Z' }),
    row('due-today', { owner: ME, due: '2026-10-07T03:00:00.000Z' }),
    row('client-followup', { type: 'client_follow_up', due: '2026-10-08T16:00:00.000Z' }),
    row('staff-followup', { type: 'staff_follow_up', due: '2026-10-08T17:00:00.000Z' }),
    row('campaign-exception', { type: 'campaign_exception', due: '2026-10-08T18:00:00.000Z' }),
    row('completed-new', {
      owner: ME,
      status: 'completed',
      due: '2026-10-05T12:00:00.000Z',
      completed: '2026-10-06T22:00:00.000Z',
    }),
    row('completed-old', {
      status: 'completed',
      due: '2026-10-04T12:00:00.000Z',
      completed: '2026-10-05T22:00:00.000Z',
    }),
    row('canceled', { status: 'canceled', due: '2026-10-06T18:00:00.000Z' }),
    row('other-tenant-due-today', {
      tenant: OTHER_TENANT,
      owner: ME,
      due: '2026-10-07T03:30:00.000Z',
    }),
  ];
}

function baseQuery(view: Parameters<typeof supabaseTasksRepository.list>[0]['view']) {
  return {
    view,
    tenantId: TENANT,
    currentProfileId: ME,
    dateBounds: bounds,
    nowIso: NOW,
  };
}

async function ids(view: Parameters<typeof supabaseTasksRepository.list>[0]['view']) {
  const tasks = await supabaseTasksRepository.list(baseQuery(view));
  return tasks.map((task) => task.id);
}

describe('Phase 4 Supabase task view semantics', () => {
  beforeEach(() => {
    boundary.calls.length = 0;
    seedRows();
  });

  it('implements My Tasks with the current profile ID and excludes terminal tasks', async () => {
    expect(await ids('my')).toEqual(['due-today', 'mine-future']);
    const filters = boundary.calls.at(-1)?.filters ?? [];
    expect(filters).toEqual(expect.arrayContaining([
      { kind: 'eq', column: 'tenant_id', value: TENANT },
      { kind: 'eq', column: 'owner_id', value: ME },
      { kind: 'not-in', column: 'status', values: ['completed', 'canceled'] },
    ]));
  });

  it('implements Team as every nonterminal task in the operating tenant', async () => {
    const result = await ids('team');
    expect(result).toHaveLength(8);
    expect(result).not.toContain('completed-new');
    expect(result).not.toContain('canceled');
    expect(result).not.toContain('other-tenant-due-today');
  });

  it('implements Overdue against now and excludes terminal tasks', async () => {
    expect(await ids('overdue')).toEqual(['overdue']);
  });

  it('implements Due Today using the supplied local-day UTC boundaries', async () => {
    expect(await ids('due-today')).toEqual(['due-today']);
  });

  it('implements Due This Week using the supplied local-week UTC boundaries', async () => {
    expect(await ids('due-week')).toEqual([
      'overdue',
      'due-today',
      'mine-future',
      'client-followup',
      'staff-followup',
      'campaign-exception',
      'other-future',
      'unassigned',
    ]);
  });

  it('implements Unassigned without leaking terminal or other-tenant tasks', async () => {
    expect(await ids('unassigned')).toEqual(['unassigned']);
  });

  it('implements each special task-type view as nonterminal and tenant-scoped', async () => {
    expect(await ids('client-followups')).toEqual(['client-followup']);
    expect(await ids('staff-followups')).toEqual(['staff-followup']);
    expect(await ids('campaign-exceptions')).toEqual(['campaign-exception']);
  });

  it('implements Recently Completed and sorts newest completion first', async () => {
    expect(await ids('recently-completed')).toEqual(['completed-new', 'completed-old']);
    expect(boundary.calls.at(-1)?.orders[0]).toEqual({
      column: 'completed_at',
      ascending: false,
      nullsFirst: false,
    });
  });

  it('implements All as every status in the operating tenant only', async () => {
    const result = await ids('all');
    expect(result).toHaveLength(11);
    expect(result).toContain('completed-new');
    expect(result).toContain('canceled');
    expect(result).not.toContain('other-tenant-due-today');
  });

  it('fails closed when a named view lacks tenant/profile/date context', async () => {
    await expect(supabaseTasksRepository.list({ view: 'team' })).rejects.toThrow(
      'requires current tenant context',
    );
    await expect(supabaseTasksRepository.list({ view: 'my', tenantId: TENANT })).rejects.toThrow(
      'requires current operator profile context',
    );
    await expect(supabaseTasksRepository.list({ view: 'due-today', tenantId: TENANT })).rejects.toThrow(
      'requires local date boundaries',
    );
  });
});
