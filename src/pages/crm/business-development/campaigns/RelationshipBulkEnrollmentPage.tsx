import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Search, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import {
  relationshipCandidateTarget,
  relationshipTargetBatches,
  type RelationshipBulkAudienceKind,
  type RelationshipCampaignCandidate,
} from '@/domain/relationships/bulk-enrollment-contracts';
import type { RelationshipCampaign } from '@/domain/relationships/campaign-contracts';
import type { RelationshipEnrollmentEligibility } from '@/domain/relationships/enrollment-contracts';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { dataProvider } from '@/services/dataProvider';

type AudienceFilter = RelationshipBulkAudienceKind | 'all';
type ReviewRow = { candidate: RelationshipCampaignCandidate; evaluation: RelationshipEnrollmentEligibility };
type EnrollmentFailure = { candidate: RelationshipCampaignCandidate; message: string };

type EnrollmentOutcome = {
  enrolled: RelationshipCampaignCandidate[];
  failed: EnrollmentFailure[];
};

const reasonLabels: Record<string, string> = {
  target_invalid: 'Target data is incomplete.',
  campaign_not_found: 'Campaign no longer exists.',
  campaign_not_active: 'Campaign is not active.',
  opportunity_not_found: 'BTY opportunity was not found.',
  opportunity_not_qualified: 'BTY opportunity is not qualified.',
  review_not_approved: 'Required review is not approved.',
  organization_not_found: 'Organization was not found.',
  contact_not_found: 'Contact was not found.',
  recipient_contact_required: 'A recipient contact is required.',
  recipient_contact_ambiguous: 'The recipient contact is ambiguous.',
  contact_not_linked_to_organization: 'Contact is not linked to the organization.',
  target_context_conflict: 'Contact and organization context conflict.',
  missing_email: 'No usable email address is recorded.',
  do_not_contact: 'Contact or organization is marked do not contact.',
  active_enrollment: 'Recipient is already active in this campaign.',
  previous_response: 'Recipient already responded to this campaign.',
  source_language_not_allowed: 'The campaign does not allow this source language.',
};

