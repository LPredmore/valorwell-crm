import type { RelationshipReportMetric } from '@/domain/relationships/contracts';

export function RelationshipReportMetrics({ metrics }: { metrics: RelationshipReportMetric[] }) {
  return <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map((metric) => <div className="rounded border p-3" key={metric.key}><dt className="text-sm text-muted-foreground">{metric.label}</dt><dd className="mt-1 text-2xl font-semibold">{metric.value === undefined ? 'Unavailable' : metric.value}</dd>{metric.unavailableReason && <p className="mt-1 text-xs text-muted-foreground">{metric.unavailableReason}</p>}</div>)}</dl>;
}
