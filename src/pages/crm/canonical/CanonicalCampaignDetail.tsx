import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pause, Play, XCircle, RotateCcw } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCampaign, useEnrollments } from '@/hooks/canonical/useCrmData';
import { useCanonicalClients } from '@/hooks/canonical/useCanonicalClients';
import { dataProvider } from '@/services/dataProvider';

export default function CanonicalCampaignDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: campaign, isLoading } = useCampaign(id);
  const { data: enrollments = [] } = useEnrollments(id);
  const { data: clientsPage } = useCanonicalClients({ pageSize: 500 });
  const clientMap = new Map((clientsPage?.rows ?? []).map((c) => [c.id, c] as const));

  const invalidate = () => qc.invalidateQueries({ queryKey: ['crm-enrollments', id] });
  const promptReason = (verb: string) => {
    const r = window.prompt(`Reason to ${verb} this enrollment (min 3 chars):`, '');
    return r && r.trim().length >= 3 ? r.trim() : null;
  };
  const pause = useMutation({ mutationFn: ({ eid, reason }: { eid: string; reason: string }) => dataProvider.campaigns.pauseEnrollment(eid, reason), onSuccess: invalidate });
  const resume = useMutation({ mutationFn: ({ eid, reason }: { eid: string; reason: string }) => dataProvider.campaigns.resumeEnrollment(eid, reason), onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: ({ eid, reason }: { eid: string; reason: string }) => dataProvider.campaigns.cancelEnrollment(eid, reason), onSuccess: invalidate });
  const restart = useMutation({ mutationFn: ({ eid, reason }: { eid: string; reason: string }) => dataProvider.campaigns.restartEnrollment(eid, reason), onSuccess: invalidate });

  const [tab, setTab] = useState<'steps' | 'enrollments'>('enrollments');

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!campaign) return <div className="p-6">Campaign not found. <Link to="/crm/canonical/campaigns" className="underline">Back</Link></div>;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/crm/canonical/campaigns')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
          <p className="text-sm text-muted-foreground">{campaign.description}</p>
        </div>
        <Badge variant={campaign.status === 'Active' ? 'default' : 'outline'}>{campaign.status}</Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-6">
        {[
          ['Enrolled', campaign.metrics.enrolled],
          ['Active', campaign.metrics.active],
          ['Completed', campaign.metrics.completed],
          ['Response rate', `${Math.round(campaign.metrics.responseRate * 100)}%`],
          ['Suppressed', campaign.metrics.suppressed],
          ['Failed', campaign.metrics.failed],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-1 border-b">
        <button className={`px-3 py-2 text-sm ${tab === 'enrollments' ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`} onClick={() => setTab('enrollments')}>Enrollments ({enrollments.length})</button>
        <button className={`px-3 py-2 text-sm ${tab === 'steps' ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`} onClick={() => setTab('steps')}>Steps ({campaign.steps.length})</button>
      </div>

      {tab === 'enrollments' && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Next action</TableHead>
                <TableHead>Exit reason</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enrollments.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No enrollments.</TableCell></TableRow>
              )}
              {enrollments.map((e) => {
                const c = clientMap.get(e.clientId);
                return (
                  <TableRow key={e.id}>
                    <TableCell>
                      {c ? (
                        <Link to={`/crm/canonical/clients/${c.id}`} className="font-medium hover:underline">
                          {c.preferredName || `${c.legalFirstName} ${c.legalLastName}`}
                        </Link>
                      ) : e.clientId}
                    </TableCell>
                    <TableCell><Badge variant={e.status === 'Active' ? 'default' : 'outline'}>{e.status}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(e.startedAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.nextActionAt ? new Date(e.nextActionAt).toLocaleString() : '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.exitReason ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        {e.status === 'Active' && (
                          <Button size="sm" variant="ghost" onClick={() => pause.mutate(e.id)} title="Pause"><Pause className="h-4 w-4" /></Button>
                        )}
                        {e.status === 'Paused' && (
                          <Button size="sm" variant="ghost" onClick={() => resume.mutate(e.id)} title="Resume"><Play className="h-4 w-4" /></Button>
                        )}
                        {(e.status === 'Active' || e.status === 'Paused') && (
                          <Button size="sm" variant="ghost" onClick={() => cancel.mutate(e.id)} title="Cancel"><XCircle className="h-4 w-4" /></Button>
                        )}
                        {(e.status === 'Canceled' || e.status === 'Completed' || e.status === 'Failed') && (
                          <Button size="sm" variant="ghost" onClick={() => restart.mutate(e.id)} title="Restart"><RotateCcw className="h-4 w-4" /></Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {tab === 'steps' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Program steps</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {campaign.steps.length === 0 && <div className="text-sm text-muted-foreground">No steps defined.</div>}
            {campaign.steps.map((s) => (
              <div key={s.id} className="flex items-start gap-3 rounded-md border p-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">{s.order}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{s.type}</Badge>
                    <span className="font-medium text-sm">{s.label}</span>
                    {s.delayHours !== undefined && <span className="text-xs text-muted-foreground">after {s.delayHours}h</span>}
                    {s.stopOnReply && <Badge variant="secondary" className="text-xs">stop on reply</Badge>}
                  </div>
                  {s.subject && <div className="mt-1 text-sm font-medium">{s.subject}</div>}
                  {s.body && <div className="mt-1 text-sm text-muted-foreground line-clamp-2">{s.body}</div>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
