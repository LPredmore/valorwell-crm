import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ReportQueryError,
  type ReportViewName,
} from '@/repositories/reportErrors';
import {
  selectLatestBucket,
  supabaseReportsRepository,
} from '@/repositories/supabase/reports';

interface FilterCall {
  column: string;
  operator: 'eq' | 'not';
  value: unknown;
}

interface QueryCall {
  filters: FilterCall[];
  range: { from: number; to: number } | null;
  selected: string;
  view: string;
}

interface FakeError {
  code?: string;
  message: string;
}

const boundary = vi.hoisted(() => {
  function calls(): QueryCall[] {
    return [];
  }

  function errors(): Record<string, FakeError | undefined> {
    return {};
  }

  function rows(): Record<string, object[]> {
    return {};
  }

  return { calls: calls(), errors: errors(), rows: rows() };
});

vi.mock('@/integrations/supabase/client', () => {
  function valueAt(row: object, column: string): unknown {
    return Object.entries(row).find(([key]) => key === column)?.[1];
  }

  class FakeQuery {
    private readonly call: QueryCall;
    private limitCount: number | null = null;
    private orderBy: { ascending: boolean; column: string; nullsFirst: boolean } | null = null;

    constructor(private readonly view: string) {
      this.call = { filters: [], range: null, selected: '*', view };
      boundary.calls.push(this.call);
    }

    select(columns = '*') {
      this.call.selected = columns;
      return this;
    }

    eq(column: string, value: unknown) {
      this.call.filters.push({ column, operator: 'eq', value });
      return this;
    }

    not(column: string, operator: string, value: unknown) {
      this.call.filters.push({ column, operator: 'not', value: { operator, value } });
      return this;
    }

    order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
      this.orderBy = {
        ascending: options.ascending ?? true,
        column,
        nullsFirst: options.nullsFirst ?? false,
      };
      return this;
    }

    limit(count: number) {
      this.limitCount = count;
      return this;
    }

    maybeSingle() {
      const result = this.result();
      return Promise.resolve({
        data: result.data?.[0] ?? null,
        error: result.error,
      });
    }

    range(from: number, to: number) {
      this.call.range = { from, to };
      const result = this.result();
      return Promise.resolve({
        data: result.data?.slice(from, to + 1) ?? null,
        error: result.error,
      });
    }

    private result(): { data: object[] | null; error: FakeError | null } {
      const error = boundary.errors[this.view];
      if (error) return { data: null, error };

      let rows = [...(boundary.rows[this.view] ?? [])];
      for (const filter of this.call.filters) {
        if (filter.operator === 'eq') {
          rows = rows.filter(row => valueAt(row, filter.column) === filter.value);
        } else {
          rows = rows.filter(row => valueAt(row, filter.column) !== null);
        }
      }
      if (this.orderBy) {
        const { ascending, column, nullsFirst } = this.orderBy;
        rows.sort((left, right) => {
          const leftValue = valueAt(left, column);
          const rightValue = valueAt(right, column);
          if (leftValue === rightValue) return 0;
          if (leftValue === null || leftValue === undefined) return nullsFirst ? -1 : 1;
          if (rightValue === null || rightValue === undefined) return nullsFirst ? 1 : -1;
          const comparison = String(leftValue).localeCompare(String(rightValue));
          return ascending ? comparison : -comparison;
        });
      }
      if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
      return { data: rows, error: null };
    }
  }

  return {
    supabase: {
      from: (view: string) => new FakeQuery(view),
    },
  };
});

const views: ReportViewName[] = [
  'v_crm_reports_funnel',
  'v_crm_reports_engagement',
  'v_crm_reports_closure',
  'v_crm_reports_campaigns',
  'v_crm_reports_tasks',
  'v_crm_reports_exceptions',
];

function common(tenantId: string, bucketStart: string, bucketEnd = '2026-07-13') {
  return {
    bucket_end: bucketEnd,
    bucket_start: bucketStart,
    tenant_id: tenantId,
  };
}

