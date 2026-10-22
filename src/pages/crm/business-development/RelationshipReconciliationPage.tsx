import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { relationshipTasksRepository } from '@/repositories/supabase/relationship-tasks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  reconciliationErrorMessage,
  type ReconciliationProposal,
} from '@/domain/relationships/activation-gating';
import {
  applyBtyReconciliation,
  getRelationshipIntegrity,
  previewBtyReconciliation,
} from '@/lib/crm/relationship-orchestration';


type EmailReviewGroup = {
  groupKey: string;
  organizationId: string | null;
  organizationName: string | null;
  issueCount: number;
  reviewTaskId: string | null;
  ownerProfileId: string | null;
  ownerReviewRequired: boolean;
  candidateOpportunityCount: number;
  classifications: string[];
};
type EmailReviewQueueResult = {
  summary: { openIssues?: number; candidateOpportunities?: number; existingCommunications?: number; awaitingReview?: number; unownedGroups?: number };
  groups: EmailReviewGroup[];
};
// The queue RPCs are additive to the deployed database and may precede
// regeneration of typed Supabase definitions.
const queueRpc = supabase as unknown as {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};
async function loadEmailReviewQueue(): Promise<EmailReviewQueueResult> {
  const { data, error } = await queueRpc.rpc('list_relationship_email_review_queue', { p_limit: 100 });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object') throw new Error('Review queue did not return valid data.');
  return data as EmailReviewQueueResult;
}

