import { applicantWorkspaceLink } from '@/domain/pipelines/applicant-workspace-link';
import { RecruitmentInterviewCampaignControl } from './RecruitmentInterviewCampaignControl';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { applicantHandoffMessage } from '@/domain/pipelines/applicant-handoff';
import { applicantStatuses, listAllApplicantHandoffs, getApplicantProfessionalDetails } from '@/repositories/supabase/applicant-handoff';

const originOptions = ['all', 'Cold', 'Indeed', 'Legacy', 'Website', 'Other'] as const;
const originLabels: Record<string, string> = { all: 'All sources', Cold: 'Cold outreach', Indeed: 'Indeed', Legacy: 'Legacy (before July 2026)', Website: 'Website', Other: 'Other' };

const statusLabels: Record<string, string> = { interview_scheduled: 'Interview Scheduled', ready: 'Approved', hired: 'Onboarding started', screening: 'Interviewed', application: 'Application review', credentialing: 'Credentialing review', no_response: 'No response' };
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
  const rawOrigin = params.get('origin') ?? 'all';
  const origin = originOptions.some(value => value === rawOrigin) ? rawOrigin : 'all';
  const [draft, setDraft] = useState(search);
  const update = (key: string, value: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    return next;
  });
  const query = useQuery({
    queryKey: ['crm-applicant-handoffs-all', currentTenantId, userId, crmRole, status, search],
    queryFn: () => listAllApplicantHandoffs(currentTenantId!, status, search),
    enabled: isAuthenticated && !!currentTenantId, retry: false,
  });
  const allRows = query.data?.items ?? [];
  const counts = Object.fromEntries(originOptions.slice(1).map(value => [value, allRows.filter(row => row.applicantOrigin === value).length]));
  const filteredRows = origin === 'all' ? allRows : allRows.filter(row => row.applicantOrigin === origin);
  const visibleRows = filteredRows.slice((page - 1) * 50, page * 50);
  if (!currentTenantId) return <p>Select a CRM tenant to review staff handoffs.</p>;
  return <div className="space-y-4 p-4">
    <h1 className="text-2xl font-bold">Recruitment → staff handoff</h1>
    <RecruitmentInterviewCampaignControl tenantId={currentTenantId} />
    <p className="text-sm text-muted-foreground">Submitted applications, including onboarding and closed records. Staff access is required. Payer enrollment and network availability require separate source confirmation.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" asChild><Link to="/crm/recruitment/prospects">Prospect queue</Link></Button>
      <Button variant="outline" asChild><Link to="/crm/pipelines">Pipelines</Link></Button>
      <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh handoffs</Button>
    </div>
    <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); update('q', draft.trim()); }}>
      <Input className="sm:max-w-sm" aria-label="Search submitted applicants" placeholder="Search applicant name or contact information" maxLength={200} value={draft} onChange={event => setDraft(event.target.value)} />
      <Button type="submit">Search</Button>
      <select className="rounded border bg-background p-2" aria-label="Applicant pipeline status" value={status} onChange={event => update('status', event.target.value)}>
        <option value="all">All source statuses</option>
        {applicantStatuses.map(value => <option key={value} value={value}>{label(value)}</option>)}
      </select>
      <select className="rounded border bg-background p-2" aria-label="Filter applicants by source" value={origin} onChange={event => update('origin', event.target.value)}>
        {originOptions.map(value => <option key={value} value={value}>{originLabels[value]}{value === 'all' ? ` (${allRows.length})` : ` (${counts[value] ?? 0})`}</option>)}
      </select>
    </form>
    {query.isPending && <p role="status">Loading staff-authorized applications…</p>}
    {query.isError && <p role="alert" className="text-destructive">Could not load staff handoffs: {query.error.message}</p>}
    {query.isSuccess && <>
      <p className="text-sm">{filteredRows.length} matching applications · page {page}</p>
      {!visibleRows.length && <p>No applications on this page. Adjust filters or return to the previous page.</p>}
      {visibleRows.map(row => <Card key={row.id}>
        <CardHeader><CardTitle className="text-lg">{row.name} · {label(row.status)}</CardTitle>
          <p><span className="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium">Source: {row.applicantOrigin || 'Unavailable'}</span></p>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {row.referralSource && <p>Original referral: {row.referralSource}</p>}
          <p>Contact: {row.email || 'Email unavailable'} · {row.phone || 'Phone unavailable'}</p>
          <p>Reported credential: {row.licenseType || 'Not recorded'} · Location: {row.primaryState || 'Not recorded'} (not proof of license state)</p>
          <p>Owner: {row.ownerName || 'Unassigned or unavailable'}</p>
          <p>Next action: {row.nextAction || 'Not recorded'} · {dateLabel(row.nextActionDueAt)}</p>
          <p>{applicantHandoffMessage(row.status, row)}</p>
          <p className="break-all text-xs">Application reference: {row.id}</p>
          {row.convertedStaffId && <p className="break-all text-xs">Linked staff reference: {row.convertedStaffId}</p>}
          <ApplicantReview tenantId={currentTenantId} applicantId={row.id} />
          <a className="underline" href={applicantWorkspaceLink(row.id, row.name)} target="_blank" rel="noopener noreferrer">Find referenced application in staff workspace</a>
        </CardContent>
      </Card>)}
      <div className="flex gap-2">
        <Button variant="outline" disabled={page <= 1 || query.isFetching} onClick={() => update('page', String(page - 1))}>Previous</Button>
        <Button variant="outline" disabled={page * 50 >= filteredRows.length || query.isFetching} onClick={() => update('page', String(page + 1))}>Next</Button>
      </div>
    </>}
  </div>;
}

