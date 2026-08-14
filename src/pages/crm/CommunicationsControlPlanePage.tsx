import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCanMutate } from '@/hooks/crm/useCanMutate';
import {
  CONTROL_PLANE_FLAG_LABELS,
  canEnableControlPlaneFlag,
  getCampaignParticipation,
  getPersonIdentityOverview,
  listCampaignRegistry,
  listControlPlaneFlags,
  reconcilePersonIdentities,
  setControlPlaneFlag,
  type PersonReconcileResult,
} from '@/lib/crm/communications-control-plane';

export default function CommunicationsControlPlanePage() {
  const canMutate = useCanMutate();
  const queryClient = useQueryClient();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PersonReconcileResult | null>(null);

  const flags = useQuery({ queryKey: ['control-plane-flags'], queryFn: listControlPlaneFlags, retry: false });
  const identity = useQuery({ queryKey: ['control-plane-identity'], queryFn: getPersonIdentityOverview, retry: false });
  const registry = useQuery({ queryKey: ['control-plane-registry'], queryFn: listCampaignRegistry, retry: false });
  const participation = useQuery({
    queryKey: ['control-plane-participation'],
    queryFn: () => getCampaignParticipation({ limit: 25 }),
    retry: false,
  });

  const toggle = useMutation({
    mutationFn: ({ flagName, enabled, reason }: { flagName: string; enabled: boolean; reason: string }) =>
      setControlPlaneFlag(flagName, enabled, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['control-plane-flags'] });
    },
  });

  const reconcile = useMutation({
    mutationFn: (dryRun: boolean) => reconcilePersonIdentities(dryRun),
    onSuccess: (result) => {
      setPreview(result);
      if (!result.dryRun) {
        void queryClient.invalidateQueries({ queryKey: ['control-plane-identity'] });
        void queryClient.invalidateQueries({ queryKey: ['control-plane-participation'] });
      }
    },
  });

  const flagList = flags.data ?? [];

  return <div className="space-y-6">
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Communications control plane</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        Staged rollout switches, the canonical person directory, and cross-domain campaign visibility. Every switch change is recorded with the reason you give.
      </p>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>Implementation switches</CardTitle>
        <CardDescription>All switches start off. Trigger cutovers stay blocked until the trigger engine is on.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {flags.isLoading && <p className="text-sm text-muted-foreground">Loading switches…</p>}
        {flags.isError && <p className="text-sm text-destructive">{flags.error instanceof Error ? flags.error.message : 'Switches unavailable.'}</p>}
        {flagList.map((flag) => {
          const allowed = canEnableControlPlaneFlag(flag.flagName, flagList);
          const reason = reasons[flag.flagName] ?? '';
          return <div className="flex flex-wrap items-end gap-3 rounded border p-3" key={flag.flagName}>
            <div className="min-w-56 flex-1">
              <p className="font-medium">{CONTROL_PLANE_FLAG_LABELS[flag.flagName] ?? flag.flagName}</p>
              <p className="text-xs text-muted-foreground">{flag.flagName}</p>
              {!allowed && !flag.enabled && <p className="text-xs text-destructive">Enable the campaign trigger engine first.</p>}
            </div>
            <div className="min-w-64 flex-1 space-y-1">
              <Label htmlFor={`reason-${flag.flagName}`}>Reason</Label>
              <Input
                id={`reason-${flag.flagName}`}
                value={reason}
                placeholder="Why this switch is changing"
                onChange={(event) => setReasons((current) => ({ ...current, [flag.flagName]: event.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2">
              {flag.enabled ? <Badge>On</Badge> : <Badge variant="secondary">Off</Badge>}
              <Switch
                checked={flag.enabled}
                disabled={!canMutate || toggle.isPending || !reason.trim() || (!flag.enabled && !allowed)}
                onCheckedChange={(next) => toggle.mutate({ flagName: flag.flagName, enabled: next, reason: reason.trim() })}
              />
            </div>
          </div>;
        })}
        {toggle.isError && <p className="text-sm text-destructive">{toggle.error instanceof Error ? toggle.error.message : 'The switch change failed.'}</p>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Person directory</CardTitle>
        <CardDescription>Links clients, relationship contacts, provider applicants and staff that share an exact email or phone.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {identity.isError && <p className="text-sm text-destructive">{identity.error instanceof Error ? identity.error.message : 'Directory unavailable.'}</p>}
        {identity.data && <div className="grid gap-4 md:grid-cols-4">
          <div><p className="text-xs uppercase text-muted-foreground">People</p><p className="text-lg font-semibold">{identity.data.people}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">Identifiers</p><p className="text-lg font-semibold">{identity.data.identities}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">Linked records</p><p className="text-lg font-semibold">{identity.data.linkedRecords}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">People in more than one domain</p><p className="text-lg font-semibold">{identity.data.crossDomainPeople}</p></div>
        </div>}
        {identity.data && <div className="text-sm text-muted-foreground">
          {Object.entries(identity.data.byDomain).map(([domain, total]) => <span className="mr-4" key={domain}>
            {domain.replace(/_/g, ' ')}: {identity.data?.linkedByDomain?.[domain] ?? 0}/{total} linked
          </span>)}
        </div>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={reconcile.isPending} onClick={() => reconcile.mutate(true)}>
            {reconcile.isPending ? 'Working…' : 'Preview matches'}
          </Button>
          <Button disabled={!canMutate || reconcile.isPending} onClick={() => reconcile.mutate(false)}>
            Link records
          </Button>
        </div>
        {preview && <p className="text-sm text-muted-foreground">
          {preview.dryRun ? 'Preview' : 'Applied'} — {preview.peopleCreated} new people, {preview.peopleReused} matched to an existing person, {preview.recordsLinked} records linked, {preview.recordsWithoutIdentifier} records have no email or phone.
        </p>}
        {reconcile.isError && <p className="text-sm text-destructive">{reconcile.error instanceof Error ? reconcile.error.message : 'Reconciliation failed.'}</p>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Campaign registry</CardTitle>
        <CardDescription>{registry.data?.length ?? 0} campaigns across every engine, kept in step automatically.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {registry.isError && <p className="text-sm text-destructive">{registry.error instanceof Error ? registry.error.message : 'Registry unavailable.'}</p>}
        {(registry.data ?? []).map((entry) => <div className="flex flex-wrap items-center gap-2 border-b py-2 text-sm last:border-0" key={entry.id}>
          <span className="font-medium">{entry.name}</span>
          <Badge variant="outline">{entry.campaign_domain}</Badge>
          <span className="text-muted-foreground">{entry.status}</span>
          {entry.is_active && <Badge variant="secondary">Active</Badge>}
        </div>)}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Recent participation</CardTitle>
        <CardDescription>Latest 25 enrolments from every campaign domain in one list.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {participation.isError && <p className="text-sm text-destructive">{participation.error instanceof Error ? participation.error.message : 'Participation unavailable.'}</p>}
        {(participation.data ?? []).map((row) => <div className="flex flex-wrap items-center gap-2 border-b py-2 text-sm last:border-0" key={row.enrollmentId}>
          <Badge variant="outline">{row.campaignDomain}</Badge>
          <span className="font-medium">{row.campaignName ?? 'Unnamed campaign'}</span>
          <span className="text-muted-foreground">{row.status ?? 'unknown'}</span>
          <span className="text-muted-foreground">{row.enrolledAt ? new Date(row.enrolledAt).toLocaleDateString() : '—'}</span>
          {!row.personId && <Badge variant="secondary">Not yet linked to a person</Badge>}
        </div>)}
      </CardContent>
    </Card>
  </div>;
}