type ReviewIssue = {
  issueId: string;
  source: string;
  classification: string;
  sender: string;
  subject: string;
  candidateContactId: string | null;
  candidateOpportunityId: string | null;
  existingCommunicationId: string | null;
  issueCreatedAt: string;
  providerMessageId: string;
};
function EmailReviewGroupEvidence({ groupKey }: { groupKey: string }) {
  const queryClient = useQueryClient();
  const { capabilities } = useCrmAuth();
  const approve = useMutation({
    mutationFn: async (issue: ReviewIssue) => {
      if (!issue.candidateOpportunityId || issue.classification !== 'unique_sender_opportunity_candidate') {
        throw new Error('An exact single-opportunity candidate is required.');
      }
      const { error } = await queueRpc.rpc('approve_relationship_email_issue', {
        p_issue_id: issue.issueId, p_opportunity_id: issue.candidateOpportunityId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['relationship-email-review-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['relationship-email-review-group-issues', groupKey] }),
      ]);
    },
  });
  const issues = useQuery({
    queryKey: ['relationship-email-review-group-issues', groupKey],
    queryFn: async (): Promise<ReviewIssue[]> => {
      const { data, error } = await queueRpc.rpc('list_relationship_email_review_group_issues', {
        p_group_key: groupKey,
        p_limit: 75,
      });
      if (error) throw new Error(error.message);
      if (!Array.isArray(data)) throw new Error('No verified message list was returned.');
      return data as ReviewIssue[];
    },
    retry: false,
  });
  return <div className="w-full space-y-2 rounded bg-muted/30 p-3">
    <p className="text-xs text-muted-foreground">Read-only source evidence. No message body is exposed and no stage is changed.</p>
    {issues.isLoading && <p className="text-sm">Loading source evidence…</p>}
    {issues.isError && <p className="text-sm text-destructive">{issues.error instanceof Error ? issues.error.message : 'Evidence unavailable'}</p>}
    {issues.data?.map(item => <div className="space-y-1 border-b pb-2 text-sm" key={item.issueId}>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{item.source}</Badge>
        <span className="font-medium">{item.subject || '(No subject recorded)'}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {item.sender || 'Sender not stored'} · {item.classification.replace(/_/g, ' ')}
      </p>
      <div className="flex gap-3 text-xs">
        {item.candidateOpportunityId && <Link className="text-primary hover:underline"
          to={`/crm/business-development/opportunities/${item.candidateOpportunityId}`}>Candidate opportunity</Link>}
        {capabilities.mutate && item.candidateOpportunityId && item.classification === 'unique_sender_opportunity_candidate' &&
          <Button size="sm" variant="outline" disabled={approve.isPending}
            onClick={() => approve.mutate(item)}>Approve exact association</Button>}
        {item.existingCommunicationId && <span>Stored communication link</span>}
        <span>Issue {item.issueId.slice(0, 8)}</span>
      </div>
    </div>)}
    {approve.isError && <p role="alert" className="text-xs text-destructive">{approve.error instanceof Error ? approve.error.message : 'Approval failed'}</p>}
    {issues.data?.length === 75 && <p className="text-xs text-muted-foreground">Showing the first 75 issues for this group.</p>}
  </div>;
}

function EmailReconciliationQueue() {
  const { currentTenantId, isAuthenticated, capabilities, userId } = useCrmAuth();
  const queryClient = useQueryClient();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const key = ['relationship-email-review-queue', currentTenantId];
  const queue = useQuery({
    queryKey: key,
    queryFn: loadEmailReviewQueue,
    enabled: isAuthenticated && Boolean(currentTenantId),
    retry: false,
  });
  const cleanupPreview = useQuery({
    queryKey: ['relationship-email-review-task-cleanup', currentTenantId],
    queryFn: async (): Promise<{ eligible: number; blocked: number }> => {
      const { data, error } = await queueRpc.rpc('process_relationship_email_review_task_cleanup', {
        p_apply: false, p_limit: 100,
      });
      if (error) throw new Error(error.message);
      if (!data || typeof data !== 'object') throw new Error('Historical review cleanup preview unavailable.');
      const result = data as { eligible?: number; blocked?: number };
      return { eligible: result.eligible ?? 0, blocked: result.blocked ?? 0 };
    },
    enabled: isAuthenticated && Boolean(currentTenantId) && capabilities.mutate,
    retry: false,
  });
  const finishCompleted = useMutation({
    mutationFn: async () => {
      if (!currentTenantId || !capabilities.mutate) throw new Error('CRM task editing permission is required.');
      const { data, error } = await queueRpc.rpc('process_relationship_email_review_task_cleanup', {
        p_apply: true, p_limit: 100,
      });
      if (error) throw new Error(error.message);
      if (!data || typeof data !== 'object') throw new Error('Historical review completion was not confirmed.');
      return data as { completed: number };
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['relationship-email-review-task-cleanup', currentTenantId] }),
        queryClient.invalidateQueries({ queryKey: ['relationship-email-review-queue', currentTenantId] }),
        queryClient.invalidateQueries({ queryKey: ['crm-tasks'] }),
      ]);
    },
  });
  const [bulkProcessed, setBulkProcessed] = useState(0);
  const createReviewTask = async (group: EmailReviewGroup): Promise<string> => {
    if (!group.organizationId) throw new Error('Unlinked messages require manual identity review first.');
    if (!currentTenantId || !capabilities.mutate) throw new Error('CRM operator permission required.');
    const taskId = await relationshipTasksRepository.create(
      { organizationId: group.organizationId },
      {
        title: 'Review BTY email associations · ' + (group.organizationName ?? 'Organization'),
        description: 'Reconcile ' + group.issueCount + ' unresolved email evidence items against the existing CRM conversation and opportunity. No automatic email sending or stage transition is authorized.',
        priority: 'High',
        ownerId: group.ownerProfileId ?? userId,
      },
      { tenantId: currentTenantId, userId },
    );
    const { error } = await queueRpc.rpc('link_relationship_email_review_task', {
      p_group_key: group.groupKey,
      p_task_id: taskId,
    });
    if (error) throw new Error('Review task was created but could not be connected to the issue group: ' + error.message);
    return taskId;
  };
  const refreshTasks = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ['crm-tasks'] }),
    ]);
  };
  const create = useMutation({
    mutationFn: createReviewTask,
    onSuccess: refreshTasks,
  });
  const bulk = useMutation({
    mutationFn: async (groups: EmailReviewGroup[]) => {
      let processed = 0;
      for (const group of groups) {
        // Keep the loop sequential to preserve the operator's browser session,
        // rate-limit provider calls and make interrupted work safe to resume.
        await createReviewTask(group);
        processed++;
        setBulkProcessed(processed);
      }
      return processed;
    },
    onSettled: refreshTasks,
  });
  const data = queue.data;
  const pendingOrganizations = (data?.groups ?? []).filter(group => group.organizationId && !group.reviewTaskId);
  return <Card>
    <CardHeader>
      <CardTitle>Historical email reconciliation</CardTitle>
      <CardDescription>Message scanning is complete. Proposed associations are evidence for review, not confirmed opportunity changes. This queue is non-clinical and never sends email automatically.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {capabilities.mutate && cleanupPreview.data && cleanupPreview.data.eligible > 0 &&
        <div className="space-y-2 rounded border p-3">
          <p className="text-sm text-muted-foreground">
            {cleanupPreview.data.eligible} historical review tasks have no unresolved issues.
            {cleanupPreview.data.blocked > 0 ? ` ${cleanupPreview.data.blocked} task groups still need source verification.` : ''}
            Completing finished tasks does not approve any email, reconstruct a reply anchor, or change an opportunity.
          </p>
          <Button size="sm" variant="outline" disabled={finishCompleted.isPending}
            onClick={() => finishCompleted.mutate()}>
            {finishCompleted.isPending ? 'Completing reviewed tasks…' : `Complete ${cleanupPreview.data.eligible} finished review tasks`}
          </Button>
        </div>}
      {finishCompleted.isSuccess && <p className="text-sm text-muted-foreground">
        {finishCompleted.data.completed} finished review tasks completed. Source-blocked tasks remain open.
      </p>}
      {finishCompleted.isError && <p role="alert" className="text-sm text-destructive">
        {finishCompleted.error instanceof Error ? finishCompleted.error.message : 'Historical review cleanup failed.'}
      </p>}
      {cleanupPreview.isError && capabilities.mutate && <p className="text-xs text-muted-foreground">
        Historical review task completion is not available: {cleanupPreview.error instanceof Error ? cleanupPreview.error.message : 'Unable to load preview.'}
      </p>}
      {queue.isLoading && <p className="text-sm text-muted-foreground">Loading reconciliation evidence…</p>}
      {queue.isError && <p role="alert" className="text-sm text-destructive">{queue.error instanceof Error ? queue.error.message : 'Review queue unavailable'}</p>}
      {data && <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{data.summary.openIssues ?? 0} unresolved email issues</Badge>
        <Badge variant="secondary">{data.summary.candidateOpportunities ?? 0} opportunity candidates</Badge>
        <Badge variant="outline">{data.summary.existingCommunications ?? 0} stored communication links</Badge>
        <Badge variant={data.summary.unownedGroups ? 'destructive' : 'secondary'}>{data.summary.unownedGroups ?? 0} groups requiring owner review</Badge>
      </div>}
      {create.isError && <p role="alert" className="text-sm text-destructive">{create.error instanceof Error ? create.error.message : 'Task creation failed.'}</p>}
      {capabilities.mutate && pendingOrganizations.length > 0 && <div className="space-y-2 rounded border p-3">
        <p className="text-sm text-muted-foreground">Creating tasks is an internal, review-only action. It does not approve candidate links, change opportunity stages, or send email.</p>
        <Button size="sm" variant="outline" disabled={bulk.isPending || create.isPending}
          onClick={() => { setBulkProcessed(0); bulk.mutate(pendingOrganizations); }}>
          {bulk.isPending ? 'Creating review tasks…' : `Create review tasks for ${pendingOrganizations.length} organizations`}
        </Button>
        {bulk.isPending && <p className="text-xs text-muted-foreground">{bulkProcessed} of {pendingOrganizations.length} linked</p>}
        {bulk.isError && <p role="alert" className="text-sm text-destructive">
          Some tasks may already have been created. Refresh and retry only unlinked groups. {bulk.error instanceof Error ? bulk.error.message : ''}
        </p>}
      </div>}

      {data?.groups.map(group => <div key={group.groupKey} className="flex flex-wrap items-start justify-between gap-3 rounded border p-3">
        <div className="space-y-1">
          {group.organizationId ?
            <Link className="font-medium text-primary hover:underline" to={`/crm/business-development/organizations/${group.organizationId}`}>{group.organizationName ?? 'Open organization'}</Link> :
            <p className="font-medium">Unlinked messages: {group.classifications.join(', ').replace(/_/g, ' ')}</p>}
          <p className="text-sm text-muted-foreground">
            {group.issueCount} unresolved messages · {group.candidateOpportunityCount} candidate opportunities
          </p>
          <p className="text-xs text-muted-foreground">Evidence types: {group.classifications.join(', ').replace(/_/g, ' ')}</p>
          {group.ownerReviewRequired ? <Badge variant="destructive">Owner review required</Badge> : <Badge variant="secondary">Owner assigned</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline"
            onClick={() => setExpandedGroup(expandedGroup === group.groupKey ? null : group.groupKey)}>
            {expandedGroup === group.groupKey ? 'Hide evidence' : 'View evidence'}
          </Button>
          {group.reviewTaskId ? <Badge variant="secondary">CRM task linked</Badge> :
            group.organizationId && capabilities.mutate ?
              <Button size="sm" variant="outline" disabled={create.isPending || bulk.isPending}
                onClick={() => create.mutate(group)}>Create review task</Button> :
              <Badge variant="outline">Manual review</Badge>}
        </div>
        {expandedGroup === group.groupKey && <EmailReviewGroupEvidence groupKey={group.groupKey} />}
      </div>)}
      {data && data.groups.length === 0 && <p className="text-sm text-muted-foreground">No open email reconciliation cases.</p>}
      <Button size="sm" variant="outline" disabled={queue.isFetching} onClick={() => void queue.refetch()}>Refresh review queue</Button>
    </CardContent>
  </Card>;
}

