import type { ReactNode } from 'react';
import { useReports } from '@/hooks/canonical/useCrmData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import type { ReportBucket } from '@/repositories/types';
import type { ReportViewName } from '@/repositories/reportErrors';
import { getReportPanelStatus } from './reportState';
import {
  formatClosureDisposition,
  formatDimensionLabel,
  formatEngagementState,
  formatLifecycleStage,
  formatReportBucketRange,
} from './reportPresentation';

interface ReportQueryState<Data> {
  data: Data | null | undefined;
  error: Error | null;
  isPending: boolean;
}

interface ReportCardProps<Row> {
  emptyMessage: string;
  query: ReportQueryState<ReportBucket<Row>>;
  renderRows: (rows: Row[]) => ReactNode;
  title: string;
  view: ReportViewName;
}

function BucketRange({ bucket }: { bucket: ReportBucket<unknown> }) {
  return (
    <p className="text-xs font-normal text-muted-foreground">
      Week: {formatReportBucketRange(bucket.bucketStart, bucket.bucketEnd)}
    </p>
  );
}

function ReportCard<Row>({ emptyMessage, query, renderRows, title, view }: ReportCardProps<Row>) {
  const status = getReportPanelStatus(query);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {status === 'ready' && query.data && <BucketRange bucket={query.data} />}
      </CardHeader>
      <CardContent>
        {status === 'loading' && (
          <p className="text-sm text-muted-foreground">Loading {title.toLowerCase()} report…</p>
        )}
        {status === 'empty' && (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        )}
        {status === 'missing-contract' && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{title} report contract unavailable</AlertTitle>
            <AlertDescription>
              The <code>{view}</code> view is missing or unavailable in the schema cache.
            </AlertDescription>
          </Alert>
        )}
        {status === 'error' && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{title} report failed</AlertTitle>
            <AlertDescription>{query.error?.message ?? 'Unknown report query error'}</AlertDescription>
          </Alert>
        )}
        {status === 'ready' && query.data && renderRows(query.data.rows)}
      </CardContent>
    </Card>
  );
}

const th = 'pb-2 pr-3 text-left font-medium text-muted-foreground';
const numberTh = `${th} text-right`;
const td = 'border-t py-1.5 pr-3';
const numberTd = `${td} text-right tabular-nums`;

export default function CanonicalReports() {
  const reports = useReports();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">Tenant-scoped canonical weekly reporting</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ReportCard
          title="Lifecycle Funnel"
          view="v_crm_reports_funnel"
          query={reports.funnel}
          emptyMessage="No lifecycle funnel data is available for the selected tenant."
          renderRows={(rows) => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={th}>Stage</th><th className={numberTh}>Entered</th><th className={numberTh}>Exited</th><th className={numberTh}>Current</th><th className={numberTh}>Median days</th></tr></thead>
                <tbody>{rows.map((row, index) => (
                  <tr key={`${row.stage ?? 'unspecified'}-${index}`}>
                    <td className={td}>{formatLifecycleStage(row.stage)}</td>
                    <td className={numberTd}>{row.entered_count}</td>
                    <td className={numberTd}>{row.exited_count}</td>
                    <td className={numberTd}>{row.current_count}</td>
                    <td className={numberTd}>{row.median_days_in_stage}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        />

        <ReportCard
          title="Engagement"
          view="v_crm_reports_engagement"
          query={reports.engagement}
          emptyMessage="No engagement report data is available for the selected tenant."
          renderRows={(rows) => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={th}>State</th><th className={numberTh}>Current</th><th className={numberTh}>Entered</th><th className={numberTh}>Avg days to normal</th></tr></thead>
                <tbody>{rows.map((row, index) => (
                  <tr key={`${row.engagement ?? 'unspecified'}-${index}`}>
                    <td className={td}>{formatEngagementState(row.engagement)}</td>
                    <td className={numberTd}>{row.current_count}</td>
                    <td className={numberTd}>{row.entered_count}</td>
                    <td className={numberTd}>{row.avg_days_to_normal}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        />

        <ReportCard
          title="Closures"
          view="v_crm_reports_closure"
          query={reports.closure}
          emptyMessage="No closure report data is available for the selected tenant."
          renderRows={(rows) => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={th}>Disposition</th><th className={numberTh}>Closed</th><th className={numberTh}>Reopened</th><th className={numberTh}>Net closed</th></tr></thead>
                <tbody>{rows.map((row, index) => (
                  <tr key={`${row.disposition_reason ?? 'unspecified'}-${index}`}>
                    <td className={td}>{formatClosureDisposition(row.disposition_reason)}</td>
                    <td className={numberTd}>{row.closed_count}</td>
                    <td className={numberTd}>{row.reopened_count}</td>
                    <td className={numberTd}>{row.net_closed}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        />

        <ReportCard
          title="Campaigns"
          view="v_crm_reports_campaigns"
          query={reports.campaign}
          emptyMessage="No campaign report data is available for the selected tenant."
          renderRows={(rows) => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={th}>Campaign</th><th className={numberTh}>Enrolled</th><th className={numberTh}>Completed</th><th className={numberTh}>Cancelled</th><th className={numberTh}>Responded</th><th className={numberTh}>Suppressed</th><th className={numberTh}>Failed</th></tr></thead>
                <tbody>{rows.map((row, index) => (
                  <tr key={`${row.campaign_id ?? 'unknown'}-${index}`}>
                    <td className={`${td} font-mono text-xs`}>{row.campaign_id ?? 'Unknown campaign'}</td>
                    <td className={numberTd}>{row.enrolled_count}</td>
                    <td className={numberTd}>{row.completed_count}</td>
                    <td className={numberTd}>{row.cancelled_count}</td>
                    <td className={numberTd}>{row.responded_count}</td>
                    <td className={numberTd}>{row.suppressed_count}</td>
                    <td className={numberTd}>{row.failed_count}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        />

        <ReportCard
          title="Tasks"
          view="v_crm_reports_tasks"
          query={reports.task}
          emptyMessage="No task report data is available for the selected tenant."
          renderRows={(rows) => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={th}>Assignee</th><th className={numberTh}>Open</th><th className={numberTh}>Completed</th><th className={numberTh}>Overdue</th><th className={numberTh}>Median completion hours</th></tr></thead>
                <tbody>{rows.map((row, index) => (
                  <tr key={`${row.assignee_id ?? 'unassigned'}-${index}`}>
                    <td className={`${td} font-mono text-xs`}>{row.assignee_id ?? 'Unassigned'}</td>
                    <td className={numberTd}>{row.open_count}</td>
                    <td className={numberTd}>{row.completed_count}</td>
                    <td className={numberTd}>{row.overdue_count}</td>
                    <td className={numberTd}>{row.median_hours_to_complete}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        />

        <ReportCard
          title="Exceptions"
          view="v_crm_reports_exceptions"
          query={reports.exception}
          emptyMessage="No exception report data is available for the selected tenant."
          renderRows={(rows) => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={th}>Type</th><th className={numberTh}>Raised</th><th className={numberTh}>Resolved</th><th className={numberTh}>Open</th><th className={numberTh}>Median resolution hours</th></tr></thead>
                <tbody>{rows.map((row, index) => (
                  <tr key={`${row.exception_type ?? 'unspecified'}-${index}`}>
                    <td className={td}>{formatDimensionLabel(row.exception_type)}</td>
                    <td className={numberTd}>{row.raised_count}</td>
                    <td className={numberTd}>{row.resolved_count}</td>
                    <td className={numberTd}>{row.open_count}</td>
                    <td className={numberTd}>{row.median_hours_to_resolve}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        />
      </div>
    </div>
  );
}
