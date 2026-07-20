import type { RelationshipCampaignMonitor as RelationshipCampaignMonitorModel } from '@/services/relationships/campaign-monitor';

const labels: Array<[keyof Pick<RelationshipCampaignMonitorModel, 'upcomingSends' | 'sent' | 'delivered' | 'replies' | 'failures' | 'suppressions' | 'pausedOrStopped'>, string]> = [
  ['upcomingSends', 'Upcoming sends'], ['sent', 'Sent'], ['delivered', 'Delivered'], ['replies', 'Replies'],
  ['failures', 'Failures'], ['suppressions', 'Suppressions'], ['pausedOrStopped', 'Paused or stopped'],
];

/** Render only typed monitor data; unavailable data is handled by the page, never shown as zero. */
export function RelationshipCampaignMonitor({ monitor }: { monitor: RelationshipCampaignMonitorModel }) {
  return <div className="space-y-5">
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {labels.map(([key, label]) => <div className="rounded border p-3" key={key}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-semibold">{monitor[key]}</dd></div>)}
    </dl>
    <div>
      <h2 className="font-medium">Enrollment state</h2>
      <p className="mt-1 text-sm text-muted-foreground">{monitor.enrollment.active} active · {monitor.enrollment.pending} pending · {monitor.enrollment.responded} responded · {monitor.enrollment.completed} completed</p>
    </div>
    <div>
      <h2 className="font-medium">Eligibility changes</h2>
      {monitor.eligibilityChanges.length
        ? <ul className="mt-2 space-y-1 text-sm text-muted-foreground">{monitor.eligibilityChanges.map((change) => <li key={`${change.enrollmentId}-${change.occurredAt}`}>{change.occurredAt}: {change.reason}</li>)}</ul>
        : <p className="mt-1 text-sm text-muted-foreground">No eligibility changes recorded.</p>}
    </div>
  </div>;
}
