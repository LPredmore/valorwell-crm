import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useReports, useTasks, useExceptions } from '@/hooks/canonical/useCrmData';
import { useCanonicalClients } from '@/hooks/canonical/useCanonicalClients';
import { Link } from 'react-router-dom';
import { AlertTriangle, ListTodo, Users, TrendingDown, Activity } from 'lucide-react';

export default function CanonicalDashboard() {
  const funnel = useReports().funnel;
  const atRisk = useReports().atRisk;
  const engagement = useReports().engagement;
  const tasks = useTasks({ view: 'overdue' });
  const exceptions = useExceptions();
  const dark = useCanonicalClients({ engagement: ['Went Dark'], pageSize: 1 });

  const kpis = [
    { label: 'At-Risk Clients', value: atRisk.data?.totalAtRisk ?? '—', icon: AlertTriangle, href: '/crm/canonical/clients?atRisk=1', color: 'text-red-600' },
    { label: 'Overdue Tasks', value: tasks.data?.length ?? '—', icon: ListTodo, href: '/crm/canonical/tasks?view=overdue', color: 'text-amber-600' },
    { label: 'Open Exceptions', value: exceptions.data?.filter(e => e.status === 'Open').length ?? '—', icon: Activity, href: '/crm/canonical/exceptions', color: 'text-indigo-600' },
    { label: 'Went Dark', value: dark.data?.total ?? '—', icon: TrendingDown, href: '/crm/canonical/clients?engagement=Went+Dark', color: 'text-orange-600' },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Operations Dashboard</h1>
        <p className="text-sm text-muted-foreground">Canonical CRM overview — mock data provider</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
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
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Lifecycle Funnel</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {funnel.data?.map(row => {
                const max = Math.max(...(funnel.data?.map(r => r.count) ?? [1]));
                return (
                  <div key={row.stage} className="grid grid-cols-[10rem_1fr_4rem] items-center gap-3 text-sm">
                    <span className="truncate text-muted-foreground">{row.stage}</span>
                    <div className="h-2 rounded-full bg-muted">
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${(row.count / max) * 100}%` }} />
                    </div>
                    <span className="text-right font-medium tabular-nums">{row.count}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Engagement Mix</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {engagement.data && Object.entries(engagement.data.counts).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium tabular-nums">{v as number}</span>
                </div>
              ))}
              <div className="border-t pt-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Median days since contact</span><span className="font-medium">{engagement.data?.medianDaysSinceLastContact}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Re-engagement rate</span><span className="font-medium">{engagement.data ? Math.round(engagement.data.reengagementRate * 100) : 0}%</span></div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