function seedRows() {
  boundary.rows.v_crm_reports_funnel = [
    { ...common('tenant-a', '2026-06-30', '2026-07-07'), stage: 'old', entered_count: 99, exited_count: 99, current_count: 99, median_days_in_stage: 99 },
    { ...common('tenant-b', '2026-07-20', '2026-07-27'), stage: 'other-tenant', entered_count: 50, exited_count: 50, current_count: 50, median_days_in_stage: 50 },
    { ...common('tenant-a', '2026-07-06'), stage: 'matching', entered_count: null, exited_count: 2, current_count: 7, median_days_in_stage: 4.5 },
    { ...common('tenant-a', '2026-07-06'), stage: 'intake', entered_count: 8, exited_count: null, current_count: null, median_days_in_stage: null },
  ];
  boundary.rows.v_crm_reports_engagement = [
    { ...common('tenant-a', '2026-07-06'), engagement: 'unresponsive_warm', current_count: null, entered_count: 4, avg_days_to_normal: null },
  ];
  boundary.rows.v_crm_reports_closure = [
    { ...common('tenant-a', '2026-07-06'), disposition_reason: 'completed_care', closed_count: 6, reopened_count: null, net_closed: 5 },
  ];
  boundary.rows.v_crm_reports_campaigns = [
    { ...common('tenant-a', '2026-07-06'), campaign_id: 'campaign-1', enrolled_count: 10, completed_count: 7, cancelled_count: null, responded_count: 3, suppressed_count: 2, failed_count: 1 },
  ];
  boundary.rows.v_crm_reports_tasks = [
    { ...common('tenant-a', '2026-07-06'), assignee_id: null, open_count: 4, completed_count: 9, overdue_count: null, median_hours_to_complete: 12.5 },
  ];
  boundary.rows.v_crm_reports_exceptions = [
    { ...common('tenant-a', '2026-07-06'), exception_type: 'integration_failure', raised_count: 5, resolved_count: 3, open_count: null, median_hours_to_resolve: 8.25 },
  ];
}