export default function RelationshipReconciliationPage() {
  const [proposals, setProposals] = useState<ReconciliationProposal[] | null>(null);
  const integrity = useQuery({ queryKey: ['relationship-orchestration-integrity'], queryFn: getRelationshipIntegrity, retry: false });
  const writesEnabled = Boolean(integrity.data?.flags?.relationship_reconciliation_writes_enabled);

  const dryRun = useMutation({
    mutationFn: previewBtyReconciliation,
    onSuccess: (result) => setProposals(result ?? []),
  });
  const apply = useMutation({
    mutationFn: (items: ReconciliationProposal[]) => applyBtyReconciliation(items),
    onSuccess: () => setProposals(null),
  });

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-3xl font-bold">Legacy BTY reconciliation</h1><p className="mt-2 text-muted-foreground">Generate a dry run, review every proposal, then apply the reviewed corrections through the activity engine.</p></div>
      <Button asChild variant="outline"><Link to="/crm/business-development/orchestration">Back to orchestration</Link></Button>
    </div>

    <EmailReconciliationQueue />

    <Card><CardHeader><CardTitle>Dry run</CardTitle><CardDescription>The dry run never writes. Applying is blocked until the reconciliation-writes switch is enabled.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={dryRun.isPending} onClick={() => dryRun.mutate()}>{dryRun.isPending ? 'Generating…' : 'Generate dry run'}</Button>
        <Button disabled={!writesEnabled || apply.isPending || !proposals || proposals.length === 0} onClick={() => proposals && apply.mutate(proposals)}>{apply.isPending ? 'Applying…' : 'Apply reviewed corrections'}</Button>
        <Badge variant={writesEnabled ? 'default' : 'secondary'}>{writesEnabled ? 'Reconciliation writes enabled' : 'Reconciliation writes disabled'}</Badge>
      </div>
      {dryRun.isError && <p className="text-sm text-destructive">{dryRun.error instanceof Error ? dryRun.error.message : 'The dry run could not be generated.'}</p>}
      {apply.isError && <p className="text-sm text-destructive">{reconciliationErrorMessage(apply.error)}</p>}
      {apply.isSuccess && <p className="text-sm text-muted-foreground">Reviewed corrections were applied. Regenerate the dry run to confirm no proposals remain.</p>}
      {proposals?.length === 0 && <p className="text-sm text-muted-foreground">No legacy corrections are proposed.</p>}
      {proposals && proposals.length > 100 && <p className="text-sm text-destructive">The engine accepts at most 100 reviewed items per batch. Resolve some opportunities before applying.</p>}
    </CardContent></Card>

    {proposals?.map((proposal) => <Card key={proposal.opportunityId}><CardContent className="space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{proposal.currentStatus}</Badge>
        <span className="text-muted-foreground">→</span>
        <Badge>{proposal.proposedStatus}</Badge>
        {proposal.evidenceType && <Badge variant="secondary">{proposal.evidenceType}</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">{Object.entries(proposal.evidence ?? {}).map(([name, value]) => `${name}: ${value ? 'yes' : 'no'}`).join(' · ')}</p>
      <Link className="inline-block text-sm text-primary hover:underline" to={`/crm/business-development/opportunities/${proposal.opportunityId}`}>Open opportunity</Link>
    </CardContent></Card>)}
  </div>;
}
