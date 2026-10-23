import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { gmailContractMissing, gmailSyncHealth } from '@/lib/crm/gmail-sync-health';

type Recovery = {
  issueId: string; claimedMessageId: string; threadId: string | null;
  organizationId: string | null; opportunityCandidate: string | null;
  exactIdentityVerified: boolean; safelyRepairable: boolean; sourceStatus: string;
  reason: string; humanReviewRequired: boolean; providerRetrievalRequired: boolean;
  evidence: Record<string, unknown>;
};
type Diagnostic = {
  connectionId: string; lastSuccessfulSyncAt: string | null; lastPushAt: string | null;
  lastErrorCode: string | null; lastErrorReason: string | null;
  secondsSinceSuccessfulSync: number | null; watchExpiration: string | null;
};
async function readRpc<T>(name: string): Promise<T> {
  const { data, error } = await (supabase.rpc as unknown as
    (name: string) => Promise<{ data: T; error: { message: string } | null }>)(name);
  if (error) throw new Error(error.message);
  return data;
}
export function EmailSourceRecovery() {
  const { currentTenantId, isAuthenticated } = useCrmAuth();
  const enabled = isAuthenticated && Boolean(currentTenantId);
  const report = useQuery({ queryKey: ['email-source-recovery', currentTenantId], enabled,
    queryFn: () => readRpc<Recovery[]>('get_relationship_email_source_recovery'), retry: false });
  const diagnostics = useQuery({ queryKey: ['gmail-source-diagnostics', currentTenantId], enabled,
    queryFn: () => readRpc<Diagnostic[]>('get_relationship_gmail_diagnostics'), retry: false, refetchInterval: 60_000 });
  return <Card>
    <CardHeader><CardTitle>Gmail source verification</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">A missing message is not proof of deletion or non-delivery. Thread associations remain provisional until the original message is verified.</p>
      {diagnostics.data?.map(d => <div key={d.connectionId} className="text-sm">
        <p>Last successful sync: {d.lastSuccessfulSyncAt ?? 'Not recorded'} · Last push: {d.lastPushAt ?? 'Not recorded'}</p>
        <p>Time since successful sync: {d.secondsSinceSuccessfulSync == null ? 'Unknown' : `${Math.floor(d.secondsSinceSuccessfulSync / 60)} minutes`} · Watch expires: {d.watchExpiration ?? 'Not recorded'}</p>
        {['warning', 'critical'].includes(gmailSyncHealth(d.secondsSinceSuccessfulSync)) && <p role="alert">{gmailSyncHealth(d.secondsSinceSuccessfulSync) === 'critical' ? 'Critical' : 'Warning'}: Gmail reconciliation is overdue.</p>}
        {gmailContractMissing({ message: d.lastErrorReason ?? '' }) && <p role="alert">Required Gmail service is missing. Reviewed database recovery is required; renewing the watch does not repair synchronization.</p>}
        {d.lastErrorCode && <p role="alert">{d.lastErrorCode}: {d.lastErrorReason}</p>}
      </div>)}
      {report.isLoading && <p>Loading source evidence…</p>}
      {(report.error || diagnostics.error) && <p role="alert">{(report.error || diagnostics.error)?.message}</p>}
      {(gmailContractMissing(report.error) || gmailContractMissing(diagnostics.error)) && <p role="alert">Gmail evidence is unavailable until the reviewed recovery is released. Zero issues would not establish recovery.</p>}
      {report.data && <p>{report.data.length} open issues · {report.data.filter(r => r.exactIdentityVerified).length} exact identities verified · {report.data.filter(r => r.safelyRepairable).length} eligible for audited repair</p>}
      {report.data?.map(r => <details key={r.issueId} className="rounded border p-2 text-sm">
        <summary>{r.claimedMessageId} · {r.sourceStatus.replace(/_/g, ' ')}</summary>
        <p>Issue: {r.issueId} · Thread: {r.threadId ?? 'Unknown'}</p>
        <p>Organization: {r.organizationId ?? 'Unassigned'} · Opportunity candidate: {r.opportunityCandidate ?? 'None'}</p>
        <p>{r.reason}</p>
        <p>{r.humanReviewRequired ? 'Individual source review requested.' : 'Provider evidence recovery is the next step.'} {r.providerRetrievalRequired ? 'Exact provider retrieval still required.' : ''}</p>
        <pre className="overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(r.evidence, null, 2)}</pre>
      </details>)}
      <Button variant="outline" disabled={report.isFetching || diagnostics.isFetching}
        onClick={() => { void report.refetch(); void diagnostics.refetch(); }}>Refresh source evidence</Button>
    </CardContent>
  </Card>;
}