describe('Supabase reports repository', () => {
  beforeEach(() => {
    boundary.calls.length = 0;
    boundary.errors = {};
    boundary.rows = {};
    seedRows();
  });

  it('queries all six exact report views and tenant-filters every probe and bucket page', async () => {
    await Promise.all([
      supabaseReportsRepository.journeyFunnel('tenant-a'),
      supabaseReportsRepository.engagementMetrics('tenant-a'),
      supabaseReportsRepository.closureMetrics('tenant-a'),
      supabaseReportsRepository.campaignPerformance('tenant-a'),
      supabaseReportsRepository.taskPerformance('tenant-a'),
      supabaseReportsRepository.exceptionMetrics('tenant-a'),
    ]);

    expect([...new Set(boundary.calls.map(call => call.view))].sort()).toEqual([...views].sort());
    expect(boundary.calls).toHaveLength(12);
    expect(boundary.calls.every(call => call.filters.some(filter => (
      filter.operator === 'eq'
      && filter.column === 'tenant_id'
      && filter.value === 'tenant-a'
    )))).toBe(true);
    expect(boundary.calls.filter(call => call.range !== null)).toHaveLength(6);
  });

  it('selects the latest tenant bucket deterministically and retains every row in that week', async () => {
    const report = await supabaseReportsRepository.journeyFunnel('tenant-a');
    expect(report?.bucketStart).toBe('2026-07-06');
    expect(report?.bucketEnd).toBe('2026-07-13');
    expect(report?.rows.map(row => row.stage)).toEqual(['intake', 'matching']);
    expect(report?.rows.some(row => row.stage === 'old')).toBe(false);
    expect(report?.rows.some(row => row.stage === 'other-tenant')).toBe(false);

    const selected = selectLatestBucket([
      { bucket_start: '2026-06-30', bucket_end: '2026-07-07', id: 'old' },
      { bucket_start: '2026-07-06', bucket_end: '2026-07-13', id: 'b' },
      { bucket_start: '2026-07-06', bucket_end: '2026-07-13', id: 'a' },
    ]);
    expect(selected?.bucketStart).toBe('2026-07-06');
    expect(selected?.rows.map(row => row.id)).toEqual(['b', 'a']);
  });

  it('normalizes count metrics while preserving nullable measurements', async () => {
    const [funnel, engagement, closure, campaigns, tasks, exceptions] = await Promise.all([
      supabaseReportsRepository.journeyFunnel('tenant-a'),
      supabaseReportsRepository.engagementMetrics('tenant-a'),
      supabaseReportsRepository.closureMetrics('tenant-a'),
      supabaseReportsRepository.campaignPerformance('tenant-a'),
      supabaseReportsRepository.taskPerformance('tenant-a'),
      supabaseReportsRepository.exceptionMetrics('tenant-a'),
    ]);

    expect(funnel?.rows[0]).toMatchObject({
      bucket_end: '2026-07-13', bucket_start: '2026-07-06', tenant_id: 'tenant-a',
      stage: 'intake', entered_count: 8, exited_count: 0, current_count: 0, median_days_in_stage: 0,
    });
    expect(engagement?.rows[0]).toMatchObject({
      engagement: 'unresponsive_warm', current_count: 0, entered_count: 4, avg_days_to_normal: null,
    });
    expect(closure?.rows[0]).toMatchObject({
      disposition_reason: 'completed_care', closed_count: 6, reopened_count: 0, net_closed: 5,
    });
    expect(campaigns?.rows[0]).toMatchObject({
      campaign_id: 'campaign-1', enrolled_count: 10, completed_count: 7, cancelled_count: 0,
      responded_count: 3, suppressed_count: 2, failed_count: 1,
    });
    expect(tasks?.rows[0]).toMatchObject({
      assignee_id: null, open_count: 4, completed_count: 9, overdue_count: 0,
      median_hours_to_complete: 12.5,
    });
    expect(exceptions?.rows[0]).toMatchObject({
      exception_type: 'integration_failure', raised_count: 5, resolved_count: 3,
      open_count: 0, median_hours_to_resolve: 8.25,
    });
  });

  it('fails closed with report-specific errors for unsupported canonical dimensions', async () => {
    boundary.rows.v_crm_reports_funnel = [{
      ...common('tenant-a', '2026-07-06'),
      stage: 'legacy_stage',
      entered_count: 1,
      exited_count: 0,
      current_count: 1,
      median_days_in_stage: 2,
    }];
    await expect(supabaseReportsRepository.journeyFunnel('tenant-a')).rejects.toMatchObject({
      kind: 'query-failed',
      report: 'funnel',
      view: 'v_crm_reports_funnel',
      message: expect.stringContaining('unsupported lifecycle stage value: legacy_stage'),
    });

    boundary.rows.v_crm_reports_engagement = [{
      ...common('tenant-a', '2026-07-06'),
      engagement: 'legacy_engagement',
      current_count: 1,
      entered_count: 1,
      avg_days_to_normal: null,
    }];
    await expect(supabaseReportsRepository.engagementMetrics('tenant-a')).rejects.toMatchObject({
      kind: 'query-failed',
      report: 'engagement',
      view: 'v_crm_reports_engagement',
      message: expect.stringContaining('unsupported engagement state value: legacy_engagement'),
    });

    boundary.rows.v_crm_reports_closure = [{
      ...common('tenant-a', '2026-07-06'),
      disposition_reason: 'legacy_disposition',
      closed_count: 1,
      reopened_count: 0,
      net_closed: 1,
    }];
    await expect(supabaseReportsRepository.closureMetrics('tenant-a')).rejects.toMatchObject({
      kind: 'query-failed',
      report: 'closure',
      view: 'v_crm_reports_closure',
      message: expect.stringContaining('unsupported closure disposition value: legacy_disposition'),
    });
  });

  it('returns null for a legitimate empty report view', async () => {
    boundary.rows.v_crm_reports_funnel = [];
    await expect(supabaseReportsRepository.journeyFunnel('tenant-a')).resolves.toBeNull();
  });

  it('distinguishes a missing contract from permission and network failures', async () => {
    boundary.errors.v_crm_reports_funnel = {
      code: 'PGRST205',
      message: "Could not find the table 'public.v_crm_reports_funnel' in the schema cache",
    };
    await expect(supabaseReportsRepository.journeyFunnel('tenant-a')).rejects.toMatchObject({
      kind: 'missing-contract',
      report: 'funnel',
      view: 'v_crm_reports_funnel',
    });

    boundary.errors.v_crm_reports_funnel = { code: '42501', message: 'permission denied' };
    await expect(supabaseReportsRepository.journeyFunnel('tenant-a')).rejects.toMatchObject({
      kind: 'query-failed',
    });

    boundary.errors.v_crm_reports_funnel = { message: 'network timeout' };
    const failure = supabaseReportsRepository.journeyFunnel('tenant-a');
    await expect(failure).rejects.toBeInstanceOf(ReportQueryError);
    await expect(failure).rejects.toMatchObject({ kind: 'query-failed' });

    boundary.errors.v_crm_reports_funnel = {
      code: '42P01',
      message: 'relation "public.unrelated_table" does not exist',
    };
    await expect(supabaseReportsRepository.journeyFunnel('tenant-a')).rejects.toMatchObject({
      kind: 'query-failed',
    });
  });
});
