import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { supabase } from '@/integrations/supabase/client';

type AttentionStatus =
  | 'needs_action' | 'awaiting_approval' | 'waiting_external'
  | 'manual_review' | 'clear';
type EffectiveAttention = AttentionStatus | 'not_assessed';
type OpportunityAttention = {
  id: string;
  pipelineStatus: string;
  effectiveAttention: EffectiveAttention;
  explicitAttention: AttentionStatus | null;
  attentionNote: string | null;
  lastAssessedAt: string | null;
  lastInboundAt: string | null;
  nextAction: string | null;
  nextActionDueAt: string | null;
  ownerId: string | null;
  openTaskCount: number;
  unresolvedIssueCount: number;
};
type AttentionOverview = {
  organizationId: string;
  summary: {
    opportunities: number; needsAction: number; awaitingApproval: number;
    manualReview: number; waitingExternal: number; clear: number;
    notAssessed: number; unassociatedIssues: number; openOrganizationTasks: number;
  };
  opportunities: OpportunityAttention[];
};
const labels: Record<EffectiveAttention, string> = {
  needs_action: 'Needs action',
  awaiting_approval: 'Awaiting approval',
  waiting_external: 'Waiting on external',
  manual_review: 'Manual review',
  clear: 'Clear',
  not_assessed: 'Not assessed',
};
const statuses: AttentionStatus[] = [
  'needs_action', 'awaiting_approval', 'waiting_external', 'manual_review', 'clear',
];
const attentionClient = supabase as unknown as {
  rpc: (functionName: string, args: Record<string, unknown>) => Promise<{
    data: unknown; error: { message: string } | null;
  }>;
};
function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}

