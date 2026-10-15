import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { getZeffyDonationReport } from '@/repositories/supabase/zeffy-donations';
import { formatZeffyCents } from '@/domain/donations/zeffy-report';

export default function ZeffyDonationsPage() {
  const { currentTenantId, userId, crmRole, capabilities, isAuthenticated } = useCrmAuth();
  const report = useQuery({
    queryKey: ['zeffy-donation-report', currentTenantId, userId, crmRole],
    queryFn: () => getZeffyDonationReport(currentTenantId!),
    enabled: isAuthenticated && !!currentTenantId && capabilities.report, retry: false,
  });
  if (!isAuthenticated || !currentTenantId || !capabilities.report) return <p className="p-4">Select an authorized CRM reporting workspace.</p>;
  return <div className="space-y-4 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">Foundation donations</h1>
      <Button variant="outline" disabled={report.isFetching} onClick={() => void report.refetch()}>Refresh report</Button>
    </div>
    <p className="text-sm text-muted-foreground">Zeffy payment snapshots reconciled through authenticated provider reads. These figures cover recorded payments, not all campaign receipts or bank settlement.</p>
    {report.isPending && <p role="status">Loading payment report…</p>}
    {report.isError && <Card><CardHeader><CardTitle>Payment report unavailable</CardTitle><CardDescription>{report.error.message}</CardDescription></CardHeader>
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
