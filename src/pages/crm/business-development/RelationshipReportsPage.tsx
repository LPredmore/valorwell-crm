import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import type { RelationshipReportMetric } from '@/domain/relationships/contracts';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { dataProvider } from '@/services/dataProvider';

export default function RelationshipReportsPage() {
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('reporting');
  const available = capability?.available === true;
  const defaults = useMemo(defaultPeriod, []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);

  const metrics = useQuery({
    queryKey: ['relationship-report-metrics', from, to],
    queryFn: () => dataProvider.relationships.listReportMetrics({
      period: { from: startOfDay(from), to: endOfDay(to) },
    }),
    enabled: available,
    retry: false,
  });

  const operational = metrics.data?.filter((metric) => !metric.key.startsWith('period_')) ?? [];
  const period = metrics.data?.filter((metric) => metric.key.startsWith('period_')) ?? [];

  return <div className="space-y-6">
    <div>
      <div className="mb-2 flex flex-wrap gap-2"><Badge variant="outline">Pass 13</Badge><Badge variant="secondary">Verified operational reporting</Badge></div>
      <h1 className="text-3xl font-bold tracking-tight">Business Development reports</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">Tenant-scoped relationship, outreach, reply, import, and campaign metrics. Numeric zero means the verified count is zero; unavailable data is labeled separately.</p>
    </div>

    <RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} />

    <Card>
      <CardHeader><CardTitle>Reporting period</CardTitle><CardDescription>Period metrics use the selected inclusive date range. Operational queue metrics reflect current state.</CardDescription></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="From" id="report-from"><Input id="report-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
        <Field label="Through" id="report-to"><Input id="report-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field>
      </CardContent>
    </Card>

    {available && metrics.isLoading && <Card><CardHeader><CardTitle>Loading verified metrics</CardTitle><CardDescription>The dashboard is querying Billing Hub rather than displaying placeholder zeroes.</CardDescription></CardHeader></Card>}
    {metrics.isError && <Card><CardHeader><CardTitle>Metrics unavailable</CardTitle><CardDescription>{message(metrics.error)}</CardDescription></CardHeader></Card>}

    {metrics.data && <>
      <MetricSection title="Current operational state" description="Live queues and inventory across the relationship domain." metrics={operational} />
      <MetricSection title="Selected-period activity" description={`${from} through ${to}.`} metrics={period} />
    </>}
  </div>;
}

function MetricSection({ title, description, metrics }: { title: string; description: string; metrics: RelationshipReportMetric[] }) {
  return <Card>
    <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
    <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric) => <div className="rounded-lg border p-4" key={metric.key}>
        <p className="text-sm font-medium text-muted-foreground">{metric.label}</p>
        {metric.value !== undefined
          ? <p className="mt-2 text-3xl font-semibold tabular-nums">{formatValue(metric)}</p>
          : <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{metric.unavailableReason ?? 'This metric is unavailable.'}</p>}
      </div>)}
      {metrics.length === 0 && <p className="text-sm text-muted-foreground">No metric contract was returned for this section.</p>}
    </CardContent>
  </Card>;
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function defaultPeriod() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  return { from: localDate(from), to: localDate(to) };
}

function localDate(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function startOfDay(value: string) { return new Date(`${value}T00:00:00`).toISOString(); }
function endOfDay(value: string) { return new Date(`${value}T23:59:59.999`).toISOString(); }
function formatValue(metric: RelationshipReportMetric) { return metric.key.endsWith('_percent') ? `${metric.value}%` : metric.value?.toLocaleString(); }
function message(error: unknown) { return error instanceof Error ? error.message : 'Relationship reporting could not be loaded.'; }
