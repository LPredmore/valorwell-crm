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
import type {
  RelationshipCampaignEnrollment,
  RelationshipEnrollmentEligibility,
  RelationshipEnrollmentStatus,
  RelationshipEnrollmentTarget,
} from '@/domain/relationships/enrollment-contracts';
import { operatorEnrollmentTransitions, relationshipEnrollmentStatuses } from '@/domain/relationships/enrollment-contracts';
import type { SourceLanguageMode } from '@/domain/relationships/contracts';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { dataProvider } from '@/services/dataProvider';

const statusLabels: Record<RelationshipEnrollmentStatus, string> = {
  pending: 'Pending safety and delivery gates',
  active: 'Active orchestration',
  paused: 'Paused',
  responded: 'Responded',
  stopped: 'Stopped',
  completed: 'Completed',
  failed: 'Failed',
  suppressed: 'Suppressed',
};

const eligibilityLabels: Record<string, string> = {
  target_invalid: 'The target payload is invalid.',
  campaign_not_found: 'The campaign could not be found.',
  campaign_not_active: 'The campaign definition must be active before enrollment.',
  opportunity_not_found: 'The opportunity could not be found in the operating tenant.',
  opportunity_not_qualified: 'The opportunity is not qualified or ready for campaign enrollment.',
  review_not_approved: 'The opportunity review status is not approved.',
  organization_not_found: 'The organization could not be found in the operating tenant.',
  contact_not_found: 'The contact could not be found in the operating tenant.',
  recipient_contact_required: 'A sendable contact could not be resolved. Select a contact explicitly.',
  recipient_contact_ambiguous: 'Multiple primary contacts exist. Select the intended contact explicitly.',
  contact_not_linked_to_organization: 'The selected contact is not affiliated with the selected organization.',
  target_context_conflict: 'The selected contact, organization, and opportunity do not describe the same relationship.',
  missing_email: 'The resolved contact has no email address.',
  do_not_contact: 'The resolved contact or organization is marked do not contact.',
  active_enrollment: 'This contact already has a pending, active, or paused enrollment in the campaign.',
  previous_response: 'This contact previously responded to this campaign.',
  source_language_not_allowed: 'Verified source language requires matching, verified, non-revoked referral evidence with the correct disclosure mode.',
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

  const campaignQuery = useQuery({
    queryKey: ['relationship-campaign', campaignId],
    queryFn: () => dataProvider.relationships.getCampaign(campaignId),
    enabled: available && Boolean(campaignId),
    retry: false,
  });

  const enrollmentQuery = useQuery({
    queryKey: ['relationship-enrollments', campaignId, statusFilter],
    queryFn: () => dataProvider.relationships.listEnrollments(campaignId, {
      statuses: statusFilter ? [statusFilter] : undefined,
      page: 1,
      pageSize: 100,
    }),
    enabled: available && Boolean(campaignId),
    retry: false,
  });

  const eventsQuery = useQuery({
    queryKey: ['relationship-enrollment-events', selectedEnrollmentId],
    queryFn: () => dataProvider.relationships.listEnrollmentEvents(selectedEnrollmentId!),
    enabled: available && Boolean(selectedEnrollmentId),
    retry: false,
  });

  const target = useMemo<RelationshipEnrollmentTarget>(() => {
    const value: RelationshipEnrollmentTarget = { sourceLanguageMode };
    const normalizedTargetId = targetId.trim();
    const normalizedContactId = explicitContactId.trim();
    const normalizedReferralId = verifiedReferralId.trim();
    if (targetKind === 'contact') value.contactId = normalizedTargetId || undefined;
    if (targetKind === 'organization') {
      value.organizationId = normalizedTargetId || undefined;
      value.contactId = normalizedContactId || undefined;
    }
    if (targetKind === 'opportunity') {
      value.opportunityId = normalizedTargetId || undefined;
      value.contactId = normalizedContactId || undefined;
    }
    if (sourceLanguageMode === 'verified_anonymous' || sourceLanguageMode === 'verified_named') {
      value.verifiedReferralId = normalizedReferralId || undefined;
    }
    return value;
  }, [explicitContactId, sourceLanguageMode, targetId, targetKind, verifiedReferralId]);

  const evaluationMutation = useMutation({
    mutationFn: async () => {
      if (!targetId.trim()) throw new Error('Target ID is required.');
      if ((sourceLanguageMode === 'verified_anonymous' || sourceLanguageMode === 'verified_named') && !verifiedReferralId.trim()) {
        throw new Error('Verified referral ID is required for verified source-language modes.');
      }
      const results = await dataProvider.relationships.evaluateEnrollmentEligibility(campaignId, [target]);
      if (!results[0]) throw new Error('The eligibility evaluator returned no result.');
      return results[0];
    },
  });

  const enrollmentMutation = useMutation({
    mutationFn: async () => {
      const campaign = campaignQuery.data;
      const evaluation = evaluationMutation.data;
      if (!campaign) throw new Error('Load the campaign before enrolling a recipient.');
      if (!evaluation?.eligible) throw new Error('Evaluate and resolve an eligible recipient first.');
      return dataProvider.relationships.enroll(campaign.id, {
        targets: [target],
        expectedCampaignVersion: campaign.version,
      });
    },
    onSuccess: async (enrollments) => {
      evaluationMutation.reset();
      setTargetId('');
      setExplicitContactId('');
      setVerifiedReferralId('');
      if (enrollments[0]) setSelectedEnrollmentId(enrollments[0].id);
      await queryClient.invalidateQueries({ queryKey: ['relationship-enrollments', campaignId] });
      await queryClient.invalidateQueries({ queryKey: ['relationship-campaigns'] });
    },
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ enrollment, status }: { enrollment: RelationshipCampaignEnrollment; status: 'pending' | 'paused' | 'stopped' }) => dataProvider.relationships.transitionEnrollmentStatus(enrollment.id, {
      status,
      expectedVersion: enrollment.version,
      reason: transitionReasons[enrollment.id]?.trim() || undefined,
    }),
    onSuccess: async (updated) => {
      setTransitionReasons((current) => ({ ...current, [updated.id]: '' }));
      await queryClient.invalidateQueries({ queryKey: ['relationship-enrollments', campaignId] });
      await queryClient.invalidateQueries({ queryKey: ['relationship-enrollment-events', updated.id] });
    },
  });

  const campaign = campaignQuery.data ?? undefined;
  const evaluation = evaluationMutation.data;
  const pending = evaluationMutation.isPending || enrollmentMutation.isPending || transitionMutation.isPending;
  const verifiedMode = sourceLanguageMode === 'verified_anonymous' || sourceLanguageMode === 'verified_named';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge variant="outline">Pass 10</Badge>
            <Badge variant="secondary">Enrollment and orchestration foundation</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Campaign enrollments</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">Resolve a sendable relationship contact, snapshot preliminary eligibility, and create dormant ordered work without contacting anyone.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link to="/crm/business-development/campaigns">Campaign register</Link></Button>
          {campaign && <Button asChild variant="outline"><Link to={`/crm/business-development/campaigns/${campaign.id}`}>Campaign definition</Link></Button>}
        </div>
      </div>

      <RelationshipCapabilityState state={capability} isLoading={capabilityLoading} isError={capabilityError} onRetry={() => { void refetch(); }} />

      <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Delivery remains hard disabled</CardTitle>
            <Badge variant="outline">Campaign execution false</Badge>
            <Badge variant="outline">Enrollment delivery false</Badge>
            <Badge variant="outline">Safety pending Pass 11</Badge>
          </div>
          <CardDescription>Pass 10 can create a pending enrollment and dormant work plan. It cannot claim work, send email, create communication records, process replies, or bypass suppression and unsubscribe controls.</CardDescription>
        </CardHeader>
      </Card>

      {campaignQuery.isLoading && <Card><CardHeader><CardTitle>Loading campaign…</CardTitle></CardHeader></Card>}
      {campaignQuery.isError && <Card><CardHeader><CardTitle>Campaign could not be loaded</CardTitle><CardDescription>{errorMessage(campaignQuery.error, 'Try again later.')}</CardDescription></CardHeader></Card>}
      {campaignQuery.data === null && <Card><CardHeader><CardTitle>Campaign not found</CardTitle></CardHeader></Card>}

      {campaign && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><CardTitle>{campaign.name}</CardTitle><CardDescription>{campaign.purpose}</CardDescription></div>
              <div className="flex flex-wrap gap-2"><Badge variant="outline">{campaign.status}</Badge><Badge variant="secondary">Version {campaign.version}</Badge></div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-3">
            <div><p className="font-medium">Sender</p><p className="text-muted-foreground">{campaign.senderName} &lt;{campaign.senderEmail}&gt;</p></div>
            <div><p className="font-medium">Ordered steps</p><p className="text-muted-foreground">{campaign.steps.length}</p></div>
            <div><p className="font-medium">Definition state</p><p className="text-muted-foreground">{campaign.status === 'active' ? 'Accepts preliminary enrollments' : 'Must be active before enrollment'}</p></div>
          </CardContent>
        </Card>
      )}

      {available && campaign && (
        <Card>
          <CardHeader><CardTitle>Resolve and evaluate recipient</CardTitle><CardDescription>Every enrollment must resolve to one relationship contact. Organization and opportunity targets may resolve through their explicit or single primary contact. Verified source language requires a matching verified referral record.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Field label="Target type" id="enrollment-target-type">
                <select id="enrollment-target-type" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={targetKind} onChange={(event) => { setTargetKind(event.target.value as TargetKind); evaluationMutation.reset(); }}>
                  <option value="contact">Contact</option>
                  <option value="organization">Organization</option>
                  <option value="opportunity">BTY opportunity</option>
                </select>
              </Field>
              <Field label={`${capitalize(targetKind)} ID`} id="enrollment-target-id"><Input id="enrollment-target-id" value={targetId} onChange={(event) => { setTargetId(event.target.value); evaluationMutation.reset(); }} placeholder="UUID" /></Field>
              {targetKind !== 'contact' && <Field label="Explicit contact ID" id="enrollment-contact-id"><Input id="enrollment-contact-id" value={explicitContactId} onChange={(event) => { setExplicitContactId(event.target.value); evaluationMutation.reset(); }} placeholder="Optional UUID" /></Field>}
              <Field label="Source-language mode" id="enrollment-source-language">
                <select id="enrollment-source-language" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={sourceLanguageMode} onChange={(event) => { const mode = event.target.value as SourceLanguageMode; setSourceLanguageMode(mode); if (mode !== 'verified_anonymous' && mode !== 'verified_named') setVerifiedReferralId(''); evaluationMutation.reset(); }}>
                  <option value="none">None</option>
                  <option value="research">Research</option>
                  <option value="community">Community</option>
                  <option value="verified_anonymous">Verified anonymous referral</option>
                  <option value="verified_named">Verified named referral</option>
                </select>
              </Field>
              {verifiedMode && <Field label="Verified referral ID" id="enrollment-referral-id"><Input id="enrollment-referral-id" value={verifiedReferralId} onChange={(event) => { setVerifiedReferralId(event.target.value); evaluationMutation.reset(); }} placeholder="Required verified referral UUID" /></Field>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={pending || !targetId.trim() || (verifiedMode && !verifiedReferralId.trim())} onClick={() => evaluationMutation.mutate()}>{evaluationMutation.isPending ? 'Evaluating…' : 'Evaluate recipient'}</Button>
              <Button type="button" disabled={pending || !evaluation?.eligible || campaign.status !== 'active'} onClick={() => enrollmentMutation.mutate()}>{enrollmentMutation.isPending ? 'Creating…' : 'Create pending enrollment'}</Button>
            </div>
            {evaluationMutation.isError && <p className="text-sm text-destructive">{errorMessage(evaluationMutation.error, 'Eligibility could not be evaluated.')}</p>}
            {enrollmentMutation.isError && <p className="text-sm text-destructive">{errorMessage(enrollmentMutation.error, 'Enrollment could not be created.')}</p>}
            {evaluation && <EligibilityResult evaluation={evaluation} />}
          </CardContent>
        </Card>
      )}

      {available && campaign && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><CardTitle>Enrollment register</CardTitle><CardDescription>{enrollmentQuery.data ? `${enrollmentQuery.data.total} resolved campaign enrollments.` : 'Loading resolved enrollments.'}</CardDescription></div>
              <Field label="Status" id="enrollment-status-filter"><select id="enrollment-status-filter" className="flex h-10 w-64 rounded-md border border-input bg-background px-3 py-2 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as RelationshipEnrollmentStatus | '')}><option value="">Any status</option>{relationshipEnrollmentStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></Field>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {enrollmentQuery.isLoading && <p className="text-sm text-muted-foreground">Loading enrollments…</p>}
            {enrollmentQuery.isError && <p className="text-sm text-destructive">{errorMessage(enrollmentQuery.error, 'Enrollments could not be loaded.')}</p>}
            {enrollmentQuery.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No enrollments match the current filter.</p>}
            {enrollmentQuery.data?.items.map((enrollment) => (
              <EnrollmentCard
                key={enrollment.id}
                enrollment={enrollment}
                selected={selectedEnrollmentId === enrollment.id}
                reason={transitionReasons[enrollment.id] ?? ''}
                pending={pending}
                onSelect={() => setSelectedEnrollmentId(enrollment.id)}
                onReasonChange={(reason) => setTransitionReasons((current) => ({ ...current, [enrollment.id]: reason }))}
                onTransition={(status) => transitionMutation.mutate({ enrollment, status })}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {selectedEnrollmentId && (
        <Card>
          <CardHeader><CardTitle>Enrollment event ledger</CardTitle><CardDescription>Append-only lifecycle and dormant orchestration evidence for the selected enrollment.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {eventsQuery.isLoading && <p className="text-sm text-muted-foreground">Loading events…</p>}
            {eventsQuery.isError && <p className="text-sm text-destructive">{errorMessage(eventsQuery.error, 'Events could not be loaded.')}</p>}
            {eventsQuery.data?.map((event) => <div key={event.id} className="rounded border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><Badge variant="outline">{event.eventType.replace(/_/g, ' ')}</Badge><span className="text-xs text-muted-foreground">{new Date(event.occurredAt).toLocaleString()}</span></div><p className="mt-2 text-sm">{event.reason ?? `${event.fromStatus ?? 'none'} → ${event.toStatus ?? 'unchanged'}`}</p></div>)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EligibilityResult({ evaluation }: { evaluation: RelationshipEnrollmentEligibility }) {
  return <div className="rounded-lg border p-4"><div className="flex flex-wrap items-center gap-2"><Badge variant={evaluation.eligible ? 'default' : 'destructive'}>{evaluation.eligible ? 'Preliminarily eligible' : 'Not eligible'}</Badge><Badge variant="outline">Safety pending Pass 11</Badge><Badge variant="outline">Delivery disabled</Badge></div>{evaluation.resolvedContactId && <div className="mt-3 grid gap-2 text-sm md:grid-cols-3"><p><span className="font-medium">Resolved contact:</span> {evaluation.resolvedContactId}</p><p><span className="font-medium">Recipient:</span> {evaluation.recipientName ?? 'Unnamed'}</p><p><span className="font-medium">Email:</span> {evaluation.recipientEmail ?? 'Unavailable'}</p>{evaluation.verifiedReferralId && <p><span className="font-medium">Verified referral:</span> {evaluation.verifiedReferralId}</p>}</div>}{evaluation.reasons.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-destructive">{evaluation.reasons.map((reason) => <li key={reason}>{eligibilityLabels[reason] ?? reason.replace(/_/g, ' ')}</li>)}</ul>}</div>;
}

function EnrollmentCard({ enrollment, selected, reason, pending, onSelect, onReasonChange, onTransition }: {
  enrollment: RelationshipCampaignEnrollment;
  selected: boolean;
  reason: string;
  pending: boolean;
  onSelect: () => void;
  onReasonChange: (reason: string) => void;
  onTransition: (status: 'pending' | 'paused' | 'stopped') => void;
}) {
  const transitions = operatorEnrollmentTransitions(enrollment.status);
  return <div className={`space-y-4 rounded-lg border p-4 ${selected ? 'border-primary' : ''}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><button className="text-left font-medium text-primary hover:underline" type="button" onClick={onSelect}>{enrollment.recipientName ?? enrollment.recipientEmail}</button><p className="text-sm text-muted-foreground">{enrollment.recipientEmail} · Contact {enrollment.contactId}</p></div><div className="flex flex-wrap gap-2"><Badge variant="outline">{statusLabels[enrollment.status]}</Badge><Badge variant="secondary">Version {enrollment.version}</Badge></div></div><div className="grid gap-3 text-sm md:grid-cols-4"><div><p className="font-medium">Current step</p><p className="text-muted-foreground">{enrollment.currentStepPosition ?? 'None'}</p></div><div><p className="font-medium">Planned time</p><p className="text-muted-foreground">{enrollment.nextScheduledAt ? new Date(enrollment.nextScheduledAt).toLocaleString() : 'None'}</p></div><div><p className="font-medium">Safety</p><p className="text-muted-foreground">Pending Pass 11</p></div><div><p className="font-medium">Delivery</p><p className="text-muted-foreground">Hard disabled</p></div></div>{transitions.length > 0 && <div className="space-y-2"><Label htmlFor={`transition-reason-${enrollment.id}`}>Status-change reason</Label><Textarea id={`transition-reason-${enrollment.id}`} value={reason} onChange={(event) => onReasonChange(event.target.value)} placeholder="Why is this enrollment changing state?" /><div className="flex flex-wrap gap-2">{transitions.map((status) => <Button key={status} type="button" variant={status === 'stopped' ? 'destructive' : 'outline'} disabled={pending} onClick={() => onTransition(status)}>{status === 'pending' ? 'Resume as pending' : status === 'paused' ? 'Pause' : 'Stop'}</Button>)}</div></div>}</div>;
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function capitalize(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
