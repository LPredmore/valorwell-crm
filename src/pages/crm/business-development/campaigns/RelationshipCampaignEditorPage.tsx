import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { RelationshipCampaignEmailStepEditor } from '@/components/crm/relationships/RelationshipCampaignEmailStepEditor';
import {
  relationshipCampaignMarketingStages,
  type RelationshipCampaignDefinitionInput,
  type RelationshipCampaignStatus,
} from '@/domain/relationships/campaign-contracts';
import {
  allowedCampaignTransitions,
  campaignActivationErrors,
  campaignDefinitionErrors,
  campaignToDefinition,
  canEditCampaign,
  emptyRelationshipCampaignDefinition,
} from '@/domain/relationships/campaign-workflow';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { dataProvider } from '@/services/dataProvider';

const marketingStageLabels = {
  source_lock: 'Source Lock',
  brief: 'Brief',
  ready: 'Ready',
  live: 'Live',
  measure: 'Measure',
  improve: 'Improve',
  pause: 'Pause',
  stop_supersede: 'Stop / Supersede',
} as const;

const statusLabels: Record<RelationshipCampaignStatus, string> = {
  draft: 'Draft',
  active: 'Activate definition',
  paused: 'Pause',
  completed: 'Complete',
  archived: 'Archive',
};

type Step = RelationshipCampaignDefinitionInput['steps'][number];

