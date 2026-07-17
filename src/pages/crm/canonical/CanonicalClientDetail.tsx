import { useParams, Link } from 'react-router-dom';
import { useCanonicalClient, useClientMutations } from '@/hooks/canonical/useCanonicalClients';
import { useClientAudit, useClientCommunications } from '@/hooks/canonical/useCrmData';
import { useTasks } from '@/hooks/canonical/useCrmData';
import { displayName, ENGAGEMENT_STATES, ELIGIBILITY_STATES, CONTACT_POLICIES, SERVICE_POLICIES, CARE_CADENCES, type EngagementState, type EligibilityState, type ContactPolicy, type ServicePolicy, type CareCadence } from '@/domain/canonical';
import { LifecycleBadge, EngagementBadge, EligibilityBadge, ContactPolicyBadge, ServicePolicyBadge, AtRiskBadge } from '@/components/crm/canonical/StateBadges';
import { LifecycleControl } from '@/components/crm/canonical/LifecycleControl';
import { CloseClientDialog } from '@/components/crm/canonical/CloseClientDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

export default function CanonicalClientDetail() {
  const { id = '' } = useParams();
  const { data: client, isLoading } = useCanonicalClient(id);
  const m = useClientMutations(id);
  const audit = useClientAudit(id);
  const comms = useClientCommunications(id);
  const tasks = useTasks({ clientId: id });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!client) return <div className="p-6">Client not found.</div>;

  return (
    <div className="space-y-4 p-6">
      <Link to="/crm/canonical/clients" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Clients
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{displayName(client)}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <LifecycleBadge v={client.lifecycle} />
            <EngagementBadge v={client.engagement} />
            <EligibilityBadge v={client.eligibility} />
            <ContactPolicyBadge v={client.contactPolicy} />
            <ServicePolicyBadge v={client.servicePolicy} />
            <AtRiskBadge r={client.risk} />
          </div>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div>{client.email ?? '—'}</div>
          <div>{client.phone ?? '—'}</div>
          <div>{client.state ?? '—'} · {client.payer ?? '—'}</div>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="journey">Journey</TabsTrigger>
          <TabsTrigger value="communications">Communications</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="eligibility">Eligibility</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Canonical State</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground w-32">Lifecycle</span>
                  <div className="flex-1"><LifecycleControl clientId={id} currentStage={client.lifecycle} /></div>
                </div>
                <StateRow label="Engagement" value={client.engagement} options={ENGAGEMENT_STATES}
                  onChange={v => m.updateEngagement.mutate(v as EngagementState, { onSuccess: () => toast.success('Engagement updated') })} />
                <StateRow label="Eligibility" value={client.eligibility} options={ELIGIBILITY_STATES}
                  onChange={v => m.updateEligibility.mutate({ next: v as EligibilityState }, { onSuccess: () => toast.success('Eligibility updated') })} />
                <StateRow label="Contact Policy" value={client.contactPolicy} options={CONTACT_POLICIES}
                  onChange={v => m.updateContactPolicy.mutate({ next: v as ContactPolicy, reason: 'manual' }, { onSuccess: () => toast.success('Contact policy updated') })} />
                <StateRow label="Service Policy" value={client.servicePolicy} options={SERVICE_POLICIES}
                  onChange={v => m.updateServicePolicy.mutate({ next: v as ServicePolicy, reason: 'manual' }, { onSuccess: () => toast.success('Service policy updated') })} />
                <StateRow label="Care Cadence" value={client.careCadence} options={CARE_CADENCES}
                  onChange={v => m.updateCareCadence.mutate(v as CareCadence, { onSuccess: () => toast.success('Cadence updated') })} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Activity</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Info label="Last contact" value={client.lastContactAt ? `${new Date(client.lastContactAt).toLocaleString()} (${client.lastContactChannel}, ${client.lastContactDirection})` : '—'} />
                <Info label="Next appointment" value={client.nextAppointmentAt ? new Date(client.nextAppointmentAt).toLocaleString() : '—'} />
                <Info label="Next required action" value={client.nextRequiredAction ?? '—'} />
                <Info label="Open tasks" value={String(client.openTaskCount)} />
                <Info label="Active campaign" value={client.activeCampaignId ?? '—'} />
                <Info label="Tags" value={client.tags.join(', ') || '—'} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="journey">
          <Card><CardContent className="p-4 text-sm space-y-2">
            <div className="text-muted-foreground">Lifecycle journey (from audit)</div>
            {audit.data?.filter(a => a.eventType === 'lifecycle_updated').length ? (
              <ol className="space-y-1">
                {audit.data?.filter(a => a.eventType === 'lifecycle_updated').map(a => (
                  <li key={a.id} className="text-sm">
                    <span className="text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
                    {' — '}<span className="font-medium">{a.previousValue}</span> → <span className="font-medium">{a.newValue}</span>
                    {a.reason && <span className="text-muted-foreground"> · {a.reason}</span>}
                  </li>
                ))}
              </ol>
            ) : <div className="text-sm text-muted-foreground">No lifecycle transitions yet.</div>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="communications">
          <Card><CardContent className="p-0">
            <div className="divide-y">
              {comms.data?.length ? comms.data.map(msg => (
                <div key={msg.id} className="p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium uppercase text-xs">{msg.channel} · {msg.direction}</span>
                    <span className="text-xs text-muted-foreground">{new Date(msg.createdAt).toLocaleString()}</span>
                  </div>
                  {msg.subject && <div className="mt-1 font-medium">{msg.subject}</div>}
                  <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{msg.body}</div>
                  {msg.status === 'suppressed' && <div className="mt-1 text-xs text-red-600">Suppressed: {msg.suppressionReason}</div>}
                </div>
              )) : <div className="p-6 text-center text-sm text-muted-foreground">No communications.</div>}
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="tasks">
          <Card><CardContent className="p-0">
            <div className="divide-y">
              {tasks.data?.length ? tasks.data.map(t => (
                <div key={t.id} className="flex items-center justify-between p-3 text-sm">
                  <div>
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-muted-foreground">{t.type} · {t.priority} · {t.status}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">{t.dueAt ? new Date(t.dueAt).toLocaleDateString() : '—'}</div>
                </div>
              )) : <div className="p-6 text-center text-sm text-muted-foreground">No tasks.</div>}
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="campaigns">
          <Card><CardContent className="p-4 text-sm">
            {client.activeCampaignId ? <>Active campaign: <span className="font-medium">{client.activeCampaignId}</span></> : 'No active campaign enrollment.'}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="eligibility">
          <Card><CardContent className="p-4 text-sm space-y-1">
            <Info label="State" value={client.eligibility} />
            <Info label="Payer" value={client.payer ?? '—'} />
            <Info label="Program" value={client.program ?? '—'} />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card><CardContent className="p-0">
            <div className="divide-y">
              {audit.data?.length ? audit.data.map(a => (
                <div key={a.id} className="p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{a.eventType}</span>
                    <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {a.previousValue ?? '∅'} → {a.newValue ?? '∅'} · {a.actor.label} · {a.source}
                  </div>
                  {a.reason && <div className="text-xs text-muted-foreground">Reason: {a.reason}</div>}
                </div>
              )) : <div className="p-6 text-center text-sm text-muted-foreground">No audit events.</div>}
            </div>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StateRow({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground w-32">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>;
}
