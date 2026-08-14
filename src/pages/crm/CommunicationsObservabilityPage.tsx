import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Activity, ShieldOff, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getCommunicationsObservability } from '@/lib/crm/communications-control-plane';

const WINDOWS = [
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

function pct(rate: number) {
  return `${(rate * 100).toFixed(1)}%`;
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone?: 'warn' | 'danger' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={`mt-1 text-2xl font-semibold tabular-nums ${
            tone === 'danger' ? 'text-destructive' : tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : ''
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

export default function CommunicationsObservabilityPage() {
  const [windowDays, setWindowDays] = useState('7');
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['crm-communications-observability', windowDays],
    queryFn: () => getCommunicationsObservability(Number(windowDays)),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const queue = data?.queueDepth;
  const failures = data?.failureRates;
  const suppression = data?.suppressionGrowth;
  const maxDaily = Math.max(1, ...(suppression?.daily ?? []).map((d) => d.added));

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Communications observability</h1>
          <p className="text-sm text-muted-foreground">
            Queue depth, failure rates, and suppression growth across campaigns and newsletters.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={windowDays} onValueChange={setWindowDays}>
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => (
                <SelectItem key={w.value} value={w.value}>
                  {w.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => void refetch()} title="Refresh">
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {isError && (
        <Card>
          <CardContent className="flex items-center gap-3 p-4 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {error instanceof Error ? error.message : 'Metrics could not be loaded.'}
          </CardContent>
        </Card>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading metrics…</p>}

      {queue && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4" /> Queue depth
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Trigger jobs pending" value={queue.triggerJobsPending} />
            <Metric
              label="Trigger jobs overdue"
              value={queue.triggerJobsOverdue}
              tone={queue.triggerJobsOverdue > 0 ? 'warn' : undefined}
            />
            <Metric
              label="Automation events unprocessed"
              value={queue.automationEventsUnprocessed}
              tone={queue.automationEventsUnprocessed > 50 ? 'warn' : undefined}
            />
            <Metric label="Audience enrollments due" value={queue.audienceEnrollmentsDue} />
            <Metric label="Newsletter recipients pending" value={queue.newsletterRecipientsPending} />
            <Metric
              label="Newsletter recipients claimed"
              value={queue.newsletterRecipientsClaimed}
              tone={queue.newsletterRecipientsClaimed > 0 ? 'warn' : undefined}
            />
            <Metric label="Newsletters sending" value={queue.newslettersSending} />
            <Metric label="Newsletters scheduled" value={queue.newslettersScheduled} />
          </div>
        </section>
      )}

      {failures && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4" /> Failure rates
          </h2>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pipeline</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  { label: 'Campaign trigger jobs', ...failures.triggerJobs },
                  { label: 'Audience campaign steps', ...failures.audienceSteps },
                  {
                    label: 'Newsletter recipients (failed + bounced)',
                    total: failures.newsletterRecipients.total,
                    failed: failures.newsletterRecipients.failed + failures.newsletterRecipients.bounced,
                    rate: failures.newsletterRecipients.rate,
                  },
                ].map((row) => (
                  <TableRow key={row.label}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.failed}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Badge variant={row.rate > 0.05 ? 'destructive' : 'outline'}>{pct(row.rate)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </section>
      )}

      {suppression && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <ShieldOff className="h-4 w-4" /> Suppression growth
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Total suppressed mailboxes" value={suppression.total} />
            <Metric label="Added in window" value={suppression.addedInWindow} />
            <Metric
              label="Avg per day"
              value={(suppression.addedInWindow / Math.max(1, data?.windowDays ?? 1)).toFixed(1)}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Daily additions</CardTitle>
                <CardDescription>Newly suppressed mailboxes per day.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {suppression.daily.length === 0 && (
                  <p className="text-sm text-muted-foreground">No new suppressions in this window.</p>
                )}
                {suppression.daily.map((d) => (
                  <div key={d.day} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">{d.day}</span>
                    <div className="h-2 flex-1 rounded bg-muted">
                      <div
                        className="h-2 rounded bg-primary"
                        style={{ width: `${(d.added / maxDaily) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-xs tabular-nums">{d.added}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By reason</CardTitle>
                <CardDescription>Why mailboxes were suppressed in this window.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.keys(suppression.byReason).length === 0 && (
                  <p className="text-sm text-muted-foreground">No suppression reasons recorded.</p>
                )}
                {Object.entries(suppression.byReason).map(([reason, count]) => (
                  <div key={reason} className="flex items-center justify-between text-sm">
                    <span className="capitalize">{reason.replace(/_/g, ' ')}</span>
                    <span className="tabular-nums font-medium">{count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {data && (
        <p className="text-xs text-muted-foreground">
          Generated {new Date(data.generatedAt).toLocaleString()} · auto-refreshes every minute.
        </p>
      )}
    </div>
  );
}
