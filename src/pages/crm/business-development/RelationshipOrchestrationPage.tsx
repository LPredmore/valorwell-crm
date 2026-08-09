import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getRelationshipIntegrity, startGoogleConnection } from '@/lib/crm/relationship-orchestration';

export default function RelationshipOrchestrationPage() {
  const integrity = useQuery({ queryKey: ['relationship-orchestration-integrity'], queryFn: getRelationshipIntegrity, retry: false });
  const connect = useMutation({ mutationFn: startGoogleConnection });
  const data = integrity.data;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold">BTY orchestration</h1><p className="mt-2 text-muted-foreground">Google connections, feature controls, integrity invariants, and reconciliation issues.</p></div><Button asChild variant="outline"><Link to="/crm/business-development">Back</Link></Button></div>

    <Card><CardHeader><CardTitle>Google connections</CardTitle><CardDescription>Gmail is restricted to info@valorwell.org. Calendar is read-only and observes BTY recording events.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap gap-2"><Button disabled={connect.isPending} onClick={() => connect.mutate('gmail')}>Connect Gmail</Button><Button disabled={connect.isPending} variant="outline" onClick={() => connect.mutate('calendar')}>Connect Calendar</Button></div>
      {connect.isError && <p className="text-sm text-destructive">{connect.error instanceof Error ? connect.error.message : 'Google connection could not start.'}</p>}
      {data?.connections.length === 0 && <p className="text-sm text-muted-foreground">No Google relationship connections are active.</p>}
      {data?.connections.map((connection) => <div className="rounded-md border p-4" key={connection.id}><div className="flex flex-wrap items-center gap-2"><Badge>{connection.connectionType}</Badge><Badge variant="outline">{connection.status}</Badge><span className="text-sm">{connection.googleAccountEmail}</span></div><p className="mt-2 text-xs text-muted-foreground">Last sync: {formatDate(connection.lastSuccessfulSyncAt)} · Watch expires: {formatDate(connection.watchExpiration)}</p>{connection.lastErrorReason && <p className="mt-2 text-sm text-destructive">{connection.lastErrorCode}: {connection.lastErrorReason}</p>}</div>)}
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Feature controls</CardTitle><CardDescription>Capture is deployed first. Automatic mutation remains blocked until every go/no-go criterion passes.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data && Object.entries(data.flags).map(([name, enabled]) => <div className="rounded-md border p-3" key={name}><p className="break-all text-sm font-medium">{name}</p><Badge className="mt-2" variant={enabled ? 'default' : 'secondary'}>{enabled ? 'Enabled' : 'Disabled'}</Badge></div>)}</CardContent></Card>

    <Card><CardHeader><CardTitle>Zero-tolerance invariants</CardTitle><CardDescription>Automatic mutation must not be enabled while any invariant is non-zero.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data && Object.entries(data.invariants).map(([name, count]) => <div className={`rounded-md border p-3 ${count ? 'border-destructive' : ''}`} key={name}><p className="break-all text-sm font-medium">{name}</p><p className="mt-2 text-2xl font-bold">{count}</p></div>)}</CardContent></Card>

    <Card><CardHeader><CardTitle>Open reconciliation issues</CardTitle><CardDescription>Ambiguous evidence never mutates lifecycle state automatically.</CardDescription></CardHeader><CardContent className="space-y-3">{data?.issues.length === 0 && <p className="text-sm text-muted-foreground">No open issues.</p>}{data?.issues.map((issue) => <div className="rounded-md border p-4" key={issue.id}><div className="flex flex-wrap gap-2"><Badge variant={issue.severity === 'critical' ? 'destructive' : 'outline'}>{issue.severity}</Badge><Badge variant="secondary">{issue.issueType}</Badge></div><p className="mt-2 font-medium">{issue.summary}</p><p className="text-xs text-muted-foreground">{issue.source} · {formatDate(issue.createdAt)}</p>{issue.opportunityId && <Link className="mt-2 inline-block text-sm text-primary hover:underline" to={`/crm/business-development/opportunities/${issue.opportunityId}`}>Open opportunity</Link>}</div>)}</CardContent></Card>

    {integrity.isLoading && <p className="text-sm text-muted-foreground">Loading orchestration health…</p>}
    {integrity.isError && <p className="text-sm text-destructive">{integrity.error instanceof Error ? integrity.error.message : 'Orchestration health could not be loaded.'}</p>}
  </div>;
}

function formatDate(value?: string) { return value ? new Date(value).toLocaleString() : 'Not recorded'; }