/** An operating-tenant rollup of opportunities, NOT a second email conversation ledger. */
export function RelationshipAttentionPanel({
  organizationId, opportunityId,
}: { organizationId: string; opportunityId?: string }) {
  const { currentTenantId, userId, crmRole, isAuthenticated, capabilities } = useCrmAuth();
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<AttentionStatus | ''>('');
  const [note, setNote] = useState('');
  const key = ['relationship-attention-overview', currentTenantId, userId, crmRole, organizationId];
  const overview = useQuery({
    queryKey: key,
    queryFn: async (): Promise<AttentionOverview> => {
      const { data, error } = await attentionClient.rpc('get_relationship_attention_overview', {
        p_organization_id: organizationId,
      });
      if (error) throw new Error(error.message);
      if (!data || typeof data !== 'object') throw new Error('Relationship attention summary unavailable.');
      return data as AttentionOverview;
    },
    enabled: Boolean(isAuthenticated && currentTenantId && organizationId),
    retry: false,
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!opportunityId || !selection || note.trim().length < 8) {
        throw new Error('Select an attention status and explain the decision.');
      }
      const { error } = await attentionClient.rpc('set_relationship_opportunity_attention', {
        p_opportunity_id: opportunityId,
        p_attention_status: selection,
        p_note: note.trim(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      setSelection('');
      setNote('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: ['relationship-opportunity', currentTenantId] }),
      ]);
    },
  });
  const selected = opportunityId
    ? overview.data?.opportunities.find(item => item.id === opportunityId)
    : undefined;
  const records = opportunityId ? (selected ? [selected] : []) : overview.data?.opportunities ?? [];
  const summary = overview.data?.summary;

  return <Card>
    <CardHeader>
      <CardTitle>{opportunityId ? 'Operational attention' : 'Relationship attention overview'}</CardTitle>
      <CardDescription>
        A single relationship view across existing opportunities, tasks, inbound activity and reconciliation issues.
        Pipeline stages remain independent; no email is sent or opportunity stage advanced here.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {overview.isLoading && <p className="text-sm text-muted-foreground">Loading relationship context…</p>}
      {overview.isError && <p role="alert" className="text-sm text-destructive">
        {overview.error instanceof Error ? overview.error.message : 'Relationship overview could not be loaded.'}
      </p>}
      {summary && !opportunityId && <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{summary.needsAction} need action</Badge>
        <Badge variant="outline">{summary.awaitingApproval} await approval</Badge>
        <Badge variant="outline">{summary.manualReview} need manual review</Badge>
        <Badge variant="outline">{summary.waitingExternal} waiting</Badge>
        <Badge variant="secondary">{summary.clear} clear</Badge>
        <Badge variant="outline">{summary.notAssessed} not assessed</Badge>
        {(summary.unassociatedIssues > 0 || summary.openOrganizationTasks > 0) &&
          <p className="w-full text-sm text-muted-foreground">
            {summary.unassociatedIssues} email issues not yet tied to an opportunity ·
            {' '}{summary.openOrganizationTasks} organization-level open tasks
          </p>}
      </div>}
      {overview.isSuccess && records.length === 0 && <p className="text-sm text-muted-foreground">
        No {opportunityId ? 'matching opportunity' : 'opportunities'} found for this relationship.
      </p>}
      {records.map(item => <div className="space-y-2 rounded-md border p-3" key={item.id}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {opportunityId ? <p className="font-medium">Current opportunity</p> :
            <Link className="font-medium text-primary hover:underline"
              to={`/crm/business-development/opportunities/${item.id}`}>
              {item.pipelineStatus.replace(/_/g, ' ')}
            </Link>}
          <Badge variant={item.effectiveAttention === 'clear' ? 'secondary' : 'outline'}>
            {labels[item.effectiveAttention]}
          </Badge>
        </div>
        {item.nextAction && <p className="text-sm"><strong>Next step:</strong> {item.nextAction}</p>}
        <p className="text-xs text-muted-foreground">
          Due: {formatDate(item.nextActionDueAt)} · Open tasks: {item.openTaskCount}
          {' '}· Open matching issues: {item.unresolvedIssueCount}
        </p>
        {item.attentionNote && <p className="text-sm text-muted-foreground">
          Last decision: {item.attentionNote}
        </p>}
        {item.lastInboundAt && <p className="text-xs text-muted-foreground">
          Last linked inbound activity: {formatDate(item.lastInboundAt)}
          {' '}· Reviewed: {formatDate(item.lastAssessedAt)}
        </p>}
        {item.explicitAttention && item.effectiveAttention !== item.explicitAttention &&
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Attention reopened by newer inbound activity or an overdue action.
          </p>}
      </div>)}
      {opportunityId && selected && capabilities.mutate && <div className="space-y-3 border-t pt-4">
        <h3 className="font-medium">Record a relationship-level decision</h3>
        <p className="text-sm text-muted-foreground">
          Review all relevant conversations and commitments first. A new linked inbound message
          after this decision can automatically put the opportunity back into Needs action.
          Clear is unavailable while linked tasks, next actions, or unresolved matching issues remain.
        </p>
        <div className="space-y-1">
          <Label htmlFor="attention-decision">Attention status</Label>
          <select id="attention-decision" className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={selection} onChange={event => setSelection(event.target.value as AttentionStatus | '')}>
            <option value="">Choose a decision</option>
            {statuses.map(value => <option key={value} value={value}>{labels[value]}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="attention-evidence">Reason and required follow-up</Label>
          <Textarea id="attention-evidence" value={note} onChange={event => setNote(event.target.value)}
            maxLength={2500} placeholder="What was verified across the relationship, and what should happen next?" />
        </div>
        <Button disabled={save.isPending || !selection || note.trim().length < 8}
          onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save attention decision'}
        </Button>
        {save.isError && <p role="alert" className="text-sm text-destructive">
          {save.error instanceof Error ? save.error.message : 'Attention update failed.'}
        </p>}
      </div>}
      <Button variant="outline" size="sm" disabled={overview.isFetching}
        onClick={() => void overview.refetch()}>Refresh relationship attention</Button>
    </CardContent>
  </Card>;
}
