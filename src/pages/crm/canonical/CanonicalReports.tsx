import { useReports } from '@/hooks/canonical/useCrmData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function CanonicalReports() {
  const r = useReports();
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">Canonical operational reporting</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Journey Funnel</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th className="pb-2">Stage</th><th className="pb-2 text-right">Count</th><th className="pb-2 text-right">Median days</th></tr></thead>
              <tbody>
                {r.funnel.data?.map(row => (
                  <tr key={row.stage} className="border-t"><td className="py-1.5">{row.stage}</td><td className="py-1.5 text-right tabular-nums">{row.count}</td><td className="py-1.5 text-right tabular-nums">{row.medianDays}</td></tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">At-Risk Overview</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Total at-risk" v={r.atRisk.data?.totalAtRisk} />
            <Row label="Newly at-risk" v={r.atRisk.data?.newlyAtRisk} />
            <Row label="Resolved" v={r.atRisk.data?.resolved} />
            <Row label="Avg days at risk" v={r.atRisk.data?.averageDaysAtRisk} />
            <Row label="Overdue interventions" v={r.atRisk.data?.overdueInterventions} />
            <div className="pt-2 text-muted-foreground">By reason</div>
            {r.atRisk.data?.byReason.map(x => <Row key={x.reason} label={x.reason} v={x.count} />)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Campaign Performance</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground">
                <th className="pb-2">Campaign</th><th className="text-right">Enrolled</th><th className="text-right">Sent</th><th className="text-right">Responded</th><th className="text-right">Suppressed</th>
              </tr></thead>
              <tbody>
                {r.campaign.data?.map(c => (
                  <tr key={c.campaignId} className="border-t"><td className="py-1.5">{c.name}</td>
                    <td className="text-right tabular-nums">{c.enrolled}</td>
                    <td className="text-right tabular-nums">{c.sent}</td>
                    <td className="text-right tabular-nums">{c.responded}</td>
                    <td className="text-right tabular-nums">{c.suppressed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Tasks & Exceptions</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Open tasks" v={r.task.data?.open} />
            <Row label="Overdue tasks" v={r.task.data?.overdue} />
            <Row label="Avg completion (hrs)" v={r.task.data?.avgCompletionHours} />
            <div className="pt-2 text-muted-foreground">Exceptions by severity</div>
            {r.exception.data?.bySeverity.map(x => <Row key={x.severity} label={x.severity} v={x.count} />)}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const Row = ({ label, v }: { label: string; v: number | string | undefined }) => (
  <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span className="font-medium tabular-nums">{v ?? '—'}</span></div>
);
