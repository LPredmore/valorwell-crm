import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';

type QueueStatus = 'awaiting_approval' | 'manual_review' | 'needs_action' | 'waiting_external';
type QueueRow = {
  id: string;
  organizationId: string;
  organizationName: string;
  pipelineStatus: string;
  attentionStatus: QueueStatus;
  attentionNote: string | null;
  nextAction: string | null;
  dueAt: string | null;
  ownerId: string | null;
  openTaskCount: number;
  unresolvedIssueCount: number;
};
type QueueSummary = {
  opportunities: number;
  awaitingApproval: number;
  manualReview: number;
  needsAction: number;
  waitingExternal: number;
  clear: number;
  notAssessed: number;
  standaloneOrganizationActions: number;
  organizationsWithoutOpportunities: number;
};
type OrganizationWork = {
  organizationId: string;
  organizationName: string;
  attentionStatus: 'needs_action' | 'manual_review';
  nextAction: string | null;
  dueAt: string | null;
  unassociatedIssues: number;
};
type QueueResult = { summary: QueueSummary; items: QueueRow[]; organizationItems: OrganizationWork[] };
const labels: Record<QueueStatus, string> = {
  awaiting_approval: 'Awaiting approval',
  manual_review: 'Manual review',
  needs_action: 'Needs action',
  waiting_external: 'Waiting on external',
};
const rpcClient = supabase as unknown as {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown; error: { message: string } | null;
  }>;
};
function centralDue(value: string | null) {
  return value ? new Date(value).toLocaleString('en-US', {
    timeZone: 'America/Chicago', timeZoneName: 'short',
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }) : 'No due date';
}

export function RelationshipAttentionQueuePanel() {
  const { isAuthenticated, currentTenantId, userId, crmRole } = useCrmAuth();
  const queue = useQuery({
    queryKey: ['relationship-attention-queue', currentTenantId, userId, crmRole],
    queryFn: async (): Promise<QueueResult> => {
      const { data, error } = await rpcClient.rpc('list_relationship_attention_queue', { p_limit: 40 });
      if (error) throw new Error(error.message);
      if (!data || typeof data !== 'object') throw new Error('Relationship attention queue unavailable.');
      return data as QueueResult;
    },
    enabled: Boolean(isAuthenticated && currentTenantId),
    retry: false,
  });
  const summary = queue.data?.summary;
  return <Card>
    <CardHeader>
      <CardTitle>Relationships needing attention</CardTitle>
      <CardDescription>
        Prioritized work across the entire relationship—not one task per email.
        Only a verified operator decision can mark an opportunity clear.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {queue.isLoading && <p className="text-sm text-muted-foreground">Loading relationship attention…</p>}
      {queue.isError && <p role="alert" className="text-sm text-destructive">
        {queue.error instanceof Error ? queue.error.message : 'Relationship attention unavailable.'}
      </p>}
      {summary && <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{summary.awaitingApproval} await approval</Badge>
        <Badge variant="outline">{summary.manualReview} manual review</Badge>
        <Badge variant="outline">{summary.needsAction} need action</Badge>
        <Badge variant="outline">{summary.waitingExternal} waiting</Badge>
        <Badge variant="secondary">{summary.clear} clear</Badge>
        <Badge variant="outline">{summary.notAssessed} not assessed</Badge>
        <Badge variant="outline">{summary.standaloneOrganizationActions} organization-level follow-ups</Badge>
        <Badge variant="outline">{summary.organizationsWithoutOpportunities} organizations without opportunities</Badge>
      </div>}
      {queue.data?.items.map(item => <div key={item.id} className="space-y-1 rounded border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/crm/business-development/opportunities/${item.id}`}
              className="font-medium text-primary hover:underline">{item.organizationName}</Link>
            <span className="text-xs text-muted-foreground">{item.pipelineStatus.replace(/_/g,' ')}</span>
          </div>
          <Badge variant="outline">{labels[item.attentionStatus]}</Badge>
        </div>
        {item.nextAction && <p className="text-sm">{item.nextAction}</p>}
        {item.attentionNote && <p className="text-xs text-muted-foreground">Review decision: {item.attentionNote}</p>}
        <p className="text-xs text-muted-foreground">
          Due: {centralDue(item.dueAt)} · {item.openTaskCount} open opportunity tasks
          {' '}· {item.unresolvedIssueCount} unresolved associations
        </p>
      </div>)}
      {(queue.data?.organizationItems?.length ?? 0) > 0 && <div className="space-y-2 border-t pt-3">
        <p className="font-medium">Organization-wide follow-ups not owned by an opportunity</p>
        <p className="text-xs text-muted-foreground">Includes organizations without a BTY opportunity and independent relationship obligations.</p>
        {queue.data?.organizationItems.map(item => <div key={item.organizationId} className="space-y-1 rounded border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link className="font-medium text-primary hover:underline"
              to={`/crm/business-development/organizations/${item.organizationId}`}>{item.organizationName}</Link>
            <Badge variant="outline">{labels[item.attentionStatus]}</Badge>
          </div>
          {item.nextAction && <p className="text-sm">{item.nextAction}</p>}
          <p className="text-xs text-muted-foreground">Due: {centralDue(item.dueAt)}
            {' '}· {item.unassociatedIssues} unresolved organization-only email associations
          </p>
        </div>)}
      </div>}
      {queue.isSuccess && queue.data.items.length === 0 &&
        <p className="text-sm text-muted-foreground">No action-ready relationships. Unassessed opportunities still need evaluation.</p>}
      {queue.isSuccess && queue.data.items.length === 40 &&
        <p className="text-xs text-muted-foreground">Showing the 40 highest-priority opportunities. Other opportunities remain available in the directory.</p>}
      <Button size="sm" variant="outline" disabled={queue.isFetching}
        onClick={() => void queue.refetch()}>Refresh attention queue</Button>
    </CardContent>
  </Card>;
}