export default function RelationshipBulkEnrollmentPage() {
  const queryClient = useQueryClient();
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('enrollment');
  const available = capability?.available === true;
  const [audience, setAudience] = useState<AudienceFilter>('donor');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [liveAcknowledged, setLiveAcknowledged] = useState(false);

  const campaigns = useQuery({
    queryKey: ['relationship-campaigns', 'bulk-enrollment-active'],
    queryFn: () => dataProvider.relationships.listCampaigns({
      statuses: ['active'],
      page: 1,
      pageSize: 100,
      sortBy: 'name',
      sortDirection: 'asc',
    }),
    enabled: available,
    retry: false,
  });

  const audiences: RelationshipBulkAudienceKind[] = audience === 'all'
    ? ['donor', 'bty_referral']
    : [audience];

  const candidates = useQuery({
    queryKey: ['relationship-campaign-candidates', audiences, appliedSearch],
    queryFn: () => dataProvider.relationships.listCampaignCandidates({
      audiences,
      search: appliedSearch.trim() || undefined,
      page: 1,
      pageSize: 1000,
    }),
    enabled: available,
    retry: false,
  });

  const selectedCampaign = campaigns.data?.items.find((item) => item.id === campaignId);
  const selectedCandidates = useMemo(() => {
    const selected = new Set(selectedIds);
    return (candidates.data?.items ?? []).filter((candidate) => selected.has(candidate.contactId));
  }, [candidates.data?.items, selectedIds]);

  const review = useMutation({
    mutationFn: async (): Promise<ReviewRow[]> => {
      if (!campaignId) throw new Error('Choose a campaign before reviewing eligibility.');
      if (!selectedCandidates.length) throw new Error('Select at least one recipient.');
      const rows: ReviewRow[] = [];
      for (const batch of relationshipTargetBatches(selectedCandidates, 100)) {
        const evaluations = await dataProvider.relationships.evaluateEnrollmentEligibility(
          campaignId,
          batch.map(relationshipCandidateTarget),
        );
        evaluations.forEach((evaluation, index) => {
          const candidate = batch[index];
          if (candidate) rows.push({ candidate, evaluation });
        });
      }
      return rows;
    },
  });

  const reviewedRows = review.data ?? [];
  const eligibleRows = reviewedRows.filter((row) => row.evaluation.eligible);
  const ineligibleRows = reviewedRows.filter((row) => !row.evaluation.eligible);

  const enrollment = useMutation({
    mutationFn: async (): Promise<EnrollmentOutcome> => {
      if (!selectedCampaign) throw new Error('Choose an active campaign.');
      if (!eligibleRows.length) throw new Error('Review at least one eligible recipient first.');

      const enrolled: RelationshipCampaignCandidate[] = [];
      const failed: EnrollmentFailure[] = [];

      const enrollBatch = async (rows: ReviewRow[]): Promise<void> => {
        try {
          await dataProvider.relationships.enroll(selectedCampaign.id, {
            targets: rows.map((row) => relationshipCandidateTarget(row.candidate)),
            expectedCampaignVersion: selectedCampaign.version,
            idempotencyKey: `relationship-bulk-enroll:${selectedCampaign.id}:${crypto.randomUUID()}`,
          });
          enrolled.push(...rows.map((row) => row.candidate));
        } catch (error) {
          if (rows.length === 1) {
            failed.push({
              candidate: rows[0].candidate,
              message: error instanceof Error ? error.message : 'Enrollment failed.',
            });
            return;
          }
          const midpoint = Math.ceil(rows.length / 2);
          await enrollBatch(rows.slice(0, midpoint));
          await enrollBatch(rows.slice(midpoint));
        }
      };

      for (const batch of relationshipTargetBatches(eligibleRows, 100)) {
        await enrollBatch(batch);
      }
      return { enrolled, failed };
    },
    onSuccess: async (outcome) => {
      const failedIds = new Set(outcome.failed.map((item) => item.candidate.contactId));
      setSelectedIds((current) => current.filter((id) => failedIds.has(id)));
      setLiveAcknowledged(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['relationship-enrollments', campaignId] }),
        queryClient.invalidateQueries({ queryKey: ['relationship-campaigns'] }),
      ]);
    },
  });

  const resetReview = () => {
    review.reset();
    enrollment.reset();
    setLiveAcknowledged(false);
  };

  const applyFilters = () => {
    setAppliedSearch(searchInput);
    setSelectedIds([]);
    resetReview();
  };

  const selectAllLoaded = () => {
    setSelectedIds((candidates.data?.items ?? []).map((candidate) => candidate.contactId));
    resetReview();
  };

  const toggleCandidate = (contactId: string, checked: boolean) => {
    setSelectedIds((current) => checked
      ? [...new Set([...current, contactId])]
      : current.filter((id) => id !== contactId));
    resetReview();
  };

  const enrollmentPending = review.isPending || enrollment.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bulk campaign enrollment</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Find donor/funder or BTY referral contacts, select the matching audience, review the canonical safety decision, and enroll only eligible recipients.
          </p>
        </div>
        <Button asChild variant="outline"><Link to="/crm/business-development/campaigns">Campaign register</Link></Button>
      </div>

      <RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} />

      <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" />Live campaign boundary</CardTitle>
          <CardDescription>
            Enrollment is not a draft action. When the selected campaign has execution enabled, eligible recipients enter its live delivery schedule immediately after enrollment.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>1. Choose the audience and campaign</CardTitle>
          <CardDescription>
            Donors are organizations tagged with the funder role. BTY referrals include BTY nominees and verified BTY/client-nomination referrals.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="bulk-audience">Audience</Label>
            <select
              id="bulk-audience"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={audience}
              onChange={(event) => {
                setAudience(event.target.value as AudienceFilter);
                setSelectedIds([]);
                resetReview();
              }}
            >
              <option value="donor">Donors / funders</option>
              <option value="bty_referral">BTY referrals / nominees</option>
              <option value="all">Donors and BTY referrals</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bulk-campaign">Campaign</Label>
            <select
              id="bulk-campaign"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={campaignId}
              onChange={(event) => {
                setCampaignId(event.target.value);
                resetReview();
              }}
            >
              <option value="">Choose an active campaign</option>
              {campaigns.data?.items.map((campaign) => (
                <option value={campaign.id} key={campaign.id}>
                  {campaign.name} · execution {campaign.executionEnabled ? 'on' : 'off'}
                </option>
              ))}
            </select>
            {campaigns.isError && <ErrorText error={campaigns.error} />}
          </div>
          <div className="space-y-2">
            <Label htmlFor="bulk-search">Search within audience</Label>
            <div className="flex gap-2">
              <Input
                id="bulk-search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Contact, email, or organization"
                onKeyDown={(event) => { if (event.key === 'Enter') applyFilters(); }}
              />
              <Button type="button" variant="outline" onClick={applyFilters}><Search className="h-4 w-4" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>2. Select recipients</CardTitle>
              <CardDescription>
                {candidates.data ? `${candidates.data.total} matching contacts; ${selectedIds.length} selected.` : 'Loading matching contacts.'}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={!candidates.data?.items.length || enrollmentPending} onClick={selectAllLoaded}>
                Select all matching
              </Button>
              <Button type="button" variant="ghost" disabled={!selectedIds.length || enrollmentPending} onClick={() => { setSelectedIds([]); resetReview(); }}>
                Clear selection
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {candidates.isLoading && <p className="text-sm text-muted-foreground">Loading campaign candidates…</p>}
          {candidates.isError && <ErrorText error={candidates.error} />}
          {candidates.data && candidates.data.total > candidates.data.items.length && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              The result exceeds the 1,000-contact safety limit. Narrow the filters before selecting all matching recipients.
            </p>
          )}
          {candidates.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No matching contacts were found.</p>}
          {candidates.data?.items.map((candidate) => (
            <CandidateRow
              key={candidate.contactId}
              candidate={candidate}
              checked={selectedIds.includes(candidate.contactId)}
              disabled={enrollmentPending}
              onCheckedChange={(checked) => toggleCandidate(candidate.contactId, checked)}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Review eligibility</CardTitle>
          <CardDescription>
            The same campaign evaluator used by one-at-a-time enrollment checks every selected recipient in batches of 100.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            disabled={!campaignId || !selectedCandidates.length || enrollmentPending}
            onClick={() => review.mutate()}
          >
            {review.isPending ? 'Reviewing…' : `Review ${selectedCandidates.length} selected recipients`}
          </Button>
          {review.isError && <ErrorText error={review.error} />}
          {reviewedRows.length > 0 && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <SummaryCard label="Eligible" value={eligibleRows.length} tone="ready" />
                <SummaryCard label="Excluded" value={ineligibleRows.length} tone={ineligibleRows.length ? 'warning' : 'neutral'} />
              </div>
              {ineligibleRows.length > 0 && (
                <div className="space-y-2 rounded-lg border border-amber-500/40 p-4">
                  <p className="font-medium">Excluded recipients</p>
                  {ineligibleRows.map((row) => (
                    <div key={row.candidate.contactId} className="text-sm">
                      <span className="font-medium">{row.candidate.contactName}</span>
                      <span className="text-muted-foreground"> · {row.evaluation.reasons.map((reason) => reasonLabels[reason] ?? reason.replace(/_/g, ' ')).join(' ')}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4. Enroll eligible recipients</CardTitle>
          <CardDescription>
            The CRM rechecks every target during enrollment. If a batch becomes stale, it is split automatically so one blocked recipient does not prevent other safe recipients from enrolling.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectedCampaign && (
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{selectedCampaign.name}</Badge>
              <Badge variant={selectedCampaign.executionEnabled ? 'default' : 'secondary'}>
                Execution {selectedCampaign.executionEnabled ? 'enabled' : 'disabled'}
              </Badge>
              <Badge variant="outline">Version {selectedCampaign.version}</Badge>
            </div>
          )}
          <label className="flex items-start gap-3 rounded-lg border p-4 text-sm">
            <Checkbox
              checked={liveAcknowledged}
              disabled={!eligibleRows.length || enrollmentPending}
              onCheckedChange={(checked) => setLiveAcknowledged(checked === true)}
            />
            <span>
              I understand that enrolling these recipients may begin live email delivery according to the selected campaign’s execution state and send window.
            </span>
          </label>
          <Button
            type="button"
            disabled={!eligibleRows.length || !liveAcknowledged || enrollmentPending}
            onClick={() => enrollment.mutate()}
          >
            {enrollment.isPending ? 'Enrolling…' : `Enroll ${eligibleRows.length} eligible recipients`}
          </Button>
          {enrollment.isError && <ErrorText error={enrollment.error} />}
          {enrollment.data && (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                {enrollment.data.enrolled.length} recipients enrolled
              </div>
              {enrollment.data.failed.length > 0 && (
                <div className="space-y-1 text-sm text-destructive">
                  <p className="font-medium">{enrollment.data.failed.length} recipients could not be enrolled:</p>
                  {enrollment.data.failed.map((item) => <p key={item.candidate.contactId}>{item.candidate.contactName}: {item.message}</p>)}
                </div>
              )}
              {selectedCampaign && (
                <Button asChild variant="outline">
                  <Link to={`/crm/business-development/campaigns/${selectedCampaign.id}/enrollments`}>View campaign enrollments</Link>
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CandidateRow({
  candidate,
  checked,
  disabled,
  onCheckedChange,
}: {
  candidate: RelationshipCampaignCandidate;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const unsafe = candidate.doNotContact || candidate.organizationDoNotContact;
  return (
    <div className="flex items-start gap-3 rounded-lg border p-4">
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => onCheckedChange(value === true)} aria-label={`Select ${candidate.contactName}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link className="font-medium text-primary hover:underline" to={`/crm/business-development/contacts/${candidate.contactId}`}>
            {candidate.contactName}
          </Link>
          {candidate.audienceKinds.map((kind) => <Badge variant="outline" key={kind}>{kind === 'donor' ? 'Donor / funder' : 'BTY referral'}</Badge>)}
          {candidate.verifiedReferralId && <Badge variant="secondary">Verified referral</Badge>}
          {unsafe && <Badge variant="destructive">Do not contact</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{candidate.email}</p>
        <p className="text-sm text-muted-foreground">{candidate.organizationName ?? 'No organization'} · source language {candidate.sourceLanguageMode.replace(/_/g, ' ')}</p>
      </div>
      <UsersRound className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: 'ready' | 'warning' | 'neutral' }) {
  const className = tone === 'ready'
    ? 'border-primary/40'
    : tone === 'warning'
      ? 'border-amber-500/40'
      : '';
  return <div className={`rounded-lg border p-4 ${className}`}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>;
}

function ErrorText({ error }: { error: unknown }) {
  return <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'The operation failed.'}</p>;
}
