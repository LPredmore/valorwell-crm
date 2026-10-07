import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireOperatingTenant } from '@/repositories/tenantScope';
import { supabaseTasksRepository } from '@/repositories/supabase/tasks';

type Row = Record<string, unknown>;

const boundary = vi.hoisted(() => ({
  rows: [] as Row[],
}));

vi.mock('@/integrations/supabase/client', () => {
  class FakeTaskQuery {
    private filters: Array<
      | { kind: 'eq'; column: string; value: unknown }
      | { kind: 'in'; column: string; values: unknown[] }
      | { kind: 'not-in'; column: string; values: string[] }
    > = [];
    private updatePayload: Record<string, unknown> | null = null;

    select() { return this; }
    order() { return this; }
    is(column: string, value: unknown) {
      return this.eq(column, value);
    }
    gte() { return this; }
    lte() { return this; }
    lt() { return this; }
    or() { return this; }

    eq(column: string, value: unknown) {
      this.filters.push({ kind: 'eq', column, value });
      return this;
    }

    in(column: string, values: unknown[]) {
      this.filters.push({ kind: 'in', column, values });
      return this;
    }

    not(column: string, operator: string, value: string) {
      if (operator !== 'in') throw new Error(`Unsupported not operator: ${operator}`);
      this.filters.push({
        kind: 'not-in',
        column,
        values: value.replace(/[()]/g, '').split(','),
      });
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.updatePayload = payload;
      return this;
    }

    private matches(row: Row): boolean {
      return this.filters.every((filter) => {
        const value = row[filter.column];
        if (filter.kind === 'eq') return value === filter.value;
        if (filter.kind === 'in') return filter.values.includes(value);
        return !filter.values.includes(String(value));
      });
    }

    private result() {
      const matching = boundary.rows.filter((row) => this.matches(row));
      if (this.updatePayload) {
        for (const row of matching) Object.assign(row, this.updatePayload);
      }
      return matching;
    }

    maybeSingle() {
      return Promise.resolve({ data: this.result()[0] ?? null, error: null });
    }

    single() {
      const rows = this.result();
      return Promise.resolve(
        rows.length === 1
          ? { data: rows[0], error: null }
          : { data: null, error: { message: 'Expected one row' } },
      );
    }

    then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
      onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve({ data: this.result(), error: null }).then(onfulfilled, onrejected);
    }
  }

  return {
    supabase: {
      from: (table: string) => {
        if (table !== 'crm_tasks') throw new Error(`Unexpected table: ${table}`);
        return new FakeTaskQuery();
      },
    },
  };
});

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function taskRow(id: string, tenantId: string, status = 'not_started'): Row {
  return {
    id,
    tenant_id: tenantId,
    title: id,
    description: null,
    client_id: null,
    staff_id: null,
    campaign_id: null,
    exception_id: null,
    type: 'general',
    priority: 'normal',
    status,
    owner_id: null,
    collaborator_ids: [],
    created_by_profile_id: 'profile-me',
    start_at: null,
    due_at: '2026-10-08T12:00:00.000Z',
    completed_at: null,
    recurrence: null,
    checklist: [],
    tags: [],
    created_at: '2026-10-01T12:00:00.000Z',
    updated_at: '2026-10-01T12:00:00.000Z',
  };
}

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Phase 5 operating-tenant repository boundary', () => {
  beforeEach(() => {
    boundary.rows = [
      taskRow('task-a-1', TENANT_A),
      taskRow('task-a-2', TENANT_A),
      taskRow('task-b-1', TENANT_B),
    ];
  });

  it('fails closed without an operating tenant', () => {
    expect(() => requireOperatingTenant(undefined)).toThrow('Current CRM operating tenant is required');
    expect(() => requireOperatingTenant('   ')).toThrow('Current CRM operating tenant is required');
    expect(requireOperatingTenant(TENANT_A)).toBe(TENANT_A);
  });

  it('switching the selected tenant changes the task result set', async () => {
    const a = await supabaseTasksRepository.list({
      view: 'all',
      tenantId: TENANT_A,
      currentProfileId: 'profile-me',
    });
    const b = await supabaseTasksRepository.list({
      view: 'all',
      tenantId: TENANT_B,
      currentProfileId: 'profile-me',
    });

    expect(a.map((task) => task.id).sort()).toEqual(['task-a-1', 'task-a-2']);
    expect(b.map((task) => task.id)).toEqual(['task-b-1']);
  });

  it('get cannot resolve an ID that belongs to another selected tenant', async () => {
    await expect(supabaseTasksRepository.get(TENANT_A, 'task-b-1')).resolves.toBeNull();
    await expect(supabaseTasksRepository.get(TENANT_B, 'task-b-1')).resolves.toMatchObject({
      id: 'task-b-1',
      tenantId: TENANT_B,
    });
  });

  it('single-row mutation fails closed for a task from another tenant', async () => {
    await expect(
      supabaseTasksRepository.update(TENANT_A, 'task-b-1', { status: 'Completed' }),
    ).rejects.toThrow('Expected one row');

    expect(boundary.rows.find((row) => row.id === 'task-b-1')?.status).toBe('not_started');
  });

  it('bulk mutations only touch IDs inside the selected tenant', async () => {
    await supabaseTasksRepository.bulkStatus(
      TENANT_A,
      ['task-a-1', 'task-b-1'],
      'Completed',
    );

    expect(boundary.rows.find((row) => row.id === 'task-a-1')?.status).toBe('completed');
    expect(boundary.rows.find((row) => row.id === 'task-b-1')?.status).toBe('not_started');
  });

  it('requires selected-tenant predicates across the other canonical repositories', () => {
    const exceptions = source('src/repositories/supabase/exceptions.ts');
    const staff = source('src/repositories/supabase/staff.ts');
    const campaigns = source('src/repositories/supabase/campaigns.ts');
    const clients = source('src/repositories/supabase/clients.ts');
    const communications = source('src/repositories/supabase/communications.ts');
    const audit = source('src/repositories/supabase/audit.ts');

    for (const repository of [exceptions, staff, campaigns, clients, communications, audit]) {
      expect(repository).toContain("requireOperatingTenant");
      expect(repository).toContain("tenant_id");
    }

    expect(exceptions).toContain(".eq('tenant_id', tenantId)");
    expect(staff).toContain(".eq('tenant_id', tenantId)");
    expect(campaigns).toContain(".eq('tenant_id', tenantId)");
    expect(clients).toContain(".eq('tenant_id', tenantId)");
    expect(communications).toContain(".eq('tenant_id', tenantId)");
    expect(audit).toContain(".eq('tenant_id', tenantId)");
  });

  it('protects direct policy/send and canonical RPC call sites with operating tenant context', () => {
    const composer = source('src/components/crm/canonical/PolicyAwareComposer.tsx');
    const canonicalMutations = source('src/hooks/crm/useCanonicalMutations.ts');

    expect(composer).toContain('evaluatePolicy(currentTenantId');
    expect(composer).toContain('send(currentTenantId');
    expect(canonicalMutations).toContain(".eq('tenant_id', currentTenantId)");
    expect(canonicalMutations).toContain("Client not found in current operating tenant");
  });
});
