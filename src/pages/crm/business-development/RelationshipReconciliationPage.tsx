import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
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
