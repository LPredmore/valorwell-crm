import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import {
  type IdentityDecision, type IdentitySourceDomain, linkedRecordUrl,
  type MatchBasis,
} from '@/domain/identity/review';
import { identityReviewsRepository, IdentityReviewNotDeployedError } from '@/repositories/identity-reviews';
import type { RelationshipContactRecord } from '@/domain/relationships/records';

const domainLabels: Record<IdentitySourceDomain, string> = {
  relationship_contact: 'Relationship contact',
  bty_opportunity: 'BTY opportunity',
  provider_applicant: 'Therapist application',
  therapist_prospect: 'Therapist prospect',
  client: 'Client intake (restricted)',
};

export function IdentityReviewPanel({ contact }: { contact: RelationshipContactRecord }) {
  const { currentTenantId, userId, crmRole } = useCrmAuth();
  return <IdentityReviewWorkspace key={`${currentTenantId}:${userId}:${crmRole}:${contact.id}`} contact={contact} />;
}

function IdentityReviewWorkspace({ contact }: { contact: RelationshipContactRecord }) {
  const { crmRole, capabilities, currentTenantId, userId } = useCrmAuth();
  const canEdit = capabilities.mutate;
  const admin = crmRole === 'crm_admin';
  const queryClient = useQueryClient();
  const scope = { tenantId: currentTenantId ?? '', userId };
  const enabled = !!currentTenantId && !!userId && contact.tenantId === currentTenantId && contact.kind === 'person';
  const key = ['identity-reviews', currentTenantId, userId, crmRole, contact.id];
  const eventKey = ['identity-review-events', currentTenantId, userId, crmRole, contact.id];
  const suggestions = useQuery({
    queryKey: ['identity-suggestions', currentTenantId, userId, crmRole, contact.id, contact.email, contact.phone],
    queryFn: () => identityReviewsRepository.findSuggestions(contact, scope),
    enabled,
    retry: false,
  });
  const reviewed = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => identityReviewsRepository.listForContact(contact.id, scope, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled,
    retry: false,
  });
  const events = useInfiniteQuery({
    queryKey: eventKey,
    queryFn: ({ pageParam }) => identityReviewsRepository.listEventsForContact(contact.id, scope, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: enabled && reviewed.isSuccess,
    retry: false,
  });
  const [domain, setDomain] = useState<IdentitySourceDomain>('relationship_contact');
  const [recordId, setRecordId] = useState('');
  const [note, setNote] = useState('');

  const save = useMutation({
    mutationFn: (input: { targetId: string; domain: IdentitySourceDomain; decision: IdentityDecision; basis: MatchBasis; note?: string }) =>
      identityReviewsRepository.decide({ contactId: contact.id, ...input }, scope),
    onSuccess: async () => {
      setRecordId('');
      setNote('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['identity-reviews', currentTenantId, userId] }),
        queryClient.invalidateQueries({ queryKey: ['identity-review-events', currentTenantId, userId] }),
      ]);
    },
  });
  if (!enabled) return null;
  const saved = reviewed.data?.pages.flatMap(page => page.items) ?? [];
  const history = events.data?.pages.flatMap(page => page.items) ?? [];
  const canReview = canEdit && reviewed.isSuccess && !reviewed.isFetching;
  const isUndeployed = reviewed.error instanceof IdentityReviewNotDeployedError;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Identity links and duplicate review</CardTitle>
        <CardDescription>
          Suggestions are evidence, not proof. Approving a link never merges source rows,
          changes email eligibility, or copies clinical records into this contact.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isUndeployed && (
          <p className="rounded border p-3 text-sm text-muted-foreground" role="status">
            Identity review storage is not deployed. Candidate discovery remains read-only;
            approvals are currently unavailable.
          </p>
        )}
        {reviewed.isError && !isUndeployed && (
          <p role="alert" className="text-sm text-destructive">
            Identity links cannot be loaded: {reviewed.error instanceof Error ? reviewed.error.message : 'Permission denied'}
          </p>
        )}
        <section className="space-y-2" aria-label="Potential duplicate contacts">
          <h3 className="font-medium">Potential duplicate contacts</h3>
          {suggestions.isLoading && <p className="text-sm text-muted-foreground">Checking this tenant's relationship contacts…</p>}
          {suggestions.isError && <p role="alert" className="text-sm text-destructive">Could not check candidates.</p>}
          {suggestions.data?.length === 0 && <p className="text-sm text-muted-foreground">No candidates were found in the limited email/US phone search. Other matches may exist.</p>}
          {(suggestions.data ?? []).map((candidate) => {
            const decision = saved.find((review) =>
              review.linkedDomain === 'relationship_contact'
              && [review.contactId, review.linkedRecordId].includes(contact.id)
              && [review.contactId, review.linkedRecordId].includes(candidate.contact.id));
            return (
              <div key={candidate.contact.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3">
                <div className="min-w-0 space-y-1">
                  <Link className="font-medium text-primary underline-offset-4 hover:underline"
                    to={`/crm/business-development/contacts/${candidate.contact.id}`}>
                    {candidate.contact.displayName}
                  </Link>
                  <p className="text-xs text-muted-foreground">{candidate.evidence}</p>
                  {candidate.ambiguous && <Badge variant="outline">Shared contact detail possible — review required</Badge>}
                  {decision && <Badge variant="secondary">Reviewed: {decision.decision}</Badge>}
                </div>
                {canReview && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={save.isPending}
                      onClick={() => save.mutate({
                        targetId: candidate.contact.id, domain: 'relationship_contact',
                        basis: candidate.matchBasis, decision: 'rejected',
                        note: 'Manually reviewed: not the same person',
                      })}>Not the same person</Button>
                    <Button size="sm" disabled={save.isPending}
                      onClick={() => save.mutate({
                        targetId: candidate.contact.id, domain: 'relationship_contact',
                        basis: candidate.matchBasis, decision: 'linked',
                        note: 'Reviewer verified this source-record association',
                      })}>Confirm link</Button>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <section className="space-y-2" aria-label="Reviewed identity links">
          <h3 className="font-medium">Reviewed source links</h3>
          {reviewed.isLoading && <p role="status" className="text-sm text-muted-foreground">Loading reviewed links…</p>}
          {saved.length === 0 && reviewed.isSuccess && <p className="text-sm text-muted-foreground">No confirmed or rejected links recorded.</p>}
          {saved.map((review) => {
            const otherId = review.linkedDomain === 'relationship_contact' && review.linkedRecordId === contact.id
              ? review.contactId : review.linkedRecordId;
            const href = linkedRecordUrl(review.linkedDomain, otherId);
            return <div className="flex flex-wrap items-center justify-between gap-3 rounded border p-3" key={review.id}>
              <div>
                <p className="text-sm">{domainLabels[review.linkedDomain]} · <Badge variant="secondary">{review.decision}</Badge></p>
                <p className="break-all font-mono text-xs text-muted-foreground">{otherId}</p>
                <p className="text-xs text-muted-foreground">Basis: {review.matchBasis} · Reviewed {new Date(review.updatedAt).toLocaleDateString()}</p>
              </div>
              {href && <Button asChild variant="outline" size="sm"><Link to={href}>Open source record</Link></Button>}
            </div>;
          })}
        </section>

        {reviewed.hasNextPage && <Button variant="outline" disabled={reviewed.isFetchingNextPage}
          onClick={() => void reviewed.fetchNextPage()}>{reviewed.isFetchingNextPage ? 'Loading…' : 'Load more source links'}</Button>}

        <section className="space-y-2 border-t pt-4" aria-label="Identity decision history">
          <h3 className="font-medium">Decision history</h3>
          {events.isLoading && <p role="status" className="text-sm text-muted-foreground">Loading review history…</p>}
          {events.isError && <p role="alert" className="text-sm text-destructive">Review history could not be loaded.</p>}
          {events.isSuccess && history.length === 0 && <p className="text-sm text-muted-foreground">No review events recorded.</p>}
          {history.map(event => <div key={event.id} className="space-y-1 rounded border p-3 text-sm">
            <p>{event.previousDecision ?? 'Unreviewed'} → {event.nextDecision} · {new Date(event.changedAt).toLocaleString()}</p>
            <p className="break-all text-xs text-muted-foreground">Review {event.reviewId} · Reviewer {event.actorId}</p>
            <p className="text-xs text-muted-foreground">Basis: {event.previousBasis ?? '—'} → {event.nextBasis ?? 'Historical evidence unavailable'}</p>
            {event.previousNote && <p className="break-words text-xs text-muted-foreground">Previous evidence: {event.previousNote}</p>}
            {event.nextNote && <p className="break-words text-xs">Evidence: {event.nextNote}</p>}
          </div>)}
          {events.hasNextPage && <Button variant="outline" disabled={events.isFetchingNextPage}
            onClick={() => void events.fetchNextPage()}>{events.isFetchingNextPage ? 'Loading…' : 'Load more history'}</Button>}
        </section>
        {save.isError && <p role="alert" className="text-sm text-destructive">{save.error instanceof Error ? save.error.message : 'Could not record decision'}</p>}
        {save.isSuccess && <p role="status" className="text-sm">Review decision recorded.</p>}

        {canReview && <section className="space-y-3 border-t pt-4" aria-label="Manually review a source record">
          <h3 className="font-medium">Link an existing source record</h3>
          <p className="text-xs text-muted-foreground">
            Enter a UUID from a source you already have permission to access. Source-specific
            tenant validation and clinical access checks are performed by the database.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="identity-domain">Source domain</Label>
              <Select value={domain} onValueChange={(value) => setDomain(value as IdentitySourceDomain)}>
                <SelectTrigger id="identity-domain"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="relationship_contact">Relationship contact</SelectItem>
                  <SelectItem value="bty_opportunity">BTY opportunity</SelectItem>
                  {admin && <SelectItem value="provider_applicant">Therapist application</SelectItem>}
                  {admin && <SelectItem value="therapist_prospect">Therapist prospect</SelectItem>}
                  {admin && <SelectItem value="client">Client intake (clinical approval required)</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="identity-record-id">Existing source record ID</Label>
              <Input id="identity-record-id" value={recordId} onChange={(event) => setRecordId(event.target.value)}
                placeholder="Existing record UUID" autoComplete="off" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="identity-note">Review evidence (no clinical details)</Label>
            <Input id="identity-note" value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)}
              placeholder="How was this relationship independently confirmed?" />
          </div>
          <div className="flex gap-2">
            <Button disabled={save.isPending || !recordId.trim() || note.trim().length < 8}
              onClick={() => save.mutate({ targetId: recordId.trim(), domain, decision: 'linked', basis: 'manual', note })}>
              Confirm reviewed association
            </Button>
            <Button variant="outline" disabled={save.isPending || !recordId.trim() || note.trim().length < 8}
              onClick={() => save.mutate({ targetId: recordId.trim(), domain, decision: 'rejected', basis: 'manual', note })}>
              Reject match
            </Button>
          </div>
        </section>}

      </CardContent>
    </Card>
  );
}
