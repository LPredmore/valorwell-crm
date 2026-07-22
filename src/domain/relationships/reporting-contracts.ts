import type { RelationshipReportMetric, RelationshipSearchResult } from './contracts';

export const relationshipSearchKinds = ['organization', 'contact', 'opportunity', 'campaign'] as const satisfies readonly RelationshipSearchResult['kind'][];

export const relationshipOperationalMetricCatalog = [
  ['organizations_needing_review', 'Organizations needing review'],
  ['opportunities_needing_qualification', 'BTY opportunities needing qualification'],
  ['overdue_next_actions', 'Overdue next actions'],
  ['unassigned_relationships', 'Unassigned relationships'],
  ['active_outreach_campaigns', 'Active outreach campaigns'],
  ['replies_requiring_staff_action', 'Replies requiring staff action'],
  ['import_conflicts', 'Import conflicts'],
  ['recently_updated_relationships', 'Recently updated relationships'],
] as const;

export function splitRelationshipReportMetrics(metrics: RelationshipReportMetric[]) {
  return {
    operational: metrics.filter((metric) => !metric.key.startsWith('period_')),
    period: metrics.filter((metric) => metric.key.startsWith('period_')),
  };
}

export function relationshipMetricState(metric?: RelationshipReportMetric) {
  if (!metric) return { available: false as const, reason: 'The reporting contract did not return this metric.' };
  if (metric.value === undefined) return { available: false as const, reason: metric.unavailableReason ?? 'This metric is unavailable.' };
  return { available: true as const, value: metric.value };
}
