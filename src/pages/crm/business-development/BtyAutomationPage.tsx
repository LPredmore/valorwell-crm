import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  getBtyAutomationOverview,
  mergeBtyDuplicates,
  previewBtyDuplicates,
  type BtyAutomationRun,
  type BtyDuplicateGroup,
} from '@/lib/crm/bty-automation';
import { useCanMutate } from '@/hooks/crm/useCanMutate';

function statusBadge(run: BtyAutomationRun) {
  if (run.status === 'success') {
    return <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" />Success</Badge>;
  }
  if (run.status === 'failed') {
    return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Failed</Badge>;
  }
  return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />Pending</Badge>;
}

function enrichmentLabel(status: string | null) {
  if (!status) return 'Enrichment not started';
  if (status === 'success') return 'Contact identified';
  if (status === 'no_verified_contact') return 'No verified contact';
  if (status === 'failed') return 'Enrichment failed';
  return status.replace(/_/g, ' ');
}

export default function BtyAutomationPage() {
  const canMutate = useCanMutate();
  const queryClient = useQueryClient();
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const overview = useQuery({
    queryKey: ['bty-automation-overview'],
    queryFn: () => getBtyAutomationOverview(14),
    retry: false,
    refetchOnWindowFocus: true,
  });
  const duplicates = useQuery({
    queryKey: ['bty-duplicate-preview'],
    queryFn: previewBtyDuplicates,
    retry: false,
  });
  const merge = useMutation({
    mutationFn: ({ group, reason }: { group: BtyDuplicateGroup; reason: string }) => mergeBtyDuplicates(group, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bty-duplicate-preview'] });
      void queryClient.invalidateQueries({ queryKey: ['bty-automation-overview'] });
    },
  });

  const runs = overview.data?.runs ?? [];
  const rotation = overview.data?.state ?? {};

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">BTY prospect automation</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Daily 6:00 AM Central discovery of qualifying veteran-serving organizations for one state at a time, followed by 6:30 AM contact enrichment.
        </p>
      </div>
      <Button asChild variant="outline"><Link to="/crm/business-development/organizations">Organizations</Link></Button>
    </div>

    <Card>
      <CardHeader><CardTitle>State rotation</CardTitle><CardDescription>49-state rotation. Alaska and Washington, DC are permanently excluded.</CardDescription></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-4">
        <div><p className="text-xs uppercase text-muted-foreground">Today&apos;s target</p><p className="text-lg font-semibold">{rotation.currentState ?? '—'}</p></div>
        <div><p className="text-xs uppercase text-muted-foreground">Next state</p><p className="text-lg font-semibold">{rotation.nextState ?? '—'}</p></div>
        <div><p className="text-xs uppercase text-muted-foreground">Last successful state</p><p className="text-lg font-semibold">{rotation.lastSuccessfulState ?? '—'}</p></div>
        <div><p className="text-xs uppercase text-muted-foreground">Last successful date</p><p className="text-lg font-semibold">{rotation.lastSuccessfulBusinessDate ?? '—'}</p></div>
      </CardContent>
    </Card>

    {overview.isError && <Card><CardHeader><CardTitle>Automation history unavailable</CardTitle><CardDescription>{overview.error instanceof Error ? overview.error.message : 'Try again later.'}</CardDescription></CardHeader></Card>}

    <Card>
      <CardHeader><CardTitle>Recent runs</CardTitle><CardDescription>{runs.length} recorded business days. Failures never advance the rotation.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {overview.isLoading && <p className="text-sm text-muted-foreground">Loading runs…</p>}
        {!overview.isLoading && runs.length === 0 && <p className="text-sm text-muted-foreground">No discovery runs have been recorded yet.</p>}
        {runs.map((run) => <div className="rounded border p-3" key={run.runId}>
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(run)}
            <span className="font-medium">{run.businessDate}</span>
            <Badge variant="outline">{run.targetState}</Badge>
            <span className="text-sm text-muted-foreground">Attempt {run.attempt ?? 1} of 3</span>
            {run.organizationsCreatedCount ? <span className="text-sm text-muted-foreground">{run.organizationsCreatedCount} organizations created</span> : null}
            {run.subscriberRangeTierUsed && <Badge variant="secondary">Tier {run.subscriberRangeTierUsed}</Badge>}
            {run.notificationSentAt && <Badge variant="outline">Failure email sent</Badge>}
          </div>
          {run.status === 'failed' && run.errorSummary && <p className="mt-2 text-sm text-destructive">{String(run.errorSummary.message ?? 'Discovery failed.')}</p>}
          {run.organizations.length > 0 && <ul className="mt-3 space-y-1">
            {run.organizations.map((organization) => <li className="flex flex-wrap items-center gap-2 text-sm" key={organization.organizationId}>
              <Link className="font-medium text-primary hover:underline" to={`/crm/business-development/organizations/${organization.organizationId}`}>{organization.name}</Link>
              {organization.subscriberCount !== null && <span className="text-muted-foreground"><Users className="mr-1 inline h-3 w-3" />{organization.subscriberCount.toLocaleString()} subscribers</span>}
              <span className="text-muted-foreground">{enrichmentLabel(organization.enrichmentStatus)}</span>
              {organization.enrichmentContactId && <Link className="text-primary hover:underline" to={`/crm/business-development/contacts/${organization.enrichmentContactId}`}>Open contact</Link>}
            </li>)}
          </ul>}
        </div>)}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Duplicate cleanup</CardTitle><CardDescription>Only deterministic matches (website domain, YouTube channel, exact name) can be merged. Fuzzy similarity is review-only.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {duplicates.isLoading && <p className="text-sm text-muted-foreground">Scanning organizations…</p>}
        {duplicates.isError && <p className="text-sm text-destructive">{duplicates.error instanceof Error ? duplicates.error.message : 'Duplicate preview failed.'}</p>}
        {duplicates.data?.deterministic.length === 0 && <p className="text-sm text-muted-foreground">No deterministic duplicates were found.</p>}
        {duplicates.data?.deterministic.map((group) => <div className="space-y-2 rounded border p-3" key={`${group.matchType}:${group.matchKey}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{group.matchType.replace(/_/g, ' ')}</Badge>
            <span className="text-sm text-muted-foreground">{group.memberCount} records · keeping the oldest</span>
          </div>
          <ul className="space-y-1 text-sm">
            {group.members.map((member, index) => <li key={member.organizationId}>
              <Link className="text-primary hover:underline" to={`/crm/business-development/organizations/${member.organizationId}`}>{member.name}</Link>
              <span className="ml-2 text-muted-foreground">{index === 0 ? 'survivor' : 'merge into survivor'}{member.roles.length ? ` · ${member.roles.join(', ')}` : ''}</span>
            </li>)}
          </ul>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-64 flex-1 space-y-1">
              <Label htmlFor={`merge-reason-${group.matchKey}`}>Merge reason</Label>
              <Input
                id={`merge-reason-${group.matchKey}`}
                value={reasons[group.matchKey] ?? ''}
                onChange={(event) => setReasons((current) => ({ ...current, [group.matchKey]: event.target.value }))}
                placeholder="Why these records are the same organization"
              />
            </div>
            <Button
              disabled={!canMutate || merge.isPending || !(reasons[group.matchKey] ?? '').trim()}
              onClick={() => merge.mutate({ group, reason: (reasons[group.matchKey] ?? '').trim() })}
            >
              {merge.isPending ? 'Merging…' : 'Merge duplicates'}
            </Button>
          </div>
        </div>)}
        {merge.isError && <p className="text-sm text-destructive">{merge.error instanceof Error ? merge.error.message : 'The merge failed.'}</p>}

        {duplicates.data?.ambiguous.length ? <div className="rounded border border-dashed p-3">
          <p className="text-sm font-medium">Manual review only</p>
          <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
            {duplicates.data.ambiguous.map((item) => <li key={`${item.organizationId}:${item.similarTo.organizationId}`}>{item.name} ↔ {item.similarTo.name}</li>)}
          </ul>
        </div> : null}
      </CardContent>
    </Card>
  </div>;
}
