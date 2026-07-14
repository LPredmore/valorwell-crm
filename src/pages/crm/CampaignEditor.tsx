import { useState, useEffect } from 'react';
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
import { useCampaign, useCreateCampaign, useUpdateCampaign } from '@/hooks/crm/useCampaigns';
import { useCampaignSteps, useSaveCampaignSteps } from '@/hooks/crm/useCampaignSteps';
import { useCampaignTrigger, useAllCampaignTriggers, useSaveCampaignTrigger } from '@/hooks/crm/useCampaignTriggers';
import { CampaignStepEditor } from '@/components/crm/campaigns/CampaignStepEditor';
import type { CampaignFormData, CampaignStepFormData } from '@/lib/crm/campaign-types';
import { TIMEZONE_OPTIONS, PERSONALIZATION_VARIABLES, COMPLETION_ACTION_OPTIONS, SYSTEM_MANAGED_STATUSES } from '@/lib/crm/campaign-types';
import { ALL_STATUSES } from '@/lib/crm/status-config';

// Generate time options for select
const TIME_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const hour = i.toString().padStart(2, '0');
  return { value: `${hour}:00:00`, label: `${hour}:00` };
});

// Sortable wrapper for steps
function SortableStep({
  step,
  stepIndex,
  onChange,
  onRemove,
}: {
  step: CampaignStepFormData;
  stepIndex: number;
  onChange: (updates: Partial<CampaignStepFormData>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: step.id || `new-${stepIndex}`,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <CampaignStepEditor
        step={step}
        stepIndex={stepIndex}
        onChange={onChange}
        onRemove={onRemove}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

export default function CampaignEditor() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';

  const { data: campaign, isLoading: campaignLoading } = useCampaign(isNew ? undefined : id);
  const { data: existingSteps, isLoading: stepsLoading } = useCampaignSteps(isNew ? undefined : id);
  const { data: existingTrigger, isLoading: triggerLoading } = useCampaignTrigger(isNew ? undefined : id);
  const { data: allTriggers } = useAllCampaignTriggers();

  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const saveSteps = useSaveCampaignSteps();
  const saveTrigger = useSaveCampaignTrigger();

  const [formData, setFormData] = useState<CampaignFormData>({
    name: '',
    description: '',
    is_active: true,
    weekdays_only: false,
    send_window_start: '09:00:00',
    send_window_end: '17:00:00',
    default_timezone: 'America/Chicago',
    on_complete_action: 'do_nothing',
    on_complete_status: null,
  });

  const [triggerStatus, setTriggerStatus] = useState<string | null>(null);
  const [steps, setSteps] = useState<CampaignStepFormData[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Load existing campaign data
  useEffect(() => {
    if (campaign) {
      setFormData({
        name: campaign.name,
        description: campaign.description || '',
        is_active: campaign.is_active,
        weekdays_only: campaign.weekdays_only,
        send_window_start: campaign.send_window_start,
        send_window_end: campaign.send_window_end,
        default_timezone: campaign.default_timezone,
        on_complete_action: campaign.on_complete_action || 'do_nothing',
        on_complete_status: campaign.on_complete_status,
      });
    }
  }, [campaign]);

  // Load existing steps
  useEffect(() => {
    if (existingSteps) {
      setSteps(
        existingSteps.map((s) => ({
          id: s.id,
          step_order: s.step_order,
          delay_days: s.delay_days,
          delay_hours: s.delay_hours,
          channel: s.channel,
          email_subject: s.email_subject || '',
          email_body_html: s.email_body_html || '',
          sms_body_text: s.sms_body_text || '',
          is_active: s.is_active,
          signature_id: s.signature_id || null,
        }))
      );
    }
  }, [existingSteps]);

  // Load existing trigger
  useEffect(() => {
    if (existingTrigger) {
      setTriggerStatus(existingTrigger.trigger_on_status);
    }
  }, [existingTrigger]);

  // Check if a status is already taken by another campaign's trigger
  const getStatusTriggerConflict = (status: string): string | null => {
    if (!allTriggers) return null;
    const conflict = allTriggers.find(
      (t) => t.trigger_on_status === status && t.campaign_id !== id
    );
    return conflict ? conflict.campaign_id : null;
  };

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSteps((items) => {
        const activeId = String(active.id);
        const overId = String(over.id);
        const oldIndex = items.findIndex((i) => (i.id || `new-${items.indexOf(i)}`) === activeId);
        const newIndex = items.findIndex((i) => (i.id || `new-${items.indexOf(i)}`) === overId);
        const reordered = arrayMove(items, oldIndex, newIndex);
        return reordered.map((s, idx) => ({ ...s, step_order: idx + 1 }));
      });
    }
  };

  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      {
        step_order: prev.length + 1,
        delay_days: prev.length === 0 ? 0 : 1,
        delay_hours: 0,
        channel: 'email',
        email_subject: '',
        email_body_html: '',
        sms_body_text: '',
        is_active: true,
        signature_id: null,
      },
    ]);
  };

  const updateStep = (index: number, updates: Partial<CampaignStepFormData>) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...updates } : s))
    );
  };

  const removeStep = (index: number) => {
    setSteps((prev) => {
      const newSteps = prev.filter((_, i) => i !== index);
      return newSteps.map((s, idx) => ({ ...s, step_order: idx + 1 }));
    });
  };

  const handleSave = async () => {
    if (!formData.name.trim()) return;

    setIsSaving(true);
    try {
      if (isNew) {
        const created = await createCampaign.mutateAsync(formData);
        if (steps.length > 0) {
          await saveSteps.mutateAsync({ campaignId: created.id, steps });
        }
        await saveTrigger.mutateAsync({ campaignId: created.id, triggerStatus });
        navigate('/crm/campaigns');
      } else if (id) {
        await updateCampaign.mutateAsync({ campaignId: id, formData });
        await saveSteps.mutateAsync({ campaignId: id, steps });
        await saveTrigger.mutateAsync({ campaignId: id, triggerStatus });
        navigate('/crm/campaigns');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const isLoading = !isNew && (campaignLoading || stepsLoading || triggerLoading);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/crm/campaigns')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {isNew ? 'New Campaign' : 'Edit Campaign'}
          </h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving || !formData.name.trim()} className="gap-2">
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
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
          {/* Campaign Settings */}
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Campaign Details</CardTitle>
                <CardDescription>Basic information about this campaign</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Campaign Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., New Client Welcome"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Optional notes about this campaign"
                    rows={3}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="is_active">Active</Label>
                  <Switch
                    id="is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, is_active: checked }))}
                  />
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
                  <Switch
                    id="weekdays_only"
                    checked={formData.weekdays_only}
                    onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, weekdays_only: checked }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Send window start</Label>
                    <Select
                      value={formData.send_window_start}
                      onValueChange={(value) => setFormData((prev) => ({ ...prev, send_window_start: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIME_OPTIONS.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Send window end</Label>
                    <Select
                      value={formData.send_window_end}
                      onValueChange={(value) => setFormData((prev) => ({ ...prev, send_window_end: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIME_OPTIONS.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Default timezone</Label>
                  <Select
                    value={formData.default_timezone}
                    onValueChange={(value) => setFormData((prev) => ({ ...prev, default_timezone: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>
                          {tz.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Completion Settings */}
            <Card>
              <CardHeader>
                <CardTitle>Completion Settings</CardTitle>
                <CardDescription>What happens when a client finishes all steps</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>When campaign completes</Label>
                  <Select
                    value={formData.on_complete_action}
                    onValueChange={(value: 'do_nothing' | 'change_status') => {
                      setFormData((prev) => ({
                        ...prev,
                        on_complete_action: value,
                        on_complete_status: value === 'do_nothing' ? null : prev.on_complete_status,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMPLETION_ACTION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {formData.on_complete_action === 'change_status' && (
                  <div className="space-y-2">
                    <Label>Set status to</Label>
                    <Select
                      value={formData.on_complete_status || ''}
                      onValueChange={(value) => setFormData((prev) => ({ ...prev, on_complete_status: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a status..." />
                      </SelectTrigger>
                      <SelectContent>
                        {ALL_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Auto-Enroll Trigger */}
            <Card>
              <CardHeader>
                <CardTitle>Auto-Enroll Trigger</CardTitle>
                <CardDescription>
                  Optionally auto-enroll clients when their status changes
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>When client status changes to</Label>
                  <Select
                    value={triggerStatus || 'none'}
                    onValueChange={(value) => setTriggerStatus(value === 'none' ? null : value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="No auto-enroll" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No auto-enroll</SelectItem>
                      {ALL_STATUSES.map((status) => {
                        const conflict = getStatusTriggerConflict(status);
                        return (
                          <SelectItem
                            key={status}
                            value={status}
                            disabled={!!conflict}
                          >
                            {status}{conflict ? ' (used by another campaign)' : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {triggerStatus && SYSTEM_MANAGED_STATUSES.includes(triggerStatus) && (
                  <Alert variant="default" className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-amber-800 dark:text-amber-200 text-xs">
                      "{triggerStatus}" is set automatically by the system (e.g., when appointments are booked or documented). Clients will be auto-enrolled without manual action.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Variables Reference */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Personalization Variables</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {PERSONALIZATION_VARIABLES.map((v) => (
                  <div key={v.key} className="flex justify-between">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{v.key}</code>
                    <span className="text-muted-foreground">{v.label}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Steps */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Campaign Steps</CardTitle>
                    <CardDescription>
                      Messages sent in sequence. Drag to reorder.
                    </CardDescription>
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
                    <Button onClick={addStep} variant="link" className="mt-2">
                      Add Step
                    </Button>
                  </div>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={steps.map((s, i) => s.id || `new-${i}`)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-3">
                        {steps.map((step, index) => (
                          <SortableStep
                            key={step.id || `new-${index}`}
                            step={step}
                            stepIndex={index}
                            onChange={(updates) => updateStep(index, updates)}
                            onRemove={() => removeStep(index)}
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
