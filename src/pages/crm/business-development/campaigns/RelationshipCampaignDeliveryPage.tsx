import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { dataProvider } from '@/services/dataProvider';

const reasonLabels: Record<string, string> = {
  provider_not_configured: 'Resend provider configuration is not installed.',
  provider_not_ready: 'The provider is not marked ready.',
  sender_not_verified: 'The campaign sender does not match the verified sender.',
  inbound_address_not_verified: 'The inbound reply address is not verified.',
  postal_address_missing: 'The compliance postal address is missing.',
  webhook_not_verified: 'The signed webhook has not been verified.',
  worker_not_verified: 'The service-only delivery worker has not been verified.',
  campaign_not_active: 'The campaign definition is not active.',
  no_active_steps: 'The campaign has no active steps.',
  campaign_not_found: 'The campaign could not be found.',
};

export default function RelationshipCampaignDeliveryPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('campaigns');
  const available = capability?.available === true;
  const [reason, setReason] = useState('');
  const campaign = useQuery({ queryKey: ['relationship-campaign', id], queryFn: () => dataProvider.relationships.getCampaign(id), enabled: available && Boolean(id), retry: false });
  const readiness = useQuery({ queryKey: ['relationship-delivery-readiness', id], queryFn: () => dataProvider.relationships.getDeliveryReadiness(id), enabled: available && Boolean(id), retry: false });

  const execution = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!campaign.data) throw new Error('Load the current campaign before changing delivery.');
      return dataProvider.relationships.setCampaignExecution(id, { enabled, expectedVersion: campaign.data.version, reason: reason.trim() || undefined });
    },
    onSuccess: async () => {
      setReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['relationship-campaign', id] }),
        queryClient.invalidateQueries({ queryKey: ['relationship-delivery-readiness', id] }),
        queryClient.invalidateQueries({ queryKey: ['relationship-enrollments', id] }),
      ]);
    },
  });

  const state = readiness.data;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="mb-2 flex gap-2"><Badge variant="outline">Pass 12</Badge><Badge variant={state?.ready ? 'default' : 'secondary'}>{state?.ready ? 'Provider ready' : 'Activation blocked'}</Badge></div><h1 className="text-3xl font-bold tracking-tight">Campaign delivery control</h1><p className="mt-2 max-w-3xl text-muted-foreground">This is the only operator path that can enable relationship campaign execution. Direct database writes cannot cross the activation boundary.</p></div><div className="flex gap-2"><Button asChild variant="outline"><Link to={`/crm/business-development/campaigns/${id}/enrollments`}>Enrollments</Link></Button><Button asChild variant="outline"><Link to={`/crm/business-development/campaigns/${id}`}>Definition</Link></Button></div></div>
    <RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} />
    {campaign.data && <Card><CardHeader><CardTitle>{campaign.data.name}</CardTitle><CardDescription>{campaign.data.purpose}</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2"><Badge variant="outline">Definition {campaign.data.status}</Badge><Badge variant={campaign.data.executionEnabled ? 'default' : 'secondary'}>Execution {campaign.data.executionEnabled ? 'enabled' : 'disabled'}</Badge><Badge variant="outline">Version {campaign.data.version}</Badge></CardContent></Card>}
    {state && <Card><CardHeader><CardTitle>Provider readiness</CardTitle><CardDescription>Every proof below is evaluated by Billing Hub at activation time and again before each work claim and delivery preparation.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"><Fact label="Provider" value={`${state.provider} · ${state.providerStatus}`} /><Fact label="Verified sender" value={state.senderEmail ?? 'Unavailable'} /><Fact label="Inbound address" value={state.inboundAddress ?? 'Unavailable'} /><Fact label="Last verified" value={state.lastVerifiedAt ? new Date(state.lastVerifiedAt).toLocaleString() : 'Unavailable'} /></div>{state.reasons.length > 0 ? <div className="rounded border border-amber-500/40 bg-amber-50/40 p-4 dark:bg-amber-950/10"><p className="font-medium">Activation requirements still open</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{state.reasons.map((item) => <li key={item}>{reasonLabels[item] ?? item.replace(/_/g, ' ')}</li>)}</ul></div> : <p className="text-sm text-muted-foreground">Sender, inbound routing, webhook signature, worker, postal address, campaign state, and active steps are verified.</p>}</CardContent></Card>}
    {campaign.data && state && <Card><CardHeader><CardTitle>Controlled activation</CardTitle><CardDescription>Enabling execution also enables delivery only for current pending or active enrollments whose safety status is ready. Disabling immediately closes both gates.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="space-y-2"><Label htmlFor="delivery-reason">Activation reason</Label><Input id="delivery-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is execution being enabled or disabled?" /></div><div className="flex flex-wrap gap-2"><Button disabled={execution.isPending || campaign.data.executionEnabled || !state.ready} onClick={() => execution.mutate(true)}>{execution.isPending ? 'Applying…' : 'Enable controlled delivery'}</Button><Button variant="destructive" disabled={execution.isPending || !campaign.data.executionEnabled} onClick={() => execution.mutate(false)}>Disable delivery</Button></div>{execution.isError && <p className="text-sm text-destructive">{execution.error instanceof Error ? execution.error.message : 'Execution state could not be changed.'}</p>}</CardContent></Card>}
  </div>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="rounded border p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm">{value}</p></div>; }