function ApplicantReview({ tenantId, applicantId }: { tenantId: string; applicantId: string }) {
  const [open, setOpen] = useState(false);
  const review = useQuery({
    queryKey: ['crm-applicant-professional-details', tenantId, applicantId],
    queryFn: () => getApplicantProfessionalDetails(tenantId, applicantId),
    enabled: open, retry: false,
  });
  return <div className="space-y-2">
    <Button variant="outline" size="sm" onClick={() => setOpen(previous => !previous)}>{open ? 'Hide professional details' : 'Show professional details'}</Button>
    {open && <div className="space-y-2 rounded border p-3">
      {review.isPending && <p>Loading applicant professional details…</p>}
      {review.isError && <p role="alert" className="text-destructive">Review unavailable: {review.error.message}</p>}
      {review.isSuccess && !review.data && <p>No professional details have been recorded.</p>}
      {review.isSuccess && review.data && <>
        <p><strong>Applicant recruiting contact:</strong> {review.data.recruitingCommunicationAllowed ? 'Allowed for direct application-related contact' : 'Not authorized / not recorded'}</p>
        {review.data.recruitingCommunicationAllowed && <p className="text-xs text-muted-foreground">This is an employer recruiting permission, not evidence of applicant marketing opt-in. Check suppression before contacting.</p>}
        <p><strong>Marketing opt-in:</strong> {review.data.marketingConsentStatus === 'not_obtained' ? 'Not collected' : review.data.marketingConsentStatus || 'Not recorded'}</p>
        <p><strong>Most likely license (confirm at interview):</strong> {review.data.likelyLicenseType || 'Not assessed'}{review.data.likelyLicensedStates.length ? ` · ${review.data.likelyLicensedStates.join(', ')}` : ''}</p>
        <p><strong>License state assessment:</strong> {review.data.likelyLicenseAssessment === 'likely_state_inferred_pending_interview' ? 'Inferred from professional history; not confirmed' : review.data.likelyLicenseAssessment === 'reported_on_resume_unverified' ? 'Stated on résumé; not independently verified' : 'Not assessed'}</p>
        <p><strong>Interview confirmation:</strong> {review.data.licenseConfirmationStatus === 'pending_interview' ? 'Pending' : review.data.licenseConfirmationStatus || 'Not recorded'}</p>
        <p><strong>Reported license:</strong> {review.data.reportedLicenseType || 'Not recorded'}</p>
        <p><strong>States explicitly identified as licensed:</strong> {review.data.reportedLicensedStates.length ? review.data.reportedLicensedStates.join(', ') : 'Not clearly stated'}</p>
        {review.data.licenseStatesToVerify.length > 0 && <p><strong>Possible states to verify (not confirmed licensed):</strong> {review.data.licenseStatesToVerify.join(', ')}</p>}
        {review.data.licenseStateEvidence && <p><strong>License-state evidence:</strong> {review.data.licenseStateEvidence}</p>}
        <p><strong>Résumé-reported experience (unverified):</strong> {review.data.summary || 'Not recorded'}</p>
        {review.data.clinicalHighlights.length > 0 && <ul className="list-disc space-y-1 pl-5">{review.data.clinicalHighlights.map((item, index) => <li key={index}>{item}</li>)}</ul>}
        <p>Credential verification: {review.data.credentialVerificationStatus || 'Not recorded'}</p>
        {review.data.verificationNeeded.length > 0 && <ul className="list-disc space-y-1 pl-5">
          {review.data.verificationNeeded.map((flag, i) => <li key={i}>{flag}</li>)}
        </ul>}
        {review.data.indeedConversationEmail && <p className="break-all">Indeed conversation: {review.data.indeedConversationEmail}</p>}
      </>}
    </div>}
  </div>;
}
