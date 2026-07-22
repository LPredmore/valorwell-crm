import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import type { RelationshipCampaignEnrollment, RelationshipEnrollmentEligibility, RelationshipEnrollmentStatus, RelationshipEnrollmentTarget } from '@/domain/relationships/enrollment-contracts';
import { operatorEnrollmentTransitions, relationshipEnrollmentStatuses } from '@/domain/relationships/enrollment-contracts';
import type { SourceLanguageMode } from '@/domain/relationships/contracts';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { dataProvider } from '@/services/dataProvider';

const statusLabels: Record<RelationshipEnrollmentStatus, string> = {
  pending: 'Pending delivery activation', active: 'Active orchestration', paused: 'Paused', responded: 'Responded',
  stopped: 'Stopped', completed: 'Completed', failed: 'Failed', suppressed: 'Suppressed',
};

type TargetKind = 'contact' | 'organization' | 'opportunity';

export default function RelationshipCampaignEnrollmentsPage() {
  const { id } = useParams();
  const campaignId = id ?? '';
  const queryClient = useQueryClient();
  const { capability, isLoading: capabilityLoading, isError: capabilityError, refetch } = useRelationshipCapability('enrollment');
  const available = capability?.available === true;
  const [targetKind, setTargetKind] = useState<TargetKind>('contact');
  const [targetId, setTargetId] = useState('');
  const [explicitContactId, setExplicitContactId] = useState('');
  const [sourceLanguageMode, setSourceLanguageMode] = useState<SourceLanguageMode>('none');
  const [verifiedReferralId, setVerifiedReferralId] = useState('');
  const [statusFilter, setStatusFilter] = useState<RelationshipEnrollmentStatus | ''>('');
  const [transitionReasons, setTransitionReasons] = useState<Record<string, string>>({});
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string>();

  const campaignQuery = useQuery({ queryKey: ['relationship-campaign', campaignId], queryFn: () => dataProvider.relationships.getCampaign(campaignId), enabled: available && Boolean(campaignId), retry: false });
  const enrollmentQuery = useQuery({
    queryKey: ['relationship-enrollments', campaignId, statusFilter],
    queryFn: () => dataProvider.relationships.listEnrollments(campaignId, { statuses: statusFilter ? [statusFilter] : undefined, page: 1, pageSize: 100 }),
    enabled: available && Boolean(campaignId), retry: false,
  });
  const eventsQuery = useQuery({ queryKey: ['relationship-enrollment-events', selectedEnrollmentId], queryFn: () => dataProvider.relationships.listEnrollmentEvents(selectedEnrollmentId!), enabled: available && Boolean(selectedEnrollmentId), retry: false });

  const target = useMemo<RelationshipEnrollmentTarget>(() => {
    const value: RelationshipEnrollmentTarget = { sourceLanguageMode };
    if (targetKind === 'contact') value.contactId = targetId.trim() || undefined;
    if (targetKind === 'organization') { value.organizationId = targetId.trim() || undefined; value.contactId = explicitContactId.trim() || undefined; }
    if (targetKind === 'opportunity') { value.opportunityId = targetId.trim() || undefined; value.contactId = explicitContactId.trim() || undefined; }
    if (sourceLanguageMode === 'verified_anonymous' || sourceLanguageMode === 'verified_named') value.verifiedReferralId = verifiedReferralId.trim() || undefined;
    return value;
  }, [explicitContactId, sourceLanguageMode, targetId, targetKind, verifiedReferralId]);

  const evaluationMutation = useMutation({
    mutationFn: async () => {
      if (!targetId.trim()) throw new Error('Target ID is required.');
      if ((sourceLanguageMode === 'verified_anonymous' || sourceLanguageMode === 'verified_named') && !verifiedReferralId.trim()) throw new Error('Verified referral ID is required.');
      const results = await dataProvider.relationships.evaluateEnrollmentEligibility(campaignId, [target]);
      if (!results[0]) throw new Error('The eligibility evaluator returned no result.');
      return results[0];
    },
  });

  const enrollmentMutation = useMutation({
    mutationFn: async () => {
      const campaign = campaignQuery.data;
      if (!campaign) throw new Error('Load the campaign before enrolling a recipient.');
      if (!evaluationMutation.data?.eligible) throw new Error('Evaluate an eligible recipient first.');
      return dataProvider.relationships.enroll(campaign.id, { targets: [target], expectedCampaignVersion: campaign.version });
    },
    onSuccess: async (items) => {
      evaluationMutation.reset(); setTargetId(''); setExplicitContactId(''); setVerifiedReferralId('');
      if (items[0]) setSelectedEnrollmentId(items[0].id);
      await queryClient.invalidateQueries({ queryKey: ['relationship-enrollments', campaignId] });
    },
  });

  const transitionMutation = useMutation({
    mutationFn: ({ enrollment, status }: { enrollment: RelationshipCampaignEnrollment; status: 'pending' | 'paused' | 'stopped' }) => dataProvider.relationships.transitionEnrollmentStatus(enrollment.id, { status, expectedVersion: enrollment.version, reason: transitionReasons[enrollment.id]?.trim() || undefined }),
    onSuccess: async (updated) => { await refreshEnrollment(updated.id); },
  });

  const safetyMutation = useMutation({
    mutationFn: (enrollment: RelationshipCampaignEnrollment) => dataProvider.relationships.revalidateEnrollmentSafety(enrollment.id, { expectedVersion: enrollment.version, reason: 'Operator requested current communication-safety review.' }),
    onSuccess: async (updated) => { await refreshEnrollment(updated.id); },
  });

  async function refreshEnrollment(enrollmentId: string) {
    await queryClient.invalidateQueries({ queryKey: ['relationship-enrollments', campaignId] });
    await queryClient.invalidateQueries({ queryKey: ['relationship-enrollment-events', enrollmentId] });
  }

  const campaign = campaignQuery.data ?? undefined;
  const pending = evaluationMutation.isPending || enrollmentMutation.isPending || transitionMutation.isPending || safetyMutation.isPending;
  const verifiedMode = sourceLanguageMode === 'verified_anonymous' || sourceLanguageMode === 'verified_named';

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="mb-2 flex gap-2"><Badge variant="outline">Pass 11</Badge><Badge variant="secondary">Safety-enforced enrollment</Badge></div><h1 className="text-3xl font-bold tracking-tight">Campaign enrollments</h1><p className="mt-2 max-w-3xl text-muted-foreground">Resolve recipients, enforce current suppression and referral policy, and plan dormant work without contacting anyone.</p></div><div className="flex gap-2"><Button asChild variant="outline"><Link to="/crm/business-development/suppressions">Safety ledger</Link></Button><Button asChild variant="outline"><Link to="/crm/business-development/campaigns">Campaign register</Link></Button></div></div>
    <RelationshipCapabilityState state={capability} isLoading={capabilityLoading} isError={capabilityError} onRetry={() => { void refetch(); }} />
    <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10"><CardHeader><CardTitle>Safety is active; delivery is not</CardTitle><CardDescription>Enrollments must pass current DNC, suppression, campaign, opportunity, affiliation, and verified-referral checks. Campaign execution and delivery remain hard disabled until Pass 12.</CardDescription></CardHeader></Card>

    {campaign && <Card><CardHeader><CardTitle>{campaign.name}</CardTitle><CardDescription>{campaign.purpose}</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2"><Badge variant="outline">{campaign.status}</Badge><Badge variant="secondary">Version {campaign.version}</Badge><Badge variant="outline">{campaign.steps.length} steps</Badge></CardContent></Card>}

    {available && campaign && <Card><CardHeader><CardTitle>Resolve and enroll recipient</CardTitle><CardDescription>Preliminary resolution is followed by a transactional Pass 11 safety review before the enrollment is created.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Field label="Target type" id="target-type"><select id="target-type" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={targetKind} onChange={(event) => { setTargetKind(event.target.value as TargetKind); evaluationMutation.reset(); }}><option value="contact">Contact</option><option value="organization">Organization</option><option value="opportunity">BTY opportunity</option></select></Field>
      <Field label={`${capitalize(targetKind)} ID`} id="target-id"><Input id="target-id" value={targetId} onChange={(event) => { setTargetId(event.target.value); evaluationMutation.reset(); }} placeholder="UUID" /></Field>
      {targetKind !== 'contact' && <Field label="Explicit contact ID" id="contact-id"><Input id="contact-id" value={explicitContactId} onChange={(event) => { setExplicitContactId(event.target.value); evaluationMutation.reset(); }} placeholder="Optional UUID" /></Field>}
      <Field label="Source language" id="source-mode"><select id="source-mode" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={sourceLanguageMode} onChange={(event) => { const value = event.target.value as SourceLanguageMode; setSourceLanguageMode(value); if (!value.startsWith('verified_')) setVerifiedReferralId(''); evaluationMutation.reset(); }}><option value="none">None</option><option value="research">Research</option><option value="community">Community</option><option value="verified_anonymous">Verified anonymous referral</option><option value="verified_named">Verified named referral</option></select></Field>
      {verifiedMode && <Field label="Verified referral ID" id="referral-id"><Input id="referral-id" value={verifiedReferralId} onChange={(event) => { setVerifiedReferralId(event.target.value); evaluationMutation.reset(); }} /></Field>}
    </div><div className="flex gap-2"><Button variant="outline" disabled={pending || !targetId.trim()} onClick={() => evaluationMutation.mutate()}>{evaluationMutation.isPending ? 'Evaluating…' : 'Resolve recipient'}</Button><Button disabled={pending || !evaluationMutation.data?.eligible || campaign.status !== 'active'} onClick={() => enrollmentMutation.mutate()}>{enrollmentMutation.isPending ? 'Creating…' : 'Create safety-reviewed enrollment'}</Button></div>{evaluationMutation.data && <EligibilityResult evaluation={evaluationMutation.data} />}{evaluationMutation.isError && <ErrorText error={evaluationMutation.error} />}{enrollmentMutation.isError && <ErrorText error={enrollmentMutation.error} />}</CardContent></Card>}

    {available && campaign && <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Enrollment register</CardTitle><CardDescription>{enrollmentQuery.data ? `${enrollmentQuery.data.total} enrollments.` : 'Loading.'}</CardDescription></div><Field label="Status" id="status-filter"><select id="status-filter" className="flex h-10 w-64 rounded-md border border-input bg-background px-3 py-2 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as RelationshipEnrollmentStatus | '')}><option value="">Any status</option>{relationshipEnrollmentStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></Field></div></CardHeader><CardContent className="space-y-4">{enrollmentQuery.data?.items.map((enrollment) => <EnrollmentCard key={enrollment.id} enrollment={enrollment} selected={selectedEnrollmentId === enrollment.id} reason={transitionReasons[enrollment.id] ?? ''} pending={pending} onSelect={() => setSelectedEnrollmentId(enrollment.id)} onReasonChange={(value) => setTransitionReasons((current) => ({ ...current, [enrollment.id]: value }))} onTransition={(status) => transitionMutation.mutate({ enrollment, status })} onRevalidate={() => safetyMutation.mutate(enrollment)} />)}{enrollmentQuery.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No enrollments match this filter.</p>}{enrollmentQuery.isError && <ErrorText error={enrollmentQuery.error} />}{transitionMutation.isError && <ErrorText error={transitionMutation.error} />}{safetyMutation.isError && <ErrorText error={safetyMutation.error} />}</CardContent></Card>}

    {selectedEnrollmentId && <Card><CardHeader><CardTitle>Enrollment event ledger</CardTitle><CardDescription>Append-only enrollment, safety, suppression, and dormant-work evidence.</CardDescription></CardHeader><CardContent className="space-y-3">{eventsQuery.data?.map((event) => <div key={event.id} className="rounded border p-3"><div className="flex justify-between gap-2"><Badge variant="outline">{event.eventType.replace(/_/g, ' ')}</Badge><span className="text-xs text-muted-foreground">{new Date(event.occurredAt).toLocaleString()}</span></div><p className="mt-2 text-sm">{event.reason ?? `${event.fromStatus ?? 'none'} → ${event.toStatus ?? 'unchanged'}`}</p></div>)}</CardContent></Card>}
  </div>;
}

function EligibilityResult({ evaluation }: { evaluation: RelationshipEnrollmentEligibility }) {
  return <div className="rounded border p-4"><div className="flex gap-2"><Badge variant={evaluation.eligible ? 'default' : 'destructive'}>{evaluation.eligible ? 'Preliminarily eligible' : 'Not eligible'}</Badge><Badge variant="outline">Final safety enforced at enrollment</Badge></div>{evaluation.recipientEmail && <p className="mt-2 text-sm">{evaluation.recipientName ?? 'Unnamed'} · {evaluation.recipientEmail}</p>}{evaluation.reasons.length > 0 && <p className="mt-2 text-sm text-destructive">{evaluation.reasons.join(', ')}</p>}</div>;
}

function EnrollmentCard({ enrollment, selected, reason, pending, onSelect, onReasonChange, onTransition, onRevalidate }: { enrollment: RelationshipCampaignEnrollment; selected: boolean; reason: string; pending: boolean; onSelect: () => void; onReasonChange: (value: string) => void; onTransition: (status: 'pending' | 'paused' | 'stopped') => void; onRevalidate: () => void }) {
  const transitions = operatorEnrollmentTransitions(enrollment.status);
  return <div className={`space-y-4 rounded-lg border p-4 ${selected ? 'border-primary' : ''}`}><div className="flex flex-wrap justify-between gap-3"><div><button className="font-medium text-primary hover:underline" onClick={onSelect}>{enrollment.recipientName ?? enrollment.recipientEmail}</button><p className="text-sm text-muted-foreground">{enrollment.recipientEmail}</p></div><div className="flex gap-2"><Badge variant="outline">{statusLabels[enrollment.status]}</Badge><Badge variant={enrollment.safetyStatus === 'ready' ? 'default' : 'destructive'}>Safety {enrollment.safetyStatus}</Badge><Badge variant="secondary">Delivery off</Badge></div></div><div className="grid gap-2 text-sm md:grid-cols-4"><p><span className="font-medium">Step:</span> {enrollment.currentStepPosition ?? 'None'}</p><p><span className="font-medium">Planned:</span> {enrollment.nextScheduledAt ? new Date(enrollment.nextScheduledAt).toLocaleString() : 'None'}</p><p><span className="font-medium">Policy:</span> {enrollment.safetySnapshot?.policyVersion ?? 'Pending'}</p><p><span className="font-medium">Version:</span> {enrollment.version}</p></div>{enrollment.safetySnapshot?.reasons.length ? <p className="text-sm text-destructive">Blocked by: {enrollment.safetySnapshot.reasons.join(', ')}</p> : null}<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending} onClick={onRevalidate}>Revalidate safety</Button>{transitions.map((status) => <Button key={status} variant={status === 'stopped' ? 'destructive' : 'outline'} disabled={pending} onClick={() => onTransition(status)}>{status === 'pending' ? 'Resume pending' : capitalize(status)}</Button>)}</div>{transitions.length > 0 && <div className="space-y-2"><Label htmlFor={`reason-${enrollment.id}`}>Status-change reason</Label><Textarea id={`reason-${enrollment.id}`} value={reason} onChange={(event) => onReasonChange(event.target.value)} /></div>}</div>;
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) { return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>; }
function ErrorText({ error }: { error: unknown }) { return <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Request failed.'}</p>; }
function capitalize(value: string) { return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`; }
