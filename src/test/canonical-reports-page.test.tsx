import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CampaignReportRow,
  ClosureReportRow,
  EngagementReportRow,
  ExceptionReportRow,
  FunnelReportRow,
  ReportBucket,
  TaskReportRow,
} from '@/repositories/types';
import { ReportQueryError } from '@/repositories/reportErrors';
import CanonicalReports from '@/pages/crm/canonical/CanonicalReports';

interface QueryState<Data> {
  data: Data | null | undefined;
  error: Error | null;
  isPending: boolean;
}

interface MockReportQueries {
  campaign: QueryState<ReportBucket<CampaignReportRow>>;
  closure: QueryState<ReportBucket<ClosureReportRow>>;
  engagement: QueryState<ReportBucket<EngagementReportRow>>;
  exception: QueryState<ReportBucket<ExceptionReportRow>>;
  funnel: QueryState<ReportBucket<FunnelReportRow>>;
  task: QueryState<ReportBucket<TaskReportRow>>;
}

const boundary = vi.hoisted(() => {
  function emptyQuery<Data>(): QueryState<Data> {
    return { data: null, error: null, isPending: false };
  }

  return {
    current: {
      campaign: emptyQuery<ReportBucket<CampaignReportRow>>(),
      closure: emptyQuery<ReportBucket<ClosureReportRow>>(),
      engagement: emptyQuery<ReportBucket<EngagementReportRow>>(),
      exception: emptyQuery<ReportBucket<ExceptionReportRow>>(),
      funnel: emptyQuery<ReportBucket<FunnelReportRow>>(),
      task: emptyQuery<ReportBucket<TaskReportRow>>(),
    },
  };
});

vi.mock('@/hooks/canonical/useCrmData', () => ({
  useReports: () => boundary.current,
}));

const period = {
  bucket_end: '2026-07-13',
  bucket_start: '2026-07-06',
  tenant_id: 'tenant-a',
};

function query<Data>(data: Data | null): QueryState<Data> {
  return { data, error: null, isPending: false };
}

function bucket<Row>(rows: Row[]): ReportBucket<Row> {
  return {
    tenantId: 'tenant-a',
    bucketStart: '2026-07-06',
    bucketEnd: '2026-07-13',
    rows,
  };
}

function readyQueries(): MockReportQueries {
  return {
    funnel: query(bucket<FunnelReportRow>([{
      ...period,
      stage: 'intake',
      entered_count: 8,
      exited_count: 3,
      current_count: 12,
      median_days_in_stage: 4.5,
    }])),
    engagement: query(bucket<EngagementReportRow>([{
      ...period,
      engagement: 'normal',
      current_count: 20,
      entered_count: 6,
      avg_days_to_normal: null,
    }])),
    closure: query(bucket<ClosureReportRow>([{
      ...period,
      disposition_reason: 'completed_care',
      closed_count: 5,
      reopened_count: 1,
      net_closed: 4,
    }])),
    campaign: query(bucket<CampaignReportRow>([{
      ...period,
      campaign_id: 'campaign-1',
      enrolled_count: 10,
      completed_count: 7,
      cancelled_count: 1,
      responded_count: 4,
      suppressed_count: 2,
      failed_count: 0,
    }])),
    task: query(bucket<TaskReportRow>([{
      ...period,
      assignee_id: null,
      open_count: 3,
      completed_count: 9,
      overdue_count: 1,
      median_hours_to_complete: 12,
    }])),
    exception: query(bucket<ExceptionReportRow>([{
      ...period,
      exception_type: 'integration_failure',
      raised_count: 5,
      resolved_count: 3,
      open_count: 2,
      median_hours_to_resolve: 8,
    }])),
  };
}

describe('CanonicalReports', () => {
  beforeEach(() => {
    boundary.current = readyQueries();
  });

  it('renders all six contracted report sections and each authentic metric family', () => {
    render(<CanonicalReports />);

    for (const title of ['Lifecycle Funnel', 'Engagement', 'Closures', 'Campaigns', 'Tasks', 'Exceptions']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Week: Jul 6, 2026 – Jul 13, 2026')).toHaveLength(6);
    expect(screen.getByText('Median days')).toBeInTheDocument();
    expect(screen.getByText('Avg days to normal')).toBeInTheDocument();
    expect(screen.getByText('Net closed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText('Median completion hours')).toBeInTheDocument();
    expect(screen.getByText('Median resolution hours')).toBeInTheDocument();
    expect(screen.getByText('Intake')).toBeInTheDocument();
    expect(screen.getByText('Engaged')).toBeInTheDocument();
    expect(screen.getByText('Completed Care')).toBeInTheDocument();
    expect(screen.getByText('Integration Failure')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('completed_care')).not.toBeInTheDocument();
    expect(screen.queryByText(['At', 'Risk Overview'].join('-'))).not.toBeInTheDocument();
  });

  it('shows loading without claiming that backend views are pending', () => {
    boundary.current.funnel = { data: undefined, error: null, isPending: true };
    render(<CanonicalReports />);

    expect(screen.getByText('Loading lifecycle funnel report…')).toBeInTheDocument();
    expect(screen.queryByText(/Backend views pending/i)).not.toBeInTheDocument();
  });

  it('shows legitimate per-report empty states for successful zero-row results', () => {
    boundary.current = {
      campaign: query(null),
      closure: query(null),
      engagement: query(null),
      exception: query(null),
      funnel: query(null),
      task: query(null),
    };
    render(<CanonicalReports />);

    expect(screen.getByText('No lifecycle funnel data is available for the selected tenant.')).toBeInTheDocument();
    expect(screen.getByText('No engagement report data is available for the selected tenant.')).toBeInTheDocument();
    expect(screen.getByText('No closure report data is available for the selected tenant.')).toBeInTheDocument();
    expect(screen.getByText('No campaign report data is available for the selected tenant.')).toBeInTheDocument();
    expect(screen.getByText('No task report data is available for the selected tenant.')).toBeInTheDocument();
    expect(screen.getByText('No exception report data is available for the selected tenant.')).toBeInTheDocument();
  });

  it('labels only missing-relation failures as unavailable contracts', () => {
    boundary.current.funnel = {
      data: undefined,
      error: new ReportQueryError(
        'funnel',
        'v_crm_reports_funnel',
        'missing-contract',
        'schema cache miss',
      ),
      isPending: false,
    };
    boundary.current.engagement = {
      data: undefined,
      error: new ReportQueryError(
        'engagement',
        'v_crm_reports_engagement',
        'query-failed',
        'permission denied',
      ),
      isPending: false,
    };
    render(<CanonicalReports />);

    expect(screen.getByText('Lifecycle Funnel report contract unavailable')).toBeInTheDocument();
    expect(screen.getByText('v_crm_reports_funnel')).toBeInTheDocument();
    expect(screen.getByText(/view is missing or unavailable in the schema cache/i)).toBeInTheDocument();
    expect(screen.getByText('Engagement report failed')).toBeInTheDocument();
    expect(screen.getByText('permission denied')).toBeInTheDocument();
    expect(screen.queryByText('Engagement report contract unavailable')).not.toBeInTheDocument();
  });
});
