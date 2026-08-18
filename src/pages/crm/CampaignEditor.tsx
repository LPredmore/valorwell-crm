import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Save, Loader2, AlertTriangle } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useCampaign, useCreateCampaign, useUpdateCampaign } from '@/hooks/crm/useCampaigns';
import { useCampaignSteps, useSaveCampaignSteps } from '@/hooks/crm/useCampaignSteps';
import { useCampaignTrigger, useAllCampaignTriggers, useSaveCampaignTrigger } from '@/hooks/crm/useCampaignTriggers';
import { CampaignStepEditor } from '@/components/crm/campaigns/CampaignStepEditor';
import type {
  CampaignFormData,
  CampaignStepFormData,
  ClientEngagementState,
  ClientLifecycleStage,
  CrmCampaignStep,
} from '@/lib/crm/campaign-types';
import {
  ENGAGEMENT_STATE_OPTIONS,
  LIFECYCLE_STAGE_OPTIONS,
  PERSONALIZATION_VARIABLES,
  TIMEZONE_OPTIONS,
  lifecycleStageLabel,
} from '@/lib/crm/campaign-types';
import type { EmailContentDocument, EmailEditorDocument } from '@/features/email-studio/contracts';

const TIME_OPTIONS = Array.from({ length: 24 }, (_, index) => {
  const hour = index.toString().padStart(2, '0');
  return { value: `${hour}:00:00`, label: `${hour}:00` };
});

const LIFECYCLE_VALUES = new Set<ClientLifecycleStage>(LIFECYCLE_STAGE_OPTIONS.map((option) => option.value));

type StepExporter = () => Promise<CampaignStepFormData>;

function SortableStep({
  step,
  stepIndex,
  onChange,
  onRemove,
  registerExporter,
}: {
  step: CampaignStepFormData;
  stepIndex: number;
  onChange: (updates: Partial<CampaignStepFormData>) => void;
  onRemove: () => void;
  registerExporter: (clientKey: string, exporter: StepExporter | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: step.client_key });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style}>
      <CampaignStepEditor
        step={step}
        stepIndex={stepIndex}
        onChange={onChange}
        onRemove={onRemove}
        registerExporter={registerExporter}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

