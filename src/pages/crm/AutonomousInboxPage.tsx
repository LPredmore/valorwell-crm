import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, Inbox, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { AutonomousInboxActions } from '@/components/crm/AutonomousInboxActions';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type AgentCase = {
  id: string;
  source: 'gmail_crm' | 'ringcentral_crm';
  sourceRecordId: string;
  reason: string;
  state: 'pending_review' | 'resolved' | 'ignored';
  detectedAt: string;
  taskId: string | null;
  taskStatus: string | null;
  observedEvents: number;
  proposedActions: number;
};
type QueueResult = { cases: AgentCase[]; openCount: number };
type DecisionResult = { id: string; status: string; idempotent: boolean };

// New RPCs are additive to the canonical CRM schema. Do not replace generated types by hand.
const inboxRpc = supabase as unknown as {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

async function loadAgentCases(tenantId: string): Promise<QueueResult> {
  const { data, error } = await inboxRpc.rpc('crm_autonomous_inbox_queue_v1', {
    p_tenant_id: tenantId, p_limit: 100,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || !Array.isArray((data as QueueResult).cases)) {
    throw new Error('The Autonomous Inbox did not return a valid review queue.');
  }
  return data as QueueResult;
}
async function closeCase(id: string, decision: 'resolved' | 'ignored'): Promise<DecisionResult> {
  const { data, error } = await inboxRpc.rpc('crm_autonomous_inbox_review_v1', {
    p_case_id: id, p_decision: decision, p_note: null,
  });
  if (error) throw new Error(error.message);
  return data as DecisionResult;
}

const title = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
function centralDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Chicago', timeZoneName: 'short',
  }).format(new Date(value));
}

export default function AutonomousInboxPage() {
  const { currentTenantId, isAuthenticated, capabilities } = useCrmAuth();
  const [showClosed, setShowClosed] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ['crm-autonomous-inbox', currentTenantId];
  const inbox = useQuery({
    queryKey,
    enabled: isAuthenticated && Boolean(currentTenantId),
    queryFn: () => loadAgentCases(currentTenantId!),
    refetchInterval: 60_000,
    retry: false,
  });
  const review = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'resolved' | 'ignored' }) => closeCase(id, decision),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey }); },
  });
  const cases = (inbox.data?.cases ?? []).filter(item => showClosed || item.state === 'pending_review');
  return <div className="space-y-6 p-4 md:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Inbox className="h-6 w-6" aria-hidden="true" /> Autonomous Inbox
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          CRM-backed review cases from Gmail and ValorWell business SMS. Messages remain in their
          authorized CRM records. This workspace does not automatically send email or SMS.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" aria-pressed={showClosed} onClick={() => setShowClosed(v => !v)}>
          {showClosed ? 'Hide closed' : 'Show closed'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void inbox.refetch()} disabled={inbox.isFetching}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Refresh
        </Button>
      </div>
    </header>
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" /> Review queue
          {inbox.data && <Badge variant="outline">{inbox.data.openCount} open</Badge>}
        </CardTitle>
        <CardDescription>
          Review actual messages in CRM before resolving a case. Closing a case also closes only
          the task created by this inbox assistant. No relationship identity is inferred or changed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isAuthenticated && <p className="text-sm text-muted-foreground">Sign in to the CRM to review inbox cases.</p>}
        {inbox.isLoading && <p className="text-sm text-muted-foreground">Loading cases…</p>}
        {inbox.isError && <p role="alert" className="text-sm text-destructive">
          {inbox.error instanceof Error ? inbox.error.message : 'Could not load the authorized inbox.'}
        </p>}
        {review.isError && <p role="alert" className="text-sm text-destructive">
          {review.error instanceof Error ? review.error.message : 'Unable to update this case.'}
        </p>}
        {!inbox.isLoading && !inbox.isError && cases.length===0 &&
          <p className="text-sm text-muted-foreground">No {showClosed ? '' : 'open '}cases to review.</p>}
        {cases.map(item => <article key={item.id} className="space-y-3 rounded-md border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{item.source === 'gmail_crm' ? 'Gmail' : 'Business SMS'}</Badge>
            <Badge variant="outline">{title(item.state)}</Badge>
            <span className="text-xs text-muted-foreground">{centralDate(item.detectedAt)}</span>
          </div>
          <div>
            <h2 className="font-medium">{title(item.reason)}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Source record {item.sourceRecordId.slice(0,8)} · Evidence events {item.observedEvents}
              {item.proposedActions>0 && <> · Proposed actions {item.proposedActions}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to={item.source==='gmail_crm' ? '/crm/business-development/replies' : '/crm/recruitment/applicants'}>
                Review source in CRM
              </Link>
            </Button>
            {item.taskId && <Button size="sm" variant="outline" asChild>
              <Link to="/crm/tasks">View assigned task</Link>
            </Button>}
            {item.state==='pending_review' && capabilities.mutate && <>
              <Button size="sm" onClick={() => review.mutate({id:item.id,decision:'resolved'})} disabled={review.isPending}>
                <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" /> Mark reviewed
              </Button>
              <Button size="sm" variant="ghost" onClick={() => review.mutate({id:item.id,decision:'ignored'})} disabled={review.isPending}>
                <XCircle className="mr-1 h-4 w-4" aria-hidden="true" /> Ignore
              </Button>
            </>}
          </div>
          <AutonomousInboxActions caseId={item.id} canEdit={capabilities.mutate && item.state==='pending_review'} />
        </article>)}
      </CardContent>
    </Card>
  </div>;
}
