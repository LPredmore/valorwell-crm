import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  ACTIVATION_FLAG_LABELS,
  ACTIVATION_FLAG_ORDER,
  evaluateFlagGate,
  type ActivationFlagName,
} from '@/domain/relationships/activation-gating';
import { getRelationshipIntegrity, setFeatureFlag, startGoogleConnection } from '@/lib/crm/relationship-orchestration';

export default function RelationshipOrchestrationPage() {
  const queryClient = useQueryClient();
  const integrity = useQuery({ queryKey: ['relationship-orchestration-integrity'], queryFn: getRelationshipIntegrity, retry: false });
  const connect = useMutation({ mutationFn: startGoogleConnection });
  const [reason, setReason] = useState('');
  const flagMutation = useMutation({
    mutationFn: ({ flagName, enabled }: { flagName: string; enabled: boolean }) => setFeatureFlag(flagName, enabled, reason),
    onSuccess: () => {
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['relationship-orchestration-integrity'] });
    },
  });
  const data = integrity.data;
  const flags = data?.flags ?? {};
  const invariants = data?.invariants ?? {};

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold">BTY orchestration</h1><p className="mt-2 text-muted-foreground">Google connections, staged activation, integrity invariants, and reconciliation issues.</p></div><div className="flex gap-2"><Button asChild variant="outline"><Link to="/crm/business-development/orchestration/reconciliation">Legacy reconciliation</Link></Button><Button asChild variant="outline"><Link to="/crm/business-development">Back</Link></Button></div></div>

    <Card><CardHeader><CardTitle>Google connections</CardTitle><CardDescription>Gmail is restricted to info@valorwell.org. Calendar is read-only and observes BTY recording events. Watch renewal runs daily at 08:23 UTC and reconciliation hourly at :17.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap gap-2"><Button disabled={connect.isPending} onClick={() => connect.mutate('gmail')}>Connect Gmail</Button><Button disabled={connect.isPending} variant="outline" onClick={() => connect.mutate('calendar')}>Connect Calendar</Button></div>
      {connect.isError && <p className="text-sm text-destructive">{connect.error instanceof Error ? connect.error.message : 'Google connection could not start.'}</p>}
      {data?.connections.length === 0 && <p className="text-sm text-muted-foreground">No Google relationship connections are active.</p>}
      {data?.connections.map((connection) => <div className="rounded-md border p-4" key={connection.id}><div className="flex flex-wrap items-center gap-2"><Badge>{connection.connectionType}</Badge><Badge variant="outline">{connection.status}</Badge><span className="text-sm">{connection.googleAccountEmail}</span></div><p className="mt-2 text-xs text-muted-foreground">Last sync: {formatDate(connection.lastSuccessfulSyncAt)} · Watch expires: {formatDate(connection.watchExpiration)} · Last full reconciliation: {formatDate(connection.lastFullReconciliationAt)}</p>{connection.lastErrorReason && <p className="mt-2 text-sm text-destructive">{connection.lastErrorCode}: {connection.lastErrorReason}</p>}</div>)}
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Staged activation</CardTitle><CardDescription>Capture is deployed first. Enable in order: lifecycle mutation, auto-enrollment, then Gmail and Calendar effects. Every change requires a reason and is written to the activity ledger.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="max-w-xl space-y-1"><label className="text-sm font-medium" htmlFor="flag-reason">Reason for the next change</label><Input id="flag-reason" onChange={(event) => setReason(event.target.value)} placeholder="Shadow validation complete; invariants zero" value={reason} /></div>
      <div className="grid gap-3 sm:grid-cols-2">{ACTIVATION_FLAG_ORDER.map((flagName: ActivationFlagName) => {
        const enabled = Boolean(flags[flagName]);
        const gate = evaluateFlagGate(flagName, flags, invariants);
        const blocked = !enabled && !gate.canEnable;
        return <div className="rounded-md border p-3" key={flagName}>
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-sm font-medium">{ACTIVATION_FLAG_LABELS[flagName]}</p><p className="break-all text-xs text-muted-foreground">{flagName}</p></div>
            <Switch aria-label={ACTIVATION_FLAG_LABELS[flagName]} checked={enabled} disabled={flagMutation.isPending || blocked || reason.trim().length === 0} onCheckedChange={(next) => flagMutation.mutate({ flagName, enabled: next })} />
          </div>
          {blocked && <p className="mt-2 text-xs text-destructive">{gate.blockedReason}</p>}
          {!blocked && reason.trim().length === 0 && <p className="mt-2 text-xs text-muted-foreground">Enter a reason to change this switch.</p>}
        </div>;
      })}</div>
      {flagMutation.isError && <p className="text-sm text-destructive">{flagMutation.error instanceof Error ? flagMutation.error.message : 'The activation switch could not be changed.'}</p>}
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Zero-tolerance invariants</CardTitle><CardDescription>Automatic mutation must not be enabled while any invariant is non-zero.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(invariants).map(([name, count]) => <div className={`rounded-md border p-3 ${count ? 'border-destructive' : ''}`} key={name}><p className="break-all text-sm font-medium">{name}</p><p className="mt-2 text-2xl font-bold">{count}</p></div>)}</CardContent></Card>

    <Card><CardHeader><CardTitle>Open reconciliation issues</CardTitle><CardDescription>Ambiguous evidence never mutates lifecycle state automatically.</CardDescription></CardHeader><CardContent className="space-y-4">{data?.issues.length === 0 && <p className="text-sm text-muted-foreground">No open issues.</p>}{groupIssues(data?.issues ?? []).map(([issueType, issues]) => <div className="space-y-3" key={issueType}><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{issueType}</h3><Badge variant="secondary">{issues.length}</Badge></div>{issues.map((issue) => <div className="rounded-md border p-4" key={issue.id}><div className="flex flex-wrap gap-2"><Badge variant={issue.severity === 'critical' ? 'destructive' : 'outline'}>{issue.severity}</Badge><Badge variant="secondary">{issue.issueType}</Badge></div><p className="mt-2 font-medium">{issue.summary}</p><p className="text-xs text-muted-foreground">{issue.source} · {formatDate(issue.createdAt)}</p>{issue.opportunityId && <Link className="mt-2 inline-block text-sm text-primary hover:underline" to={`/crm/business-development/opportunities/${issue.opportunityId}`}>Open opportunity</Link>}</div>)}</div>)}</CardContent></Card>

    {integrity.isLoading && <p className="text-sm text-muted-foreground">Loading orchestration health…</p>}
    {integrity.isError && <p className="text-sm text-destructive">{integrity.error instanceof Error ? integrity.error.message : 'Orchestration health could not be loaded.'}</p>}
  </div>;
}

type IssueList = NonNullable<Awaited<ReturnType<typeof getRelationshipIntegrity>>>['issues'];

function groupIssues(issues: IssueList): Array<[string, IssueList]> {
  const groups = new Map<string, IssueList>();
  for (const issue of issues) {
    const existing = groups.get(issue.issueType) ?? [];
    groups.set(issue.issueType, [...existing, issue]);
  }
  return [...groups.entries()];
}

function formatDate(value?: string) { return value ? new Date(value).toLocaleString() : 'Not recorded'; }