export default function RelationshipCampaignEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { capability, isLoading: capabilityLoading, isError: capabilityError, refetch } = useRelationshipCapability('campaigns');
  const available = capability?.available === true;
  const [definition, setDefinition] = useState<RelationshipCampaignDefinitionInput>(emptyRelationshipCampaignDefinition);
  const [loadedVersion, setLoadedVersion] = useState<number>();
  const [transitionReason, setTransitionReason] = useState('');
  const stepExporters = useRef(new Map<number, () => Promise<Step>>());

  const campaignQuery = useQuery({
    queryKey: ['relationship-campaign', id],
    queryFn: () => dataProvider.relationships.getCampaign(id!),
    enabled: available && !isNew,
    retry: false,
  });

  useEffect(() => {
    if (!campaignQuery.data) return;
    setDefinition(campaignToDefinition(campaignQuery.data));
    setLoadedVersion(campaignQuery.data.version);
  }, [campaignQuery.data]);

  const campaign = campaignQuery.data ?? undefined;
  const editable = isNew || (campaign ? canEditCampaign(campaign) : false);
  const definitionErrors = useMemo(() => campaignDefinitionErrors(definition), [definition]);
  const activationErrors = useMemo(() => campaignActivationErrors(definition), [definition]);

  const registerExporter = useCallback((index: number, exporter: (() => Promise<Step>) | null) => {
    if (exporter) stepExporters.current.set(index, exporter);
    else stepExporters.current.delete(index);
  }, []);

  const exportCurrentDefinition = async () => {
    const steps = await Promise.all(definition.steps.map(async (step, index) => {
      const exporter = stepExporters.current.get(index);
      return exporter ? exporter() : step;
    }));
    const current = { ...definition, steps };
    const errors = campaignDefinitionErrors(current);
    if (errors.length) throw new Error(errors.join(' '));
    setDefinition(current);
    return current;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const current = await exportCurrentDefinition();
      if (isNew) return dataProvider.relationships.createCampaign({ definition: current });
      if (!id || loadedVersion === undefined) throw new Error('Campaign version is unavailable. Refresh and retry.');
      return dataProvider.relationships.updateCampaign(id, {
        definition: current,
        expectedVersion: loadedVersion,
      });
    },
    onSuccess: async (saved) => {
      setLoadedVersion(saved.version);
      setDefinition(campaignToDefinition(saved));
      await queryClient.invalidateQueries({ queryKey: ['relationship-campaigns'] });
      await queryClient.invalidateQueries({ queryKey: ['relationship-campaign', saved.id] });
      if (isNew) navigate(`/crm/business-development/campaigns/${saved.id}`, { replace: true });
    },
  });

  const transitionMutation = useMutation({
    mutationFn: async (status: RelationshipCampaignStatus) => {
      if (!campaign || loadedVersion === undefined) throw new Error('Load the current campaign before changing status.');
      if (status === 'active' && activationErrors.length) throw new Error(activationErrors.join(' '));
      return dataProvider.relationships.transitionCampaignStatus(campaign.id, {
        status,
        expectedVersion: loadedVersion,
        reason: transitionReason.trim() || undefined,
      });
    },
    onSuccess: async (updated) => {
      setLoadedVersion(updated.version);
      setDefinition(campaignToDefinition(updated));
      setTransitionReason('');
      await queryClient.invalidateQueries({ queryKey: ['relationship-campaigns'] });
      await queryClient.invalidateQueries({ queryKey: ['relationship-campaign', updated.id] });
    },
  });

  const pending = saveMutation.isPending || transitionMutation.isPending;
  const update = <K extends keyof RelationshipCampaignDefinitionInput>(key: K, value: RelationshipCampaignDefinitionInput[K]) => {
    setDefinition((current) => ({ ...current, [key]: value }));
  };
  const updateBrief = (key: keyof RelationshipCampaignDefinitionInput['brief'], value: string | string[]) => {
    setDefinition((current) => ({ ...current, brief: { ...current.brief, [key]: value } }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{isNew ? 'New relationship campaign' : campaign?.name ?? 'Relationship campaign'}</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">Define the source, audience, one primary conversion, destination, handoff, measurement plan, and ordered outreach steps before activation.</p>
        </div>
        <Button asChild variant="outline"><Link to="/crm/business-development/campaigns">Back to campaign register</Link></Button>
      </div>

      <RelationshipCapabilityState state={capability} isLoading={capabilityLoading} isError={capabilityError} onRetry={() => { void refetch(); }} />

      <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2"><CardTitle>Execution boundary</CardTitle><Badge variant="outline">Hard disabled</Badge></div>
          <CardDescription>Campaign-mode authoring and immutable template attribution do not enable execution. Enrollment, suppression, service claims, Resend delivery, and webhook processing remain unchanged and independently guarded.</CardDescription>
        </CardHeader>
      </Card>

      {!isNew && campaignQuery.isLoading && <Card><CardHeader><CardTitle>Loading campaign…</CardTitle></CardHeader></Card>}
      {!isNew && campaignQuery.isError && <Card><CardHeader><CardTitle>Campaign could not be loaded</CardTitle><CardDescription>{errorMessage(campaignQuery.error, 'Try again later.')}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => { void campaignQuery.refetch(); }}>Try again</Button></CardContent></Card>}
      {!isNew && campaignQuery.data === null && <Card><CardHeader><CardTitle>Campaign not found</CardTitle></CardHeader></Card>}

      {available && (isNew || campaign) && (
        <>
          {campaign && (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><CardTitle>Definition state</CardTitle><CardDescription>Version {loadedVersion} · Updated {new Date(campaign.updatedAt).toLocaleString()}</CardDescription></div>
                  <div className="flex gap-2"><Badge variant="outline">{campaign.status}</Badge><Badge variant="secondary">{marketingStageLabels[campaign.marketingLifecycleStage]}</Badge></div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2"><Label htmlFor="campaign-transition-reason">Status-change reason</Label><Input id="campaign-transition-reason" value={transitionReason} onChange={(event) => setTransitionReason(event.target.value)} placeholder="Why is this definition changing state?" /></div>
                <div className="flex flex-wrap gap-2">
                  {allowedCampaignTransitions(campaign.status).map((status) => (
                    <Button key={status} type="button" variant={status === 'active' ? 'default' : 'outline'} disabled={pending} onClick={() => transitionMutation.mutate(status)}>{statusLabels[status]}</Button>
                  ))}
                </div>
                {campaign.status === 'active' && <p className="text-sm text-muted-foreground">Definition active. Campaign execution remains independently controlled.</p>}
                {transitionMutation.isError && <p className="text-sm text-destructive">{errorMessage(transitionMutation.error, 'Status could not be changed.')}</p>}
              </CardContent>
            </Card>
          )}

          <fieldset disabled={!editable || pending} className="space-y-6">
            <Card>
              <CardHeader><CardTitle>Campaign identity and sender</CardTitle><CardDescription>The campaign definition belongs only to the Business Development relationship domain.</CardDescription></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field label="Campaign name" id="campaign-name"><Input id="campaign-name" value={definition.name} onChange={(event) => update('name', event.target.value)} /></Field>
                <Field label="Initiative / source lane" id="campaign-initiative"><Input id="campaign-initiative" value={definition.initiative ?? ''} onChange={(event) => update('initiative', event.target.value)} placeholder="BTY, OCS, Partner, Connector…" /></Field>
                <Field label="Purpose" id="campaign-purpose" className="md:col-span-2"><Textarea id="campaign-purpose" value={definition.purpose} onChange={(event) => update('purpose', event.target.value)} /></Field>
                <Field label="Owner profile ID" id="campaign-owner"><Input id="campaign-owner" value={definition.ownerId ?? ''} onChange={(event) => update('ownerId', event.target.value)} placeholder="Optional CRM profile UUID" /></Field>
                <Field label="Marketing lifecycle" id="campaign-marketing-stage"><select id="campaign-marketing-stage" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={definition.marketingLifecycleStage} onChange={(event) => update('marketingLifecycleStage', event.target.value as RelationshipCampaignDefinitionInput['marketingLifecycleStage'])}>{relationshipCampaignMarketingStages.map((stage) => <option key={stage} value={stage}>{marketingStageLabels[stage]}</option>)}</select></Field>
                <Field label="Sender name" id="campaign-sender-name"><Input id="campaign-sender-name" value={definition.senderName} onChange={(event) => update('senderName', event.target.value)} /></Field>
                <Field label="Sender email" id="campaign-sender-email"><Input id="campaign-sender-email" type="email" value={definition.senderEmail} onChange={(event) => update('senderEmail', event.target.value)} /></Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Required campaign brief</CardTitle><CardDescription>One audience, one objective, and one primary conversion. The source domain owns the promoted truth; the receiving domain owns the relationship after response.</CardDescription></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <BriefField label="Source domain" name="sourceDomain" definition={definition} update={updateBrief} placeholder="Business Development, BTY, OCS…" />
                <BriefField label="Primary audience" name="audience" definition={definition} update={updateBrief} />
                <BriefField label="Objective" name="objective" definition={definition} update={updateBrief} className="md:col-span-2" />
                <BriefField label="Primary conversion" name="primaryConversion" definition={definition} update={updateBrief} />
                <BriefField label="Primary CTA" name="cta" definition={definition} update={updateBrief} />
                <BriefField label="Destination / response route" name="destination" definition={definition} update={updateBrief} />
                <BriefField label="Channel" name="channel" definition={definition} update={updateBrief} />
                <BriefField label="Geography" name="geography" definition={definition} update={updateBrief} />
                <BriefField label="Budget class" name="budgetClass" definition={definition} update={updateBrief} placeholder="Organic, Ad Grant, approved cash…" />
                <BriefField label="Attribution source" name="attributionSource" definition={definition} update={updateBrief} />
                <BriefField label="Receiving domain" name="receivingDomain" definition={definition} update={updateBrief} />
                <BriefField label="Primary metric" name="primaryMetric" definition={definition} update={updateBrief} />
                <BriefField label="Downstream quality metric" name="downstreamMetric" definition={definition} update={updateBrief} />
                <BriefField label="Start date" name="startDate" definition={definition} update={updateBrief} type="date" />
                <BriefField label="Review date" name="reviewDate" definition={definition} update={updateBrief} type="date" />
                <BriefField label="Current issue / blocker" name="currentIssue" definition={definition} update={updateBrief} />
                <BriefField label="Next decision" name="nextDecision" definition={definition} update={updateBrief} placeholder="Improve, Pause, Stop, Double Down…" />
                <ListField label="Excluded audiences" value={definition.brief.excludedAudiences} onChange={(value) => updateBrief('excludedAudiences', value)} />
                <ListField label="Operating dependencies" value={definition.brief.operatingDependencies} onChange={(value) => updateBrief('operatingDependencies', value)} />
                <ListField label="Pause / review triggers" value={definition.brief.pauseReviewTriggers} onChange={(value) => updateBrief('pauseReviewTriggers', value)} className="md:col-span-2" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Definition timing</CardTitle><CardDescription>These fields define intended timing only. They do not create scheduled work.</CardDescription></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Field label="Default timezone" id="campaign-timezone"><Input id="campaign-timezone" value={definition.defaultTimezone} onChange={(event) => update('defaultTimezone', event.target.value)} /></Field>
                <Field label="Send window start" id="campaign-window-start"><Input id="campaign-window-start" type="time" value={definition.sendWindowStart ?? ''} onChange={(event) => update('sendWindowStart', event.target.value)} /></Field>
                <Field label="Send window end" id="campaign-window-end"><Input id="campaign-window-end" type="time" value={definition.sendWindowEnd ?? ''} onChange={(event) => update('sendWindowEnd', event.target.value)} /></Field>
                <div className="flex items-center gap-2 pt-8"><input id="campaign-weekdays" type="checkbox" checked={definition.weekdaysOnly} onChange={(event) => update('weekdaysOnly', event.target.checked)} /><Label htmlFor="campaign-weekdays">Weekdays only</Label></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Ordered campaign steps</CardTitle><CardDescription>Each step stores canonical JSON, rendered HTML/text, preheader, theme, render hash, and optional immutable template-version attribution.</CardDescription></div><Button type="button" variant="outline" onClick={() => update('steps', [...definition.steps, { subjectTemplate: '', bodyTemplate: '', delayDays: 0, stopOnReply: true, isActive: true }])}><Plus className="mr-2 h-4 w-4" />Add step</Button></div></CardHeader>
              <CardContent className="space-y-4">
                {definition.steps.length === 0 && <p className="text-sm text-muted-foreground">No steps. A campaign cannot be activated without at least one active step.</p>}
                {definition.steps.map((step, index) => (
                  <RelationshipCampaignEmailStepEditor
                    key={`${index}:${step.templateVersionId ?? 'adhoc'}`}
                    index={index}
                    step={step}
                    total={definition.steps.length}
                    disabled={!editable || pending}
                    onChange={(next) => update('steps', definition.steps.map((value, currentIndex) => currentIndex === index ? next : value))}
                    onMove={(direction) => update('steps', moveItem(definition.steps, index, index + direction))}
                    onDelete={() => update('steps', definition.steps.filter((_, currentIndex) => currentIndex !== index))}
                    registerExporter={registerExporter}
                  />
                ))}
              </CardContent>
            </Card>
          </fieldset>

          <Card>
            <CardHeader><CardTitle>Save definition</CardTitle><CardDescription>{editable ? 'Every Email Studio step is freshly exported, validated, and persisted atomically with optimistic version control.' : 'This campaign must be paused before its definition can be edited.'}</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {definitionErrors.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">{definitionErrors.map((error) => <li key={error}>{error}</li>)}</ul>}
              {saveMutation.isError && <p className="text-sm text-destructive">{errorMessage(saveMutation.error, 'Campaign could not be saved.')}</p>}
              {saveMutation.isSuccess && <p className="text-sm text-emerald-700">Campaign definition saved.</p>}
              <Button type="button" disabled={!editable || pending} onClick={() => saveMutation.mutate()}>{saveMutation.isPending ? 'Exporting and saving…' : isNew ? 'Create draft campaign' : 'Save campaign definition'}</Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Field({ label, id, children, className }: { label: string; id: string; children: React.ReactNode; className?: string }) {
  return <div className={`space-y-2 ${className ?? ''}`}><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function BriefField({ label, name, definition, update, placeholder, className, type = 'text' }: {
  label: string;
  name: keyof RelationshipCampaignDefinitionInput['brief'];
  definition: RelationshipCampaignDefinitionInput;
  update: (key: keyof RelationshipCampaignDefinitionInput['brief'], value: string | string[]) => void;
  placeholder?: string;
  className?: string;
  type?: string;
}) {
  const value = definition.brief[name];
  return <Field label={label} id={`campaign-brief-${name}`} className={className}><Input id={`campaign-brief-${name}`} type={type} value={typeof value === 'string' ? value : ''} onChange={(event) => update(name, event.target.value)} placeholder={placeholder} /></Field>;
}

function ListField({ label, value, onChange, className }: { label: string; value: string[]; onChange: (value: string[]) => void; className?: string }) {
  const id = `campaign-list-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return <Field label={`${label} — one per line`} id={id} className={className}><Textarea id={id} value={value.join('\n')} onChange={(event) => onChange(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} /></Field>;
}

function moveItem<T>(items: T[], from: number, to: number) {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
