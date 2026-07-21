import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import type { InteractionType, OpportunityStatus } from '@/domain/relationships/contracts';
import {
  allowedOpportunityTransitions,
  formatQualificationLines,
  opportunityStatusLabel,
  parseQualificationLines,
} from '@/domain/relationships/opportunity-workflow';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { dataProvider } from '@/services/dataProvider';

const noteTypes: InteractionType[] = ['manual_note', 'phone_call', 'meeting', 'outbound_email', 'inbound_reply'];

export default function OpportunityDetailPage() {
  const { id } = useParams();
  const opportunityCapability = useRelationshipCapability('opportunities');
  const interactionCapability = useRelationshipCapability('interactions');
  const available = opportunityCapability.capability?.available === true;
  const interactionsAvailable = interactionCapability.capability?.available === true;
  const queryClient = useQueryClient();

  const opportunity = useQuery({
    queryKey: ['relationship-opportunity', id],
    queryFn: () => dataProvider.relationships.getOpportunity(id!),
    enabled: available && Boolean(id),
    retry: false,
  });

  const organization = useQuery({
    queryKey: ['relationship-organization', opportunity.data?.organizationId],
    queryFn: () => dataProvider.relationships.getOrganization(opportunity.data!.organizationId),
    enabled: Boolean(opportunity.data?.organizationId),
    retry: false,
  });

  const contact = useQuery({
    queryKey: ['relationship-contact', opportunity.data?.primaryContactId],
    queryFn: () => dataProvider.relationships.getContact(opportunity.data!.primaryContactId!),
    enabled: Boolean(opportunity.data?.primaryContactId),
    retry: false,
  });

  const interactions = useQuery({
    queryKey: ['relationship-opportunity-interactions', id],
    queryFn: () => dataProvider.relationships.listInteractions({ opportunityId: id! }, { page: 1, pageSize: 100 }),
    enabled: interactionsAvailable && Boolean(id),
    retry: false,
  });

  const [primaryContactId, setPrimaryContactId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [causeArea, setCauseArea] = useState('');
  const [veteranPriority, setVeteranPriority] = useState(false);
  const [qualificationText, setQualificationText] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [nextActionDueAt, setNextActionDueAt] = useState('');
  const [nextStatus, setNextStatus] = useState<OpportunityStatus | ''>('');
  const [transitionReason, setTransitionReason] = useState('');
  const [interactionType, setInteractionType] = useState<InteractionType>('manual_note');
  const [interactionSummary, setInteractionSummary] = useState('');
  const [formError, setFormError] = useState<string>();

  useEffect(() => {
    if (!opportunity.data) return;
    setPrimaryContactId(opportunity.data.primaryContactId ?? '');
    setOwnerId(opportunity.data.ownerId ?? '');
    setCauseArea(opportunity.data.causeArea ?? '');
    setVeteranPriority(opportunity.data.veteranPriority ?? false);
    setQualificationText(formatQualificationLines(opportunity.data.qualification));
    setNextAction(opportunity.data.nextAction ?? '');
    setNextActionDueAt(toLocalInput(opportunity.data.nextActionDueAt));
    setNextStatus(allowedOpportunityTransitions(opportunity.data.status)[0] ?? '');
  }, [opportunity.data]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['relationship-opportunity', id] }),
      queryClient.invalidateQueries({ queryKey: ['relationship-opportunity-interactions', id] }),
      queryClient.invalidateQueries({ queryKey: ['relationship-opportunity-directory'] }),
      queryClient.invalidateQueries({ queryKey: ['relationship-opportunities'] }),
    ]);
  };

  const save = useMutation({
    mutationFn: async () => {
      setFormError(undefined);
      const qualification = parseQualificationLines(qualificationText);
      return dataProvider.relationships.updateOpportunity(id!, {
        primaryContactId: primaryContactId.trim() || undefined,
        ownerId: ownerId.trim() || undefined,
        causeArea: causeArea.trim() || undefined,
        veteranPriority,
        qualification,
        nextAction: nextAction.trim() || undefined,
        nextActionDueAt: nextActionDueAt ? new Date(nextActionDueAt).toISOString() : undefined,
      });
    },
    onSuccess: refresh,
    onError: (error) => setFormError(error instanceof Error ? error.message : 'The opportunity could not be saved.'),
  });

  const transition = useMutation({
    mutationFn: async () => {
      if (!nextStatus) throw new Error('Select a next status.');
      if (!transitionReason.trim()) throw new Error('Record a reason for the status change.');
      return dataProvider.relationships.transitionOpportunityStatus(id!, {
        status: nextStatus,
        reason: transitionReason.trim(),
      });
    },
    onSuccess: async () => {
      setTransitionReason('');
      await refresh();
    },
  });

  const createInteraction = useMutation({
    mutationFn: async () => {
      if (!interactionSummary.trim()) throw new Error('Enter an interaction summary.');
      return dataProvider.relationships.createInteraction({
        opportunityId: id!,
        type: interactionType,
        occurredAt: new Date().toISOString(),
        summary: interactionSummary.trim(),
      });
    },
    onSuccess: async () => {
      setInteractionSummary('');
      await refresh();
    },
  });

  const transitionOptions = opportunity.data ? allowedOpportunityTransitions(opportunity.data.status) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{organization.data?.name ?? 'BTY opportunity'}</h1>
          <p className="mt-2 text-muted-foreground">Relationship-only qualification, fit, risk, owner, and outreach context.</p>
        </div>
        <Button asChild variant="outline"><Link to="/crm/business-development/opportunities">Back to opportunities</Link></Button>
      </div>

      <RelationshipCapabilityState state={opportunityCapability.capability} isLoading={opportunityCapability.isLoading} isError={opportunityCapability.isError} onRetry={() => { void opportunityCapability.refetch(); }} />

      {opportunity.isLoading && <Card><CardHeader><CardTitle>Loading opportunity…</CardTitle></CardHeader></Card>}
      {opportunity.isError && <Card><CardHeader><CardTitle>Opportunity could not be loaded</CardTitle><CardDescription>{opportunity.error instanceof Error ? opportunity.error.message : 'Unknown query error.'}</CardDescription></CardHeader></Card>}
      {opportunity.data === null && <Card><CardHeader><CardTitle>Opportunity not found</CardTitle><CardDescription>No opportunity with this ID exists in the selected tenant.</CardDescription></CardHeader></Card>}

      {opportunity.data && (
        <Card>
          <CardHeader><CardTitle>Opportunity summary</CardTitle><CardDescription>Authoritative pipeline status and linked relationship records.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Summary label="Status" value={opportunityStatusLabel(opportunity.data.status)} />
            <Summary label="Cause area" value={opportunity.data.causeArea ?? 'Not recorded'} />
            <Summary label="Veteran priority" value={opportunity.data.veteranPriority ? 'Yes' : 'No'} />
            <Summary label="Assigned owner" value={opportunity.data.ownerId ?? 'Unassigned'} />
            <Summary label="Next action" value={opportunity.data.nextAction ?? 'None'} />
            <Summary label="Next action due" value={formatDate(opportunity.data.nextActionDueAt)} />
            <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Organization</p><Link className="mt-1 block text-sm text-primary hover:underline" to={`/crm/business-development/organizations/${opportunity.data.organizationId}`}>{organization.data?.name ?? opportunity.data.organizationId}</Link></div>
            <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Primary contact</p>{opportunity.data.primaryContactId ? <Link className="mt-1 block text-sm text-primary hover:underline" to={`/crm/business-development/contacts/${opportunity.data.primaryContactId}`}>{contact.data?.displayName ?? opportunity.data.primaryContactId}</Link> : <p className="mt-1 text-sm">Not assigned</p>}</div>
          </CardContent>
        </Card>
      )}

      {opportunity.data && (
        <Card>
          <CardHeader><CardTitle>Qualification and ownership</CardTitle><CardDescription>Edit non-status opportunity fields. Status changes use the separate guarded transition workflow.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field id="opportunity-primary-contact" label="Primary contact ID" value={primaryContactId} onChange={setPrimaryContactId} placeholder="Optional relationship contact UUID" />
            <Field id="opportunity-owner" label="Owner profile ID" value={ownerId} onChange={setOwnerId} placeholder="Optional CRM profile UUID" />
            <Field id="opportunity-cause-area" label="Cause area" value={causeArea} onChange={setCauseArea} />
            <label className="flex items-center gap-2 self-end rounded-md border p-3 text-sm"><input type="checkbox" checked={veteranPriority} disabled={save.isPending} onChange={(event) => setVeteranPriority(event.target.checked)} />Veteran-priority opportunity</label>
            <Field id="opportunity-next-action" label="Next action" value={nextAction} onChange={setNextAction} />
            <div className="space-y-2"><Label htmlFor="opportunity-next-action-due">Next action due</Label><Input id="opportunity-next-action-due" type="datetime-local" value={nextActionDueAt} onChange={(event) => setNextActionDueAt(event.target.value)} /></div>
            <div className="space-y-2 md:col-span-2"><Label htmlFor="opportunity-qualification">Qualification evidence</Label><Textarea id="opportunity-qualification" value={qualificationText} onChange={(event) => setQualificationText(event.target.value)} placeholder="One key=value per line" /></div>
            {(formError || save.isError) && <p className="text-sm text-destructive md:col-span-2">{formError ?? (save.error instanceof Error ? save.error.message : 'The opportunity could not be saved.')}</p>}
            <div className="md:col-span-2"><Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save opportunity'}</Button></div>
          </CardContent>
        </Card>
      )}

      {opportunity.data && (
        <Card>
          <CardHeader><CardTitle>Status transition</CardTitle><CardDescription>Only database-approved transitions are available. Every change is version-checked and written to status history and the timeline.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="opportunity-next-status">Next status</Label><select id="opportunity-next-status" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={nextStatus} onChange={(event) => setNextStatus(event.target.value as OpportunityStatus)}>{transitionOptions.map((value) => <option key={value} value={value}>{opportunityStatusLabel(value)}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="opportunity-transition-reason">Reason</Label><Input id="opportunity-transition-reason" value={transitionReason} onChange={(event) => setTransitionReason(event.target.value)} placeholder="Evidence or decision supporting this change" /></div>
            {transition.isError && <p className="text-sm text-destructive md:col-span-2">{transition.error instanceof Error ? transition.error.message : 'The status transition failed.'}</p>}
            <div className="md:col-span-2"><Button type="button" disabled={!nextStatus || transition.isPending} onClick={() => transition.mutate()}>{transition.isPending ? 'Changing status…' : 'Change opportunity status'}</Button></div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Opportunity timeline</CardTitle><CardDescription>Status changes and manual interactions remain separate from clinical activity.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <RelationshipCapabilityState state={interactionCapability.capability} isLoading={interactionCapability.isLoading} isError={interactionCapability.isError} onRetry={() => { void interactionCapability.refetch(); }} />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="opportunity-interaction-type">Interaction type</Label><select id="opportunity-interaction-type" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={interactionType} onChange={(event) => setInteractionType(event.target.value as InteractionType)}>{noteTypes.map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="opportunity-interaction-summary">Summary</Label><Input id="opportunity-interaction-summary" value={interactionSummary} onChange={(event) => setInteractionSummary(event.target.value)} placeholder="What happened?" /></div>
          </div>
          {createInteraction.isError && <p className="text-sm text-destructive">{createInteraction.error instanceof Error ? createInteraction.error.message : 'The interaction could not be recorded.'}</p>}
          <Button type="button" variant="outline" disabled={!interactionsAvailable || createInteraction.isPending} onClick={() => createInteraction.mutate()}>{createInteraction.isPending ? 'Recording…' : 'Record interaction'}</Button>
          {interactions.isLoading && <p className="text-sm text-muted-foreground">Loading timeline…</p>}
          {interactions.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No opportunity interactions have been recorded.</p>}
          {interactions.data?.items.map((interaction) => (
            <div className="rounded-lg border p-4" key={interaction.id}>
              <div className="flex flex-wrap items-center justify-between gap-2"><Badge variant="outline">{interaction.type.replace(/_/g, ' ')}</Badge><span className="text-xs text-muted-foreground">{formatDate(interaction.occurredAt)}</span></div>
              <p className="mt-2 text-sm">{interaction.summary}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></div>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm">{value}</p></div>;
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}

function toLocalInput(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}
