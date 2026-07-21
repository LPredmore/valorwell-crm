import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, History, MessageSquarePlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { RelationshipTimeline } from '@/components/crm/relationships/RelationshipTimeline';
import type {
  InteractionType,
  RelationshipStage,
} from '@/domain/relationships/contracts';
import {
  availableRelationshipStageTransitions,
  manualInteractionTypes,
  interactionTypeLabel,
  relationshipStageLabel,
  validateInteractionDraft,
  validateStageTransitionDraft,
} from '@/domain/relationships/lifecycle-workflow';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import type { RelationshipSubject } from '@/repositories/relationships';
import { dataProvider } from '@/services/dataProvider';

export type RelationshipLifecyclePanelProps = {
  subject: RelationshipSubject;
  currentStage?: RelationshipStage;
  entityLabel: string;
};

export function RelationshipLifecyclePanel({
  subject,
  currentStage,
  entityLabel,
}: RelationshipLifecyclePanelProps) {
  const queryClient = useQueryClient();
  const capabilityQuery = useRelationshipCapability('interactions');
  const available = capabilityQuery.capability?.available === true;
  const key = subjectKey(subject);
  const transitions = useMemo(
    () => availableRelationshipStageTransitions(currentStage),
    [currentStage],
  );
  const [nextStage, setNextStage] = useState<RelationshipStage | ''>('');
  const [transitionReason, setTransitionReason] = useState('');
  const [transitionErrors, setTransitionErrors] = useState<Record<string, string>>({});
  const [interactionType, setInteractionType] = useState<InteractionType>('manual_note');
  const [interactionOccurredAt, setInteractionOccurredAt] = useState(() => localDateTime(new Date()));
  const [interactionSummary, setInteractionSummary] = useState('');
  const [interactionErrors, setInteractionErrors] = useState<Record<string, string>>({});

  const history = useQuery({
    queryKey: ['relationship-stage-history', key],
    queryFn: () => dataProvider.relationships.listStageHistory(subject),
    enabled: available,
    retry: false,
  });

  const interactions = useQuery({
    queryKey: ['relationship-interactions', key, 1, 50],
    queryFn: () => dataProvider.relationships.listInteractions(subject, { page: 1, pageSize: 50 }),
    enabled: available,
    retry: false,
  });

  const refreshLifecycle = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['relationship-stage-history', key] }),
      queryClient.invalidateQueries({ queryKey: ['relationship-interactions', key] }),
      subject.organizationId
        ? queryClient.invalidateQueries({ queryKey: ['relationship-organization', subject.organizationId] })
        : Promise.resolve(),
      subject.contactId
        ? queryClient.invalidateQueries({ queryKey: ['relationship-contact', subject.contactId] })
        : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: ['relationship-organizations'] }),
      queryClient.invalidateQueries({ queryKey: ['relationship-contacts'] }),
    ]);
  };

  const transition = useMutation({
    mutationFn: (input: { to: RelationshipStage; reason: string }) =>
      dataProvider.relationships.transitionStage({
        subject,
        to: input.to,
        reason: input.reason,
      }),
    onSuccess: async () => {
      setNextStage('');
      setTransitionReason('');
      setTransitionErrors({});
      await refreshLifecycle();
    },
  });

  const createInteraction = useMutation({
    mutationFn: (input: { type: InteractionType; occurredAt: string; summary: string }) =>
      dataProvider.relationships.createInteraction({
        ...subject,
        type: input.type,
        occurredAt: input.occurredAt,
        summary: input.summary,
      }),
    onSuccess: async () => {
      setInteractionSummary('');
      setInteractionOccurredAt(localDateTime(new Date()));
      setInteractionErrors({});
      await queryClient.invalidateQueries({ queryKey: ['relationship-interactions', key] });
    },
  });

  const submitTransition = () => {
    const validation = validateStageTransitionDraft({
      from: currentStage,
      to: nextStage || undefined,
      reason: transitionReason,
    });
    setTransitionErrors(validation.fieldErrors);
    if (!validation.valid || !nextStage) return;
    transition.mutate({ to: nextStage, reason: transitionReason.trim() });
  };

  const submitInteraction = () => {
    const validation = validateInteractionDraft({
      type: interactionType,
      occurredAt: interactionOccurredAt,
      summary: interactionSummary,
    });
    setInteractionErrors(validation.fieldErrors);
    if (!validation.valid) return;
    createInteraction.mutate({
      type: interactionType,
      occurredAt: new Date(interactionOccurredAt).toISOString(),
      summary: interactionSummary.trim(),
    });
  };

  return (
    <div className="space-y-6">
      <RelationshipCapabilityState
        state={capabilityQuery.capability}
        isLoading={capabilityQuery.isLoading}
        isError={capabilityQuery.isError}
        onRetry={() => { void capabilityQuery.refetch(); }}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Lifecycle stage</CardTitle>
            <CardDescription>
              Move {entityLabel} only through approved relationship stages. Every change records an audit reason.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Current stage</span>
              <Badge variant="secondary">{relationshipStageLabel(currentStage)}</Badge>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`relationship-next-stage-${key}`}>Next stage</Label>
              <select
                id={`relationship-next-stage-${key}`}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={nextStage}
                disabled={!available || !currentStage || transition.isPending}
                onChange={(event) => setNextStage(event.target.value as RelationshipStage | '')}
              >
                <option value="">Select an allowed transition</option>
                {transitions.map((stage) => (
                  <option value={stage} key={stage}>{relationshipStageLabel(stage)}</option>
                ))}
              </select>
              {transitionErrors.to && <p className="text-sm text-destructive">{transitionErrors.to}</p>}
              {transitionErrors.from && <p className="text-sm text-destructive">{transitionErrors.from}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`relationship-stage-reason-${key}`}>Reason</Label>
              <Textarea
                id={`relationship-stage-reason-${key}`}
                value={transitionReason}
                disabled={!available || transition.isPending}
                onChange={(event) => setTransitionReason(event.target.value)}
                placeholder="Why is this lifecycle change appropriate?"
              />
              {transitionErrors.reason && <p className="text-sm text-destructive">{transitionErrors.reason}</p>}
            </div>
            {transition.isError && (
              <p className="text-sm text-destructive">
                {transition.error instanceof Error ? transition.error.message : 'The lifecycle stage could not be changed.'}
              </p>
            )}
            <Button
              type="button"
              disabled={!available || !currentStage || transition.isPending}
              onClick={submitTransition}
            >
              <ArrowRight className="mr-2 h-4 w-4" />
              {transition.isPending ? 'Changing stage…' : 'Change lifecycle stage'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Record interaction</CardTitle>
            <CardDescription>
              Capture non-clinical outreach, replies, calls, meetings, and operator notes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`relationship-interaction-type-${key}`}>Interaction type</Label>
                <select
                  id={`relationship-interaction-type-${key}`}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={interactionType}
                  disabled={!available || createInteraction.isPending}
                  onChange={(event) => setInteractionType(event.target.value as InteractionType)}
                >
                  {manualInteractionTypes.map((type) => (
                    <option value={type} key={type}>{interactionTypeLabel(type)}</option>
                  ))}
                </select>
                {interactionErrors.type && <p className="text-sm text-destructive">{interactionErrors.type}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor={`relationship-interaction-date-${key}`}>Occurred at</Label>
                <Input
                  id={`relationship-interaction-date-${key}`}
                  type="datetime-local"
                  value={interactionOccurredAt}
                  disabled={!available || createInteraction.isPending}
                  onChange={(event) => setInteractionOccurredAt(event.target.value)}
                />
                {interactionErrors.occurredAt && <p className="text-sm text-destructive">{interactionErrors.occurredAt}</p>}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`relationship-interaction-summary-${key}`}>Summary</Label>
              <Textarea
                id={`relationship-interaction-summary-${key}`}
                value={interactionSummary}
                disabled={!available || createInteraction.isPending}
                onChange={(event) => setInteractionSummary(event.target.value)}
                placeholder="What happened, what was learned, and what should happen next?"
              />
              {interactionErrors.summary && <p className="text-sm text-destructive">{interactionErrors.summary}</p>}
            </div>
            {createInteraction.isError && (
              <p className="text-sm text-destructive">
                {createInteraction.error instanceof Error ? createInteraction.error.message : 'The interaction could not be recorded.'}
              </p>
            )}
            <Button
              type="button"
              disabled={!available || createInteraction.isPending}
              onClick={submitInteraction}
            >
              <MessageSquarePlus className="mr-2 h-4 w-4" />
              {createInteraction.isPending ? 'Recording…' : 'Record interaction'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <History className="mb-1 h-5 w-5 text-primary" />
            <CardTitle>Stage history</CardTitle>
            <CardDescription>Newest lifecycle changes appear first.</CardDescription>
          </CardHeader>
          <CardContent>
            {history.isLoading && <p className="text-sm text-muted-foreground">Loading stage history…</p>}
            {history.isError && (
              <p className="text-sm text-destructive">
                {history.error instanceof Error ? history.error.message : 'Stage history could not be loaded.'}
              </p>
            )}
            {history.data?.length === 0 && <p className="text-sm text-muted-foreground">No lifecycle changes have been recorded.</p>}
            {history.data && history.data.length > 0 && (
              <ol className="space-y-4">
                {history.data.map((item) => (
                  <li className="border-b pb-4 last:border-0 last:pb-0" key={item.id}>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span>{item.from ? relationshipStageLabel(item.from) : 'Initial stage'}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      <span>{relationshipStageLabel(item.to)}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{item.reason ?? 'No reason recorded.'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDate(item.changedAt)}</p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <RelationshipTimeline
          items={interactions.data?.items ?? []}
          title="Relationship interactions"
          isLoading={interactions.isLoading}
          error={interactions.error}
        />
      </div>
    </div>
  );
}

function subjectKey(subject: RelationshipSubject) {
  if (subject.organizationId) return `organization:${subject.organizationId}`;
  if (subject.contactId) return `contact:${subject.contactId}`;
  if (subject.opportunityId) return `opportunity:${subject.opportunityId}`;
  return 'unknown';
}

function localDateTime(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}