export default function CampaignEditor() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const { toast } = useToast();

  const { data: campaign, isLoading: campaignLoading } = useCampaign(isNew ? undefined : id);
  const { data: existingSteps, isLoading: stepsLoading } = useCampaignSteps(isNew ? undefined : id);
  const { data: existingTrigger, isLoading: triggerLoading } = useCampaignTrigger(isNew ? undefined : id);
  const { data: allTriggers } = useAllCampaignTriggers();

  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const saveSteps = useSaveCampaignSteps();
  const saveTrigger = useSaveCampaignTrigger();
  const exporters = useRef(new Map<string, StepExporter>());

  const [formData, setFormData] = useState<CampaignFormData>({
    name: '',
    description: '',
    is_active: true,
    weekdays_only: false,
    send_window_start: '09:00:00',
    send_window_end: '17:00:00',
    default_timezone: 'America/Chicago',
    on_complete_lifecycle_stage: null,
    on_complete_engagement_state: null,
  });
  const [triggerLifecycle, setTriggerLifecycle] = useState<ClientLifecycleStage | null>(null);
  const [steps, setSteps] = useState<CampaignStepFormData[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!campaign) return;
    setFormData({
      name: campaign.name,
      description: campaign.description || '',
      is_active: campaign.is_active,
      weekdays_only: campaign.weekdays_only,
      send_window_start: campaign.send_window_start,
      send_window_end: campaign.send_window_end,
      default_timezone: campaign.default_timezone,
      on_complete_lifecycle_stage: campaign.on_complete_lifecycle_stage,
      on_complete_engagement_state: campaign.on_complete_engagement_state,
    });
  }, [campaign]);

  useEffect(() => {
    if (!existingSteps) return;
    setSteps(existingSteps.map(stepToFormData));
  }, [existingSteps]);

  useEffect(() => {
    if (!existingTrigger) {
      setTriggerLifecycle(null);
      return;
    }
    const candidate = existingTrigger.trigger_dimension === 'lifecycle_stage'
      ? existingTrigger.trigger_value
      : legacyLifecycleValue(existingTrigger.trigger_on_status);
    setTriggerLifecycle(isLifecycleStage(candidate) ? candidate : null);
  }, [existingTrigger]);

  const registerExporter = useCallback((clientKey: string, exporter: StepExporter | null) => {
    if (exporter) exporters.current.set(clientKey, exporter);
    else exporters.current.delete(clientKey);
  }, []);

  const getLifecycleTriggerConflict = (stage: ClientLifecycleStage): string | null => {
    if (!allTriggers) return null;
    const conflict = allTriggers.find((trigger) => (
      trigger.campaign_id !== id
      && trigger.is_active
      && !trigger.is_manual_only
      && trigger.trigger_dimension === 'lifecycle_stage'
      && trigger.trigger_value === stage
    ));
    return conflict ? conflict.campaign_id : null;
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSteps((items) => {
      const oldIndex = items.findIndex((item) => item.client_key === String(active.id));
      const newIndex = items.findIndex((item) => item.client_key === String(over.id));
      if (oldIndex < 0 || newIndex < 0) return items;
      return arrayMove(items, oldIndex, newIndex).map((step, index) => ({ ...step, step_order: index + 1 }));
    });
  };

  const addStep = () => {
    setSteps((previous) => [
      ...previous,
      {
        client_key: createClientKey(),
        step_order: previous.length + 1,
        delay_days: previous.length === 0 ? 0 : 1,
        delay_hours: 0,
        channel: 'email',
        email_subject: '',
        email_body_html: '',
        email_body_text: '',
        email_preheader: '',
        email_content: null,
        email_template_id: null,
        email_template_version_id: null,
        sms_body_text: '',
        is_active: true,
        signature_id: null,
      },
    ]);
  };

  const updateStep = (index: number, updates: Partial<CampaignStepFormData>) => {
    setSteps((previous) => previous.map((step, current) => current === index ? { ...step, ...updates } : step));
  };

  const removeStep = (index: number) => {
    setSteps((previous) => {
      const removed = previous[index];
      if (removed) exporters.current.delete(removed.client_key);
      return previous.filter((_, current) => current !== index).map((step, current) => ({ ...step, step_order: current + 1 }));
    });
  };

  const exportCurrentSteps = async (): Promise<CampaignStepFormData[]> => {
    const exported: CampaignStepFormData[] = [];
    for (const step of steps) {
      if (step.channel === 'sms') {
        exported.push(step);
        continue;
      }
      const exporter = exporters.current.get(step.client_key);
      if (!exporter) throw new Error(`Step ${step.step_order} Email Studio is not ready.`);
      exported.push(await exporter());
    }
    return exported.map((step, index) => ({ ...step, step_order: index + 1 }));
  };

  const handleSave = async () => {
    if (!formData.name.trim()) return;
    setIsSaving(true);
    try {
      const currentSteps = await exportCurrentSteps();
      if (isNew) {
        const created = await createCampaign.mutateAsync(formData);
        if (currentSteps.length > 0) await saveSteps.mutateAsync({ campaignId: created.id, steps: currentSteps });
        await saveTrigger.mutateAsync({ campaignId: created.id, triggerLifecycle });
      } else if (id) {
        await updateCampaign.mutateAsync({ campaignId: id, formData });
        await saveSteps.mutateAsync({ campaignId: id, steps: currentSteps });
        await saveTrigger.mutateAsync({ campaignId: id, triggerLifecycle });
      }
      navigate('/crm/campaigns');
    } catch (caught) {
      toast({
        title: 'Campaign was not saved',
        description: caught instanceof Error ? caught.message : 'A campaign step could not be exported.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const isLoading = !isNew && (campaignLoading || stepsLoading || triggerLoading);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/crm/campaigns')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{isNew ? 'New Campaign' : 'Edit Campaign'}</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving || !formData.name.trim()} className="gap-2">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Campaign
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Campaign Details</CardTitle>
                <CardDescription>Basic information about this campaign</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Campaign Name *</Label>
                  <Input id="name" value={formData.name} onChange={(event) => setFormData((previous) => ({ ...previous, name: event.target.value }))} placeholder="e.g., Registration Follow-Up" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" value={formData.description} onChange={(event) => setFormData((previous) => ({ ...previous, description: event.target.value }))} placeholder="Optional notes about this campaign" rows={3} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="is_active">Active</Label>
                  <Switch id="is_active" checked={formData.is_active} onCheckedChange={(checked) => setFormData((previous) => ({ ...previous, is_active: checked }))} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Schedule Settings</CardTitle>
                <CardDescription>When messages can be sent</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="weekdays_only">Weekdays only</Label>
                  <Switch id="weekdays_only" checked={formData.weekdays_only} onCheckedChange={(checked) => setFormData((previous) => ({ ...previous, weekdays_only: checked }))} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Send window start</Label>
                    <Select value={formData.send_window_start} onValueChange={(value) => setFormData((previous) => ({ ...previous, send_window_start: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{TIME_OPTIONS.map((time) => <SelectItem key={time.value} value={time.value}>{time.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Send window end</Label>
                    <Select value={formData.send_window_end} onValueChange={(value) => setFormData((previous) => ({ ...previous, send_window_end: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{TIME_OPTIONS.map((time) => <SelectItem key={time.value} value={time.value}>{time.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Default timezone</Label>
                  <Select value={formData.default_timezone} onValueChange={(value) => setFormData((previous) => ({ ...previous, default_timezone: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TIMEZONE_OPTIONS.map((timezone) => <SelectItem key={timezone.value} value={timezone.value}>{timezone.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Completion Settings</CardTitle>
                <CardDescription>What the client state should show if every campaign step is exhausted without a response or lifecycle change.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Lifecycle after completion</Label>
                  <Select
                    value={formData.on_complete_lifecycle_stage || 'no_change'}
                    onValueChange={(value) => setFormData((previous) => ({
                      ...previous,
                      on_complete_lifecycle_stage: value === 'no_change' ? null : value as ClientLifecycleStage,
                    }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no_change">No lifecycle change</SelectItem>
                      {triggerLifecycle && (
                        <SelectItem value={triggerLifecycle}>Remain in {lifecycleStageLabel(triggerLifecycle)}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Campaigns never manufacture lifecycle progression. If the client actually moves stages, this campaign stops immediately.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Engagement after completion</Label>
                  <Select
                    value={formData.on_complete_engagement_state || 'no_change'}
                    onValueChange={(value) => setFormData((previous) => ({
                      ...previous,
                      on_complete_engagement_state: value === 'no_change' ? null : value as ClientEngagementState,
                    }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no_change">No engagement change</SelectItem>
                      {ENGAGEMENT_STATE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Lifecycle Entry</CardTitle>
                <CardDescription>Automatically enroll a client when they enter a lifecycle stage.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Start this campaign when lifecycle becomes</Label>
                  <Select
                    value={triggerLifecycle || 'none'}
                    onValueChange={(value) => {
                      const stage = value === 'none' ? null : value as ClientLifecycleStage;
                      setTriggerLifecycle(stage);
                      setFormData((previous) => ({
                        ...previous,
                        on_complete_lifecycle_stage: previous.on_complete_lifecycle_stage ? stage : null,
                      }));
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="No automatic lifecycle entry" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No automatic lifecycle entry</SelectItem>
                      {LIFECYCLE_STAGE_OPTIONS.filter((option) => option.value !== 'closed').map((option) => {
                        const conflict = getLifecycleTriggerConflict(option.value);
                        return (
                          <SelectItem key={option.value} value={option.value} disabled={Boolean(conflict)}>
                            {option.label}{conflict ? ' (used by another campaign)' : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <Alert variant="default" className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-800 dark:text-amber-200 text-xs">
                    All automated client campaigns stop immediately if the client's lifecycle changes or an inbound email/SMS is received. Do Not Contact blocks campaign enrollment and delivery.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Personalization Variables</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-2">
                {PERSONALIZATION_VARIABLES.map((variable) => (
                  <div key={variable.key} className="flex justify-between gap-3">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{variable.key}</code>
                    <span className="text-muted-foreground text-right">{variable.label}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Campaign Steps</CardTitle>
                    <CardDescription>Email steps use client-scoped Campaign Email Studio. SMS steps remain unchanged. Drag to reorder.</CardDescription>
                  </div>
                  <Button onClick={addStep} variant="outline" size="sm" className="gap-2">
                    <Plus className="h-4 w-4" />
                    Add Step
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {steps.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No steps yet. Add your first step to get started.</p>
                    <Button onClick={addStep} variant="link" className="mt-2">Add Step</Button>
                  </div>
                ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={steps.map((step) => step.client_key)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-3">
                        {steps.map((step, index) => (
                          <SortableStep
                            key={step.client_key}
                            step={step}
                            stepIndex={index}
                            onChange={(updates) => updateStep(index, updates)}
                            onRemove={() => removeStep(index)}
                            registerExporter={registerExporter}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function stepToFormData(step: CrmCampaignStep): CampaignStepFormData {
  const emailContent = canonicalEmailContent(step);
  return {
    client_key: step.id,
    id: step.id,
    step_order: step.step_order,
    delay_days: step.delay_days,
    delay_hours: step.delay_hours,
    channel: step.channel,
    email_subject: step.email_subject || '',
    email_body_html: step.email_body_html || '',
    email_body_text: step.email_body_text || '',
    email_preheader: step.email_preheader || '',
    email_content: emailContent,
    email_template_id: null,
    email_template_version_id: step.email_template_version_id || null,
    sms_body_text: step.sms_body_text || '',
    is_active: step.is_active,
    signature_id: step.signature_id || null,
  };
}

function canonicalEmailContent(step: CrmCampaignStep): EmailContentDocument | null {
  if (
    step.email_content_mode !== 'campaign'
    || !isEditorDocument(step.email_editor_document)
    || !step.email_body_html?.trim()
    || !step.email_body_text?.trim()
    || !step.email_theme_key?.trim()
    || !step.email_editor_schema_version
    || !step.email_render_hash
  ) return null;
  return {
    schemaVersion: step.email_editor_schema_version,
    mode: 'campaign',
    editorDocument: step.email_editor_document,
    renderedHtml: step.email_body_html,
    renderedText: step.email_body_text,
    preheader: step.email_preheader,
    themeKey: step.email_theme_key,
    renderHash: step.email_render_hash,
  };
}

function isEditorDocument(value: unknown): value is EmailEditorDocument {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false;
  const record = value as { type?: unknown; content?: unknown };
  return record.type === 'doc' && Array.isArray(record.content);
}

function legacyLifecycleValue(value: string | null | undefined): string | null {
  switch ((value || '').trim().toLowerCase()) {
    case 'registered': return 'registration';
    case 'early sessions': return 'early_care';
    case 'established': return 'established_care';
    default: return value?.trim().toLowerCase().replace(/\s+/g, '_') || null;
  }
}

function isLifecycleStage(value: string | null | undefined): value is ClientLifecycleStage {
  return Boolean(value && LIFECYCLE_VALUES.has(value as ClientLifecycleStage));
}

function createClientKey(): string {
  return globalThis.crypto?.randomUUID?.() || `new-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
