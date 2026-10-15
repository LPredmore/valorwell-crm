import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { applicantHandoffMessage } from '@/domain/pipelines/applicant-handoff';
import { applicantStatuses, listApplicantHandoffs } from '@/repositories/supabase/applicant-handoff';

const statusLabels: Record<string, string> = { ready: 'Approved', hired: 'Onboarding started', screening: 'Interviewed', application: 'Application review', credentialing: 'Credentialing review', no_response: 'No response' };
function label(status: string) { return statusLabels[status] ?? status.replace(/_/g, ' '); }
function dateLabel(value: string | null) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Date unavailable';
}
export default function ApplicantHandoffPage() {
  const { currentTenantId, userId, crmRole } = useCrmAuth();
  const [params] = useSearchParams();
  return <ApplicantHandoffWorkspace key={`${currentTenantId}:${userId}:${crmRole}:${params.toString()}`} />;
}
function ApplicantHandoffWorkspace() {
  const { currentTenantId, userId, crmRole, isAuthenticated } = useCrmAuth();
  const [params, setParams] = useSearchParams();
  const rawPage = Number(params.get('page'));
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 1000000 ? rawPage : 1;
  const rawStatus = params.get('status') ?? 'all';
  const status = applicantStatuses.some(value => value === rawStatus) ? rawStatus : 'all';
  const search = (params.get('q') ?? '').slice(0, 200);
  const [draft, setDraft] = useState(search);
  const update = (key: string, value: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    return next;
  });
  const query = useQuery({
    queryKey: ['crm-applicant-handoffs', currentTenantId, userId, crmRole, page, status, search],
    queryFn: () => listApplicantHandoffs(currentTenantId!, page, status, search),
    enabled: isAuthenticated && !!currentTenantId, retry: false,
  });
  if (!currentTenantId) return <p>Select a CRM tenant to review staff handoffs.</p>;
  return <div className="space-y-4 p-4">
    <h1 className="text-2xl font-bold">Recruitment → staff handoff</h1>
    <p className="text-sm text-muted-foreground">Submitted applications, including onboarding and closed records. Staff access is required. Payer enrollment and network availability require separate source confirmation.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" asChild><Link to="/crm/recruitment/prospects">Prospect queue</Link></Button>
      <Button variant="outline" asChild><Link to="/crm/pipelines">Pipelines</Link></Button>
      <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh handoffs</Button>
    </div>
    <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); update('q', draft.trim()); }}>
      <Input className="sm:max-w-sm" aria-label="Search submitted applicants" placeholder="Search applicant name or contact information" maxLength={200} value={draft} onChange={event => setDraft(event.target.value)} />
      <Button type="submit">Search</Button>
      <select className="rounded border bg-background p-2" aria-label="Applicant source status" value={status} onChange={event => update('status', event.target.value)}>
        <option value="all">All source statuses</option>
        {applicantStatuses.map(value => <option key={value} value={value}>{label(value)}</option>)}
      </select>
    </form>
    {query.isPending && <p role="status">Loading staff-authorized applications…</p>}
    {query.isError && <p role="alert" className="text-destructive">Could not load staff handoffs: {query.error.message}</p>}
    {query.isSuccess && <>
      <p className="text-sm">{query.data.total} matching applications · page {page}</p>
      {!query.data.items.length && <p>No applications on this page. Adjust filters or return to the previous page.</p>}
      {query.data.items.map(row => <Card key={row.id}>
        <CardHeader><CardTitle className="text-lg">{row.name} · {label(row.status)}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Owner: {row.ownerName || 'Unassigned or unavailable'}</p>
          <p>Next action: {row.nextAction || 'Not recorded'} · {dateLabel(row.nextActionDueAt)}</p>
          <p>{applicantHandoffMessage(row.status, row)}</p>
          <p className="break-all text-xs">Application reference: {row.id}</p>
          {row.convertedStaffId && <p className="break-all text-xs">Linked staff reference: {row.convertedStaffId}</p>}
          <a className="underline" href="https://emr.valorwell.org/staff/provider-applicants" target="_blank" rel="noopener noreferrer">Open staff workspace; find this applicant by name</a>
        </CardContent>
      </Card>)}
      <div className="flex gap-2">
        <Button variant="outline" disabled={page <= 1 || query.isFetching} onClick={() => update('page', String(page - 1))}>Previous</Button>
        <Button variant="outline" disabled={page * 50 >= query.data.total || query.isFetching} onClick={() => update('page', String(page + 1))}>Next</Button>
      </div>
    </>}
  </div>;
}
