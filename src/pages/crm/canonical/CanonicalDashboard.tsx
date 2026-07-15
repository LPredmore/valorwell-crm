import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useReports, useTasks, useExceptions } from '@/hooks/canonical/useCrmData';
import { useCanonicalClients } from '@/hooks/canonical/useCanonicalClients';
import { Link } from 'react-router-dom';
import { ListTodo, Users, TrendingDown, Activity } from 'lucide-react';
import type { ReportBucket } from '@/repositories/types';
import { getReportPanelStatus } from './reportState';
import {
  formatEngagementState,
  formatLifecycleStage,
  formatReportBucketRange,
} from './reportPresentation';

interface SummaryQueryState {
  data: unknown;
  error: unknown;
  isPending: boolean;
}

function ReportSummaryStatus({
  emptyMessage,
  query,
  title,
}: {
  emptyMessage: string;
  query: SummaryQueryState;
  title: string;
}) {
  const status = getReportPanelStatus(query);
  if (status === 'ready') return null;
  if (status === 'loading') {
    return <p className="text-sm text-muted-foreground">Loading {title.toLowerCase()} report…</p>;
  }
  if (status === 'empty') {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  if (status === 'missing-contract') {
    return <p className="text-sm text-destructive">{title} report contract unavailable.</p>;
  }

  const message = query.error instanceof Error ? query.error.message : 'Unknown report query error';
  return <p className="text-sm text-destructive">{title} report failed: {message}</p>;
}

function BucketRange({ bucket }: { bucket: ReportBucket<unknown> }) {
  return (
    <p className="text-xs font-normal text-muted-foreground">
      Week: {formatReportBucketRange(bucket.bucketStart, bucket.bucketEnd)}
    </p>
  );
}

export default function CanonicalDashboard() {
  const reports = useReports();
  const funnel = reports.funnel;
  const engagement = reports.engagement;
  const tasks = useTasks({ view: 'overdue' });
  const exceptions = useExceptions();
  const dark = useCanonicalClients({ engagement: ['Went Dark'], pageSize: 1 });
  const funnelStatus = getReportPanelStatus(funnel);
  const engagementStatus = getReportPanelStatus(engagement);
  const funnelMax = Math.max(...(funnel.data?.rows.map(row => row.current_count) ?? [1]), 1);

  const kpis = [
    { label: 'Overdue Tasks', value: tasks.data?.length ?? '—', icon: ListTodo, href: '/crm/canonical/tasks?view=overdue', color: 'text-amber-600' },
    { label: 'Open Exceptions', value: exceptions.data?.filter(e => e.status === 'Open').length ?? '—', icon: Activity, href: '/crm/canonical/exceptions', color: 'text-indigo-600' },
    { label: 'Went Dark', value: dark.data?.total ?? '—', icon: TrendingDown, href: '/crm/canonical/clients?engagement=Went+Dark', color: 'text-orange-600' },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Operations Dashboard</h1>
        <p className="text-sm text-muted-foreground">Canonical CRM overview</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {kpis.map(k => (
          <Link key={k.label} to={k.href}>
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{k.label}</CardTitle>
                <k.icon className={`h-4 w-4 ${k.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">{k.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Lifecycle Funnel</CardTitle>
            {funnelStatus === 'ready' && funnel.data && <BucketRange bucket={funnel.data} />}
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {funnelStatus === 'ready' && funnel.data?.rows.map(row => (
                  <div key={row.stage ?? 'unspecified'} className="grid grid-cols-[10rem_1fr_4rem] items-center gap-3 text-sm">
                    <span className="truncate text-muted-foreground">{formatLifecycleStage(row.stage)}</span>
                    <div className="h-2 rounded-full bg-muted">
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${(row.current_count / funnelMax) * 100}%` }} />
                    </div>
                    <span className="text-right font-medium tabular-nums">{row.current_count}</span>
                  </div>
              ))}
              <ReportSummaryStatus
                title="Lifecycle Funnel"
                query={funnel}
                emptyMessage="No funnel data for the latest week."
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Engagement Mix</CardTitle>
            {engagementStatus === 'ready' && engagement.data && <BucketRange bucket={engagement.data} />}
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {engagementStatus === 'ready' && engagement.data?.rows.map(row => (
                <div key={row.engagement ?? 'unspecified'} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 text-sm">
                  <span className="text-muted-foreground">{formatEngagementState(row.engagement)}</span>
                  <span className="font-medium tabular-nums">Current {row.current_count}</span>
                  <span className="font-medium tabular-nums">Entered {row.entered_count}</span>
                </div>
              ))}
              <ReportSummaryStatus
                title="Engagement"
                query={engagement}
                emptyMessage="No engagement data for the latest week."
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
