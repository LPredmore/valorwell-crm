import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { getZeffyDonationReport } from '@/repositories/supabase/zeffy-donations';
import { formatZeffyCents } from '@/domain/donations/zeffy-report';

export default function ZeffyDonationsPage() {
  const { currentTenantId, userId, crmRole, capabilities, isAuthenticated } = useCrmAuth();
  if (!isAuthenticated || !currentTenantId || !capabilities.report) return <p className="p-4">Select an authorized CRM reporting workspace.</p>;
  return <ScopedDonationReport key={JSON.stringify([currentTenantId, userId, crmRole])}
    tenantId={currentTenantId} userId={userId} crmRole={crmRole} />;
}

function ScopedDonationReport({ tenantId, userId, crmRole }: { tenantId: string; userId: string | null; crmRole: string }) {
  const refreshing = useRef(false);
  const [refreshStatus, setRefreshStatus] = useState<{ phase: 'idle' | 'refreshing' | 'success' | 'error'; message: string }>({ phase: 'idle', message: '' });
  const report = useQuery({
    queryKey: ['zeffy-donation-report', tenantId, userId, crmRole],
    queryFn: ({ signal }) => getZeffyDonationReport(tenantId, { signal }),
    // Attempt now and show a bounded connection failure rather than silently
    // queueing a manual refresh until the browser reports it is online again.
    networkMode: 'always', retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const refreshReport = async () => {
    if (refreshing.current || report.isFetching) return;
    refreshing.current = true;
    setRefreshStatus({ phase: 'refreshing', message: 'Refreshing donation report…' });
    try {
      const result = await report.refetch({ cancelRefetch: false });
      if (result.isError || !result.data) {
        setRefreshStatus({ phase: 'error', message: 'Refresh failed. See the report error below; existing amounts are not shown as current.' });
      } else {
        const detail = !result.data.sources.length ? 'No Zeffy source is configured for this workspace.'
          : result.data.sources.every(source => !source.enabled)
            ? 'Payment reconciliation is paused. Refreshing the report does not import payments.'
            : 'Showing the latest stored payment observations. This does not import payments from Zeffy.';
        setRefreshStatus({ phase: 'success', message: `Report refreshed at ${new Date().toLocaleTimeString()}. ${detail}` });
      }
    } catch {
      setRefreshStatus({ phase: 'error', message: 'The report could not be refreshed. Try Refresh report again.' });
    } finally { refreshing.current = false; }
  };
  return <div className="space-y-4 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">Foundation donations</h1>
      <Button variant="outline" disabled={report.isFetching || refreshStatus.phase === 'refreshing'} aria-busy={report.isFetching}
        onClick={() => void refreshReport()}>
        {report.isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        {report.isFetching ? 'Refreshing report…' : 'Refresh report'}
      </Button>
    </div>
    <p className="text-sm text-muted-foreground">Zeffy payment snapshots reconciled through authenticated provider reads. These figures cover recorded payments, not all campaign receipts or bank settlement.</p>
    <p className="text-sm text-muted-foreground">Refresh report reloads stored CRM payment observations. It does not fetch new payments from Zeffy or start reconciliation.</p>
    <div role="status" aria-live="polite" aria-atomic="true" className="text-sm">
      {report.isFetching ? (refreshStatus.phase === 'refreshing' ? 'Refreshing donation report…' : 'Loading donation report…') : refreshStatus.message}
    </div>
    {report.isSuccess && <p className="text-sm text-muted-foreground">Last successful report load: {new Date(report.dataUpdatedAt).toLocaleString()}</p>}
    {report.isError && <Card role="alert"><CardHeader><CardTitle>Payment report unavailable</CardTitle><CardDescription>{report.error.message}</CardDescription></CardHeader>
      <CardContent><p>Unavailable reporting does not mean there were no donations.</p></CardContent></Card>}
    {report.isSuccess && <>
      {!report.data.sources.length ? <p>No Zeffy source is configured for this CRM tenant.</p> : <>
        {report.data.sources.every(source => !source.enabled) && <p role="status" className="rounded border p-3">Payment reconciliation is paused. Stored observations, if any, remain visible.</p>}
        <p className="text-sm">Last observed: {report.data.lastObservedAt ? new Date(report.data.lastObservedAt).toLocaleString() : 'No authenticated payment observations recorded'} · Pending reviews: {BigInt(report.data.pendingPayments).toLocaleString()}</p>
        {!report.data.currencies.length ? <p>No payment snapshots have been recorded. This is not a campaign donation total.</p> :
          <div className="overflow-x-auto rounded border"><table className="w-full text-sm">
            <caption className="p-3 text-left">Completed amounts exclude pending/failed payments. Manual and imported records remain separate from online website candidates.</caption>
            <thead><tr>{['Source / currency', 'Recorded', 'Completed', 'Gross completed', 'Successful refunds', 'Net completed', 'Website candidates', 'Needs review'].map(label => <th scope="col" className="whitespace-nowrap p-3 text-left" key={label}>{label}</th>)}</tr></thead>
            <tbody>{report.data.currencies.map(row => <tr className="border-t" key={`${row.currency}:${row.sourceType}`}>
              <th scope="row" className="p-3 text-left capitalize">{row.sourceType} · {row.currency}</th>
              <td className="p-3">{BigInt(row.paymentsRecorded).toLocaleString()}</td><td className="p-3">{BigInt(row.completedPayments).toLocaleString()}</td>
              <td className="whitespace-nowrap p-3">{formatZeffyCents(row.grossCents, row.currency)}</td><td className="whitespace-nowrap p-3">{formatZeffyCents(row.refundedCents, row.currency)}</td><td className="whitespace-nowrap p-3">{formatZeffyCents(row.netCents, row.currency)}</td>
              <td className="p-3">{BigInt(row.websiteCandidates).toLocaleString()}</td><td className="p-3">{BigInt(row.requiresReview).toLocaleString()}</td>
            </tr>)}</tbody>
          </table></div>}
      </>}
      <Card><CardHeader><CardTitle>Donation tracking</CardTitle><CardDescription>Donation form opened remains the initial Google Ads conversion.</CardDescription></CardHeader>
        <CardContent className="space-y-2 text-sm"><p>Completed payments and actual amounts are tracked separately. Website candidates are not confirmed ad-attributed donations.</p>
          <p>Individual ad matching is not established. This report sends no conversions and does not match people by name, email or payment time.</p>
          <p>Recurring fields describe the observed installment; they do not prove a subscription remains active.</p></CardContent></Card>
    </>}
  </div>;
}
